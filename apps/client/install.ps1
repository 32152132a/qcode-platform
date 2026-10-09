[CmdletBinding()]
param([string]$Gateway='', [switch]$Update, [switch]$Rollback, [switch]$Uninstall, [switch]$SkipRuntime, [switch]$SkipHarness, [switch]$NoPath, [string]$InstallRoot='')
$ErrorActionPreference='Stop'
$version='0.3.0'
if(-not $InstallRoot){$InstallRoot=if($env:QCODE_CLIENT_ROOT){$env:QCODE_CLIENT_ROOT}else{Join-Path $env:LOCALAPPDATA 'QCode'}}
$InstallRoot=[IO.Path]::GetFullPath($InstallRoot)
$utf8=New-Object Text.UTF8Encoding($false)
$pointerFile=Join-Path $InstallRoot 'current.json'
$bin=Join-Path $InstallRoot 'bin'
$shortcutFile=Join-Path ([Environment]::GetFolderPath('Desktop')) 'QCode.lnk'
function Write-JsonFile($Path,$Value){[IO.File]::WriteAllText($Path,($Value|ConvertTo-Json -Depth 10),$utf8)}
function Assert-Child($Path){$resolved=[IO.Path]::GetFullPath($Path);if(-not $resolved.StartsWith($InstallRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Installer path escaped the QCode directory'};return $resolved}
function Expand-CheckedArchive($Archive,$Destination){
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $target=[IO.Path]::GetFullPath($Destination)
    $zip=[IO.Compression.ZipFile]::OpenRead($Archive)
    try{foreach($entry in $zip.Entries){$entryPath=[IO.Path]::GetFullPath((Join-Path $target $entry.FullName));if(-not $entryPath.StartsWith($target+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe archive path'}}}finally{$zip.Dispose()}
    Expand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force
}
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
$lockPath=Join-Path $InstallRoot 'install.lock'
try{$installLock=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch{throw 'Another QCode installer is running'}
try{
    $current=if(Test-Path -LiteralPath $pointerFile){Get-Content -LiteralPath $pointerFile -Raw|ConvertFrom-Json}else{$null}
    if($Uninstall){
        foreach($name in @('qcode.cmd','bootstrap.ps1')){$target=Assert-Child (Join-Path $bin $name);if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target}}
        if(-not $NoPath){$entries=@([Environment]::GetEnvironmentVariable('Path','User') -split ';'|Where-Object{$_ -and $_ -ne $bin});[Environment]::SetEnvironmentVariable('Path',($entries -join ';'),'User');if(Test-Path -LiteralPath $shortcutFile){Remove-Item -LiteralPath $shortcutFile}}
        Write-Host 'QCode command removed. Projects, encrypted sessions and runtime files were preserved.';return
    }
    if($Rollback){
        if(-not $current.previous -or $current.previous -notmatch '^\d+\.\d+\.\d+$'){throw 'No previous QCode release is available'}
        $previousDir=Assert-Child (Join-Path $InstallRoot "versions/$($current.previous)")
        if(-not (Test-Path -LiteralPath (Join-Path $previousDir 'qcode.ps1'))){throw 'Previous release is incomplete'}
        Write-JsonFile $pointerFile @{version=$current.previous;previous=$current.version};Write-Host "Rolled back to QCode $($current.previous). Restart the client.";return
    }
    if(-not $Gateway){$settings=Join-Path $InstallRoot 'settings.json';if(Test-Path -LiteralPath $settings){$Gateway=(Get-Content -LiteralPath $settings -Raw|ConvertFrom-Json).gateway}}
    if(-not $Gateway){$Gateway=Read-Host 'Company QCode gateway URL'}
    $address=[Uri]$Gateway
    if(-not $address.IsAbsoluteUri -or $address.Scheme -notin @('http','https') -or $address.UserInfo -or $address.Query -or $address.Fragment -or $address.AbsolutePath -ne '/'){throw 'Invalid gateway origin'}
    $Gateway=$Gateway.TrimEnd('/')
    if($Update -and $address.Scheme -ne 'https' -and -not $address.IsLoopback){throw 'Client updates require HTTPS (loopback development gateways are allowed)'}
    Invoke-RestMethod "$Gateway/health" -TimeoutSec 15|Out-Null
    $source=$PSScriptRoot
    if($Update){
        $manifest=Invoke-RestMethod "$Gateway/downloads/manifest.json" -TimeoutSec 15
        if($manifest.version -notmatch '^\d+\.\d+\.\d+$' -or $manifest.sha256 -notmatch '^[a-f0-9]{64}$' -or $manifest.downloadUrl -notmatch '^/downloads/qcode-client-\d+\.\d+\.\d+\.zip$'){throw 'Invalid release manifest'}
        if($current -and [version]$manifest.version -le [version]$current.version){Write-Host 'QCode is already current.';return}
        $version=$manifest.version
        $cache=Assert-Child (Join-Path $InstallRoot ('downloads/'+[guid]::NewGuid().ToString('N')))
        New-Item -ItemType Directory -Force -Path $cache|Out-Null
        $archive=Join-Path $cache 'client.zip'
        Invoke-WebRequest "$Gateway$($manifest.downloadUrl)" -OutFile $archive -UseBasicParsing -TimeoutSec 180
        if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256){throw 'Client archive checksum mismatch'}
        $source=Join-Path $cache 'source';Expand-CheckedArchive $archive $source
    }
    $target=Assert-Child (Join-Path $InstallRoot "versions/$version")
    if(Test-Path -LiteralPath $target){
        $installed=Join-Path $target '.qcode-release.json'
        if(-not (Test-Path -LiteralPath $installed)){throw 'Release directory already exists without an ownership marker; refusing to overwrite'}
    }else{
        $stage=Assert-Child (Join-Path $InstallRoot ('versions/stage-'+[guid]::NewGuid().ToString('N')))
        New-Item -ItemType Directory -Force -Path $stage|Out-Null
        foreach($file in Get-ChildItem -LiteralPath $source -File){if($file.Extension -in @('.ps1','.cmd','.mjs','.json','.md')){Copy-Item -LiteralPath $file.FullName -Destination $stage}}
        $harnessSource=Join-Path $source 'harness';$harnessStage=Join-Path $stage 'harness';New-Item -ItemType Directory -Force -Path $harnessStage|Out-Null
        foreach($file in @('package.json','package-lock.json')){Copy-Item -LiteralPath (Join-Path $harnessSource $file) -Destination $harnessStage}
        Write-JsonFile (Join-Path $stage '.qcode-release.json') @{version=$version;installedAt=[DateTime]::UtcNow.ToString('o')}
        Move-Item -LiteralPath $stage -Destination $target
    }
    $architecture=if($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64'){'arm64'}else{'x64'}
    $nodeDirectory=Assert-Child (Join-Path $InstallRoot "runtime/node-v24.19.0-win-$architecture")
    $node=Join-Path $nodeDirectory 'node.exe'
    if(-not $SkipRuntime -and -not (Test-Path -LiteralPath $node)){
        $expected=if($architecture -eq 'arm64'){'8502f4a50b458d4cc38ed8f2001556c2cd239d464920f74017926ccb1e1c157f'}else{'57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73'}
        $runtimeRoot=Assert-Child (Join-Path $InstallRoot 'runtime');New-Item -ItemType Directory -Force -Path $runtimeRoot|Out-Null
        $nodeArchive=Join-Path $runtimeRoot "node-v24.19.0-win-$architecture.zip"
        Write-Host 'Downloading the pinned Node.js runtime...'
        Invoke-WebRequest "https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-$architecture.zip" -OutFile $nodeArchive -UseBasicParsing -TimeoutSec 300
        if((Get-FileHash -LiteralPath $nodeArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'Node runtime checksum mismatch'}
        Expand-CheckedArchive $nodeArchive $runtimeRoot
    }
    if(-not $SkipHarness){
        if(-not (Test-Path -LiteralPath $node)){if($env:QCODE_NODE){$node=$env:QCODE_NODE}else{throw 'A Node.js runtime is required to install Harness'}}
        $harness=Assert-Child (Join-Path $InstallRoot 'harness');New-Item -ItemType Directory -Force -Path $harness|Out-Null
        $desiredLock=Join-Path $target 'harness/package-lock.json';$savedLock=Join-Path $harness 'package-lock.json'
        $needsInstall=-not (Test-Path -LiteralPath (Join-Path $harness 'node_modules/@deepseek-ai/dsh/lib/bin.js'))
        if(-not (Test-Path -LiteralPath $savedLock) -or (Get-FileHash -LiteralPath $savedLock).Hash -ne (Get-FileHash -LiteralPath $desiredLock).Hash){$needsInstall=$true}
        if($needsInstall){
            # npm ci uses the reviewed lockfile and verifies package integrity hashes.
            Copy-Item -LiteralPath $desiredLock -Destination $savedLock -Force
            Copy-Item -LiteralPath (Join-Path $target 'harness/package.json') -Destination $harness -Force
            $npm=Join-Path (Split-Path $node -Parent) 'node_modules/npm/bin/npm-cli.js'
            $oldPath=$env:PATH
            try{$env:PATH=(Split-Path $node -Parent)+';'+$env:PATH;& $node $npm ci --prefix $harness --no-audit --no-fund;if($LASTEXITCODE -ne 0){throw 'Harness dependency installation failed'}}finally{$env:PATH=$oldPath}
        }
    }
    New-Item -ItemType Directory -Force -Path $bin|Out-Null
    Copy-Item -LiteralPath (Join-Path $target 'bootstrap.ps1') -Destination $bin -Force
    [IO.File]::WriteAllText((Join-Path $bin 'qcode.cmd'),"@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0bootstrap.ps1`" %*`r`n",[Text.Encoding]::ASCII)
    Write-JsonFile $pointerFile @{version=$version;previous=$(if($current -and $current.version -ne $version){$current.version}else{$current.previous})}
    Write-JsonFile (Join-Path $InstallRoot 'settings.json') @{gateway=$Gateway}
    if(-not $NoPath){
        $entries=@([Environment]::GetEnvironmentVariable('Path','User') -split ';'|Where-Object{$_ -and $_ -ne $bin});[Environment]::SetEnvironmentVariable('Path',(($entries+$bin) -join ';'),'User')
        $shell=New-Object -ComObject WScript.Shell;$shortcut=$shell.CreateShortcut($shortcutFile);$shortcut.TargetPath=Join-Path $bin 'qcode.cmd';$shortcut.Arguments='web';$shortcut.Save()
    }
    Write-Host "QCode $version installed. Open a new terminal and run qcode web."
}finally{$installLock.Dispose();if(Test-Path -LiteralPath $lockPath){Remove-Item -LiteralPath $lockPath}}
