[CmdletBinding()]
param([string]$CertificateThumbprint='', [string]$ReleaseDirectory='', [ValidateRange(60,3600)][int]$BuildTimeoutSeconds=600)
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
$command=@'
@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap.ps1"
set "setup_exit=%errorlevel%"
echo.
echo QCode setup exit code: %setup_exit%
echo If setup failed, keep the message above and the setup log.
if not defined QCODE_SETUP_NO_PAUSE pause
exit /b %setup_exit%
'@
[IO.File]::WriteAllText((Join-Path $build 'install.cmd'),($command -replace "`r?`n","`r`n"),[Text.Encoding]::ASCII)
$target=Join-Path $release "QCodeSetup-$version.exe"
$sed=@"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=0
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=Install QCode for the current Windows user?
DisplayLicense=
FinishMessage=See the QCode setup window for the result and log location.
TargetName=..\QCodeSetup-$version.exe
FriendlyName=QCode $version
AppLaunched=install.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=install.cmd
UserQuietInstCmd=install.cmd
SourceFiles=SourceFiles
[SourceFiles]
SourceFiles0=.\
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
%FILE3%=
[Strings]
FILE0="client.zip"
FILE1="bootstrap.ps1"
FILE2="install.cmd"
FILE3="gateway.txt"
"@
$sedPath=Join-Path $build 'package.sed'
$sed|Set-Content -LiteralPath $sedPath -Encoding ascii
$process=Start-Process -FilePath (Join-Path $env:WINDIR 'System32/iexpress.exe') -ArgumentList @('/N','/Q','package.sed') -WorkingDirectory $build -WindowStyle Hidden -PassThru
$elapsed=[Diagnostics.Stopwatch]::StartNew()
$nextNotice=30
while(-not $process.WaitForExit(1000)){
    if($elapsed.Elapsed.TotalSeconds -ge $BuildTimeoutSeconds){throw "IExpress is still running (PID $($process.Id)); inspect it before retrying"}
    if($elapsed.Elapsed.TotalSeconds -ge $nextNotice){Write-Output "Compressing installer ($([int]$elapsed.Elapsed.TotalSeconds)s)...";$nextNotice+=30}
}
if($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $target)){throw "IExpress did not produce an EXE (exit $($process.ExitCode)); the ZIP installer remains available"}
& (Join-Path $PSScriptRoot 'set-exe-icon.ps1') -Executable $target -Icon (Join-Path $root 'apps/client/branding/qcode.ico')
if($CertificateThumbprint){$certificate=Get-Item -LiteralPath "Cert:/CurrentUser/My/$CertificateThumbprint";$signature=Set-AuthenticodeSignature -FilePath $target -Certificate $certificate -TimestampServer 'http://timestamp.digicert.com';if($signature.Status -ne 'Valid'){throw 'Installer signature validation failed'}}
$manifestPath=Join-Path $release 'manifest.json'
$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
$manifest|Add-Member -NotePropertyName installerUrl -NotePropertyValue "/downloads/QCodeSetup-$version.exe" -Force
$manifest|Add-Member -NotePropertyName installerSha256 -NotePropertyValue (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -Force
[IO.File]::WriteAllText($manifestPath,($manifest|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
Write-Output "Built installer: $target"
