[CmdletBinding()]
param(
    [switch]$BuildOnly,
    [string]$HarnessRepository='',
    [string]$HarnessBundle='',
    [string]$PublishDirectory='',
    [string]$Target='root@81.69.61.183',
    [string]$SshKey='',
    [string]$Container='qyq_qcode',
    [string]$CertificateThumbprint=''
)
$ErrorActionPreference='Stop'
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+';'+$env:PSModulePath
$root=Split-Path $PSScriptRoot -Parent
function Invoke-Checked([string]$Program,[string[]]$Arguments){
    & $Program @Arguments
    if($LASTEXITCODE -ne 0){throw "$Program failed (exit $LASTEXITCODE); release stopped"}
}
function Read-Release([string]$Directory){
    $manifest=Get-Content -LiteralPath (Join-Path $Directory 'manifest.json') -Raw|ConvertFrom-Json
    if($manifest.version -notmatch '^\d+\.\d+\.\d+$' -or $manifest.harnessBrand -ne 'QCode'){throw 'Expected a versioned QCode custom release'}
    foreach($item in @(@("qcode-client-$($manifest.version).zip",$manifest.sha256,$manifest.downloadUrl),@("QCodeSetup-$($manifest.version).exe",$manifest.installerSha256,$manifest.installerUrl))){
        if($item[1] -cnotmatch '^[a-f0-9]{64}$' -or $item[2] -cne "/downloads/$($item[0])"){throw 'Invalid release manifest'}
        if((Get-FileHash -LiteralPath (Join-Path $Directory $item[0]) -Algorithm SHA256).Hash.ToLowerInvariant() -cne $item[1]){throw "Release checksum mismatch: $($item[0])"}
    }
    return $manifest
}
if($BuildOnly -and $PublishDirectory){throw '-BuildOnly cannot be combined with -PublishDirectory'}
if($PublishDirectory -and $HarnessBundle){throw '-PublishDirectory cannot be combined with -HarnessBundle'}
$artifacts=Join-Path $root 'artifacts'
New-Item -ItemType Directory -Force -Path $artifacts|Out-Null
$lockPath=Join-Path $artifacts 'client-release.lock'
try{$releaseLock=[IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)}
catch{throw 'A release may already be running. Inspect artifacts/client-release.lock before retrying.'}
try{
$publishedVersion=''
$nodeVersion=& node --version
if($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24){throw 'Use Node.js 24 or newer in this terminal'}
if($PublishDirectory){$release=(Resolve-Path -LiteralPath $PublishDirectory).Path;$manifest=Read-Release $release}
if(-not $BuildOnly){
    if($Target -notmatch '^[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*$' -or $Container -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]*$'){throw 'Invalid SSH target or container name'}
    if(-not $SshKey){$SshKey=Join-Path (Split-Path $root -Parent) 'login.pem'}
    $key=(Resolve-Path -LiteralPath $SshKey).Path
    $sshArguments=@('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','IdentitiesOnly=yes','-i',$key)
    Write-Host 'Checking existing gateway and persistent release volume (read-only)...'
    $inspection=Invoke-Checked 'ssh' ($sshArguments+@($Target,"docker inspect $Container"))
    $containers=($inspection -join "`n")|ConvertFrom-Json
    $gateway=@($containers)[0]
    if(-not $gateway.State.Running){throw 'Gateway is not running; deploy the server first'}
    $mount=@($gateway.Mounts|Where-Object {$_.Destination -eq '/app/apps/server/releases' -and $_.RW -and $_.Type -in @('volume','bind')})
    if($mount.Count -ne 1){throw 'Persistent writable release mount is missing; deploy the updated compose configuration first'}
    Invoke-Checked 'ssh' ($sshArguments+@($Target,"docker exec $Container test -f /app/apps/server/scripts/publish-client.js"))
    $remoteManifest=Invoke-Checked 'ssh' ($sshArguments+@($Target,"docker exec $Container sh -c 'if test -f /app/apps/server/releases/manifest.json; then cat /app/apps/server/releases/manifest.json; else echo {}; fi'"))
    if($remoteManifest){$publishedVersion=(($remoteManifest -join "`n")|ConvertFrom-Json).version}

}
if(-not $PublishDirectory){
    $release=Join-Path $root ('artifacts/release-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
    New-Item -ItemType Directory -Path $release -Force|Out-Null
    Write-Host "Building in $release"
    Invoke-Checked 'node' @((Join-Path $root 'apps/server/test/run.js'))
    if(-not $HarnessBundle){
        if(-not $HarnessRepository){$HarnessRepository=Join-Path (Split-Path $root -Parent) 'qcode-harness'}
        Push-Location $HarnessRepository
        try{Invoke-Checked 'pnpm' @('run','build:qcode')}finally{Pop-Location}
        $bundleDirectory=Join-Path $release 'runtime-build'
        & (Join-Path $PSScriptRoot 'build-harness-bundle.ps1') -HarnessRepository $HarnessRepository -OutputDirectory $bundleDirectory
        $bundles=@(Get-ChildItem -LiteralPath $bundleDirectory -Filter '*.zip' -File)
        if($bundles.Count -ne 1){throw 'Expected exactly one Harness bundle'}
        $HarnessBundle=$bundles[0].FullName
    }
    $runtime=Get-Content -LiteralPath ($HarnessBundle+'.json') -Raw|ConvertFrom-Json
    if($runtime.platform -ne 'win32' -or $runtime.arch -notin @('x64','arm64')){throw 'Unsupported Harness platform'}
    $nodeCache=Join-Path $artifacts 'node-cache'
    New-Item -ItemType Directory -Force -Path $nodeCache|Out-Null
    $nodeName="node-v24.19.0-win-$($runtime.arch).zip"
    $nodeArchive=Join-Path $nodeCache $nodeName
    if(-not (Test-Path -LiteralPath $nodeArchive)){
        $partial=$nodeArchive+'.partial'
        Invoke-WebRequest "https://nodejs.org/dist/v24.19.0/$nodeName" -OutFile $partial -UseBasicParsing
        Move-Item -LiteralPath $partial -Destination $nodeArchive
    }
    $nodeHash=if($runtime.arch -eq 'arm64'){'8502f4a50b458d4cc38ed8f2001556c2cd239d464920f74017926ccb1e1c157f'}else{'57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73'}
    if((Get-FileHash -LiteralPath $nodeArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $nodeHash){throw "Node cache checksum mismatch; remove the damaged file and retry: $nodeArchive"}
    $tuiDirectory=Join-Path $release 'tui-build'
    & (Join-Path $PSScriptRoot 'build-tui-bundle.ps1') -OutputDirectory $tuiDirectory
    $tuiBundle=Join-Path $tuiDirectory 'qcode-tui-bundle.zip'
    Invoke-Checked 'node' @((Join-Path $PSScriptRoot 'next-client-version.mjs'),(Join-Path $root 'apps/client/release.json'),$publishedVersion)
    Invoke-Checked 'node' @((Join-Path $root 'apps/server/scripts/package-client.js'),'--harness-bundle',(Resolve-Path -LiteralPath $HarnessBundle).Path,'--output',$release,'--node-archive',$nodeArchive,'--tui-bundle',$tuiBundle)
    & (Join-Path $PSScriptRoot 'build-installer.ps1') -ReleaseDirectory $release -CertificateThumbprint $CertificateThumbprint
    $previousRelease=$env:QCODE_TEST_RELEASE_DIRECTORY
    try{
        $env:QCODE_TEST_RELEASE_DIRECTORY=$release
        Invoke-Checked 'node' @('--test',(Join-Path $root 'apps/server/test/installer.test.js'))
    }finally{$env:QCODE_TEST_RELEASE_DIRECTORY=$previousRelease}
    $manifest=Read-Release $release
}
if($BuildOnly){Write-Host "Build and checks passed: $release";return}
$stage='/tmp/qcode-release-'+[guid]::NewGuid().ToString('N')
$files=@("qcode-client-$($manifest.version).zip","QCodeSetup-$($manifest.version).exe",'manifest.json')
Write-Host "Uploading QCode $($manifest.version); current downloads stay active until publication succeeds..."
Invoke-Checked 'ssh' ($sshArguments+@($Target,"mkdir -m 700 $stage"))
foreach($file in $files){Invoke-Checked 'scp' ($sshArguments+@((Join-Path $release $file),"${Target}:$stage/$file"))}
Invoke-Checked 'ssh' ($sshArguments+@($Target,"docker exec $Container mkdir -m 700 $stage"))
foreach($file in $files){Invoke-Checked 'ssh' ($sshArguments+@($Target,"docker cp $stage/$file ${Container}:$stage/$file"))}
Invoke-Checked 'ssh' ($sshArguments+@($Target,"docker exec $Container node /app/apps/server/scripts/publish-client.js $stage /app/apps/server/releases"))
# Delete only the three known uploaded files and their empty staging directories.
$cleanup=($files|ForEach-Object {"$stage/$_"}) -join ' '
try{
    Invoke-Checked 'ssh' ($sshArguments+@($Target,"docker exec $Container rm -- $cleanup && docker exec $Container rmdir -- $stage && rm -- $cleanup && rmdir -- $stage"))
}catch{Write-Warning "Release is active, but staging cleanup failed: $stage. $($_.Exception.Message)"}
Write-Host "Published QCode $($manifest.version). Download: http://code.quyongqing.cn/downloads/installer"
Write-Host "Local artifacts: $release"

}finally{
    $releaseLock.Dispose()
    Remove-Item -LiteralPath $lockPath
}
