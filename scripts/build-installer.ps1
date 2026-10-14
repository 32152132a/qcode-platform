[CmdletBinding()]
param([string]$CertificateThumbprint='', [string]$ReleaseDirectory='', [string]$InnoCompiler='', [ValidatePattern('^QCodeTest-[a-f0-9]{32}$')][string]$TestAppId='', [ValidateRange(60,3600)][int]$BuildTimeoutSeconds=600)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$clientEnvironment=Join-Path $root 'config/client.env'
$gatewayLine=Get-Content -LiteralPath $clientEnvironment | Where-Object { $_ -match '^QCODE_GATEWAY=' } | Select-Object -Last 1
if(-not $gatewayLine){throw 'QCODE_GATEWAY is missing from config/client.env'}
$gateway=($gatewayLine -split '=',2)[1].Trim()
$gatewayUri=$null
if(-not [Uri]::TryCreate($gateway,[UriKind]::Absolute,[ref]$gatewayUri) -or $gatewayUri.Scheme -notin @('http','https') -or $gatewayUri.UserInfo -or $gatewayUri.Query -or $gatewayUri.Fragment -or $gatewayUri.AbsolutePath -ne '/'){throw 'QCODE_GATEWAY in config/client.env must be an HTTP(S) origin without credentials, path, query or fragment'}
$release=if($ReleaseDirectory){[IO.Path]::GetFullPath($ReleaseDirectory)}else{Join-Path $root 'apps/server/releases'}
$manifestPath=Join-Path $release 'manifest.json'
$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
$version=$manifest.version
if($version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid release version'}
$archive=Join-Path $release "qcode-client-$version.zip"
if(-not (Test-Path -LiteralPath $archive)){throw 'Build the custom client ZIP first'}
if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256){throw 'Client ZIP does not match its release manifest'}
$build=Join-Path $release 'exe-build'
New-Item -ItemType Directory -Force -Path $build|Out-Null
Copy-Item -LiteralPath $archive -Destination (Join-Path $build 'client.zip') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'installer-bootstrap.ps1') -Destination (Join-Path $build 'bootstrap.ps1') -Force
[IO.File]::WriteAllText((Join-Path $build 'gateway.txt'),$gateway,(New-Object Text.UTF8Encoding($false)))
if(-not $InnoCompiler){
    $compilerCommand=Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if($compilerCommand){$InnoCompiler=$compilerCommand.Source}else{
        foreach($candidate in @((Join-Path $root 'artifacts/inno-tools/compiler/ISCC.exe'),(Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6/ISCC.exe'),(Join-Path $env:LOCALAPPDATA 'Programs/Inno Setup 6/ISCC.exe'))){if(Test-Path -LiteralPath $candidate){$InnoCompiler=$candidate;break}}
    }
}
if(-not $InnoCompiler -or -not (Test-Path -LiteralPath $InnoCompiler)){throw 'Inno Setup 6 compiler missing. Install it or pass -InnoCompiler path/to/ISCC.exe.'}
# Use isolated Windows user temp output for Inno executable resource updates.
$compilerOutput=Join-Path (Join-Path $env:LOCALAPPDATA 'Temp') ('qcode-inno-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $compilerOutput -Force|Out-Null
$arguments=@('/Qp',"/DClientVersion=$version",('/DBuildDirectory="'+$build+'"'),('/DOutputDirectory="'+$compilerOutput+'"'),('/DProjectRoot="'+$root+'"'),('"'+(Join-Path $PSScriptRoot 'qcode-setup.iss')+'"'))
if($TestAppId){$arguments+=('/DTestAppId="'+$TestAppId+'"')}
$compilerLog=Join-Path $build 'compiler.log';$compilerErrors=Join-Path $build 'compiler-errors.log'
$process=Start-Process -FilePath $InnoCompiler -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput $compilerLog -RedirectStandardError $compilerErrors
$null=$process.Handle
$elapsed=[Diagnostics.Stopwatch]::StartNew()
$nextNotice=30
while(-not $process.WaitForExit(1000)){
    if($elapsed.Elapsed.TotalSeconds -ge $BuildTimeoutSeconds){throw "Inno compiler is still running (PID $($process.Id)); inspect it before retrying"}
    if($elapsed.Elapsed.TotalSeconds -ge $nextNotice){Write-Output "Compressing installer ($([int]$elapsed.Elapsed.TotalSeconds)s)...";$nextNotice+=30}
}
$compiled=Join-Path $compilerOutput "QCodeSetup-$version.exe"
$target=Join-Path $release "QCodeSetup-$version.exe"
if($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $compiled)){throw "Inno Setup compilation failed (exit $($process.ExitCode)); see $compilerLog and $compilerErrors"}
Copy-Item -LiteralPath $compiled -Destination $target -Force
Remove-Item -LiteralPath $compiled
try{[IO.Directory]::Delete($compilerOutput)}catch{Write-Warning "Compiler temporary folder retained: $compilerOutput"}
if($CertificateThumbprint){$certificate=Get-Item -LiteralPath "Cert:/CurrentUser/My/$CertificateThumbprint";$signature=Set-AuthenticodeSignature -FilePath $target -Certificate $certificate -TimestampServer 'http://timestamp.digicert.com';if($signature.Status -ne 'Valid'){throw 'Installer signature validation failed'}}
$manifestPath=Join-Path $release 'manifest.json'
$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
$manifest|Add-Member -NotePropertyName installerUrl -NotePropertyValue "/downloads/QCodeSetup-$version.exe" -Force
$manifest|Add-Member -NotePropertyName installerSha256 -NotePropertyValue (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -Force
if($TestAppId){$manifest|Add-Member -NotePropertyName installerTestAppId -NotePropertyValue $TestAppId -Force}
$manifest|Add-Member -NotePropertyName installerType -NotePropertyValue 'inno-setup' -Force
[IO.File]::WriteAllText($manifestPath,($manifest|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
Write-Output "Built installer: $target"
