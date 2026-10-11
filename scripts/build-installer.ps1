[CmdletBinding()]
param([string]$CertificateThumbprint='', [string]$ReleaseDirectory='', [ValidateRange(60,3600)][int]$BuildTimeoutSeconds=600)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$release=if($ReleaseDirectory){[IO.Path]::GetFullPath($ReleaseDirectory)}else{Join-Path $root 'apps/server/releases'}
$archive=Join-Path $release 'qcode-client-0.4.0.zip'
if(-not (Test-Path -LiteralPath $archive)){throw 'Build the client ZIP with npm run package:client first'}
$manifestPath=Join-Path $release 'manifest.json'
$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
if($manifest.version -ne '0.4.0' -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256){throw 'Client ZIP does not match its release manifest'}
$build=Join-Path $release 'exe-build'
New-Item -ItemType Directory -Force -Path $build|Out-Null
Copy-Item -LiteralPath $archive -Destination (Join-Path $build 'client.zip') -Force
$bootstrap=@'
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot 'client.zip'
$destination=Join-Path $env:TEMP ('qcode-setup-'+[guid]::NewGuid().ToString('N'))
Expand-Archive -LiteralPath $source -DestinationPath $destination
try { & (Join-Path $destination 'install.ps1') } catch { Write-Host $_.Exception.Message -ForegroundColor Red }
Read-Host 'Press Enter to close'
'@
$bootstrap | Set-Content -LiteralPath (Join-Path $build 'bootstrap.ps1') -Encoding utf8
'@echo off' + "`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0bootstrap.ps1`"`r`n" | Set-Content -LiteralPath (Join-Path $build 'install.cmd') -Encoding ascii
$target=Join-Path $release 'QCodeSetup-0.4.0.exe'
$sed=@"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=0
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=Install QCode for the current Windows user?
DisplayLicense=
FinishMessage=QCode setup finished. Check the installer window for details.
TargetName=..\QCodeSetup-0.4.0.exe
FriendlyName=QCode 0.4.0
AppLaunched=install.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[SourceFiles]
SourceFiles0=.\
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
[Strings]
FILE0="client.zip"
FILE1="bootstrap.ps1"
FILE2="install.cmd"
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
if($CertificateThumbprint){$certificate=Get-Item -LiteralPath "Cert:/CurrentUser/My/$CertificateThumbprint";$signature=Set-AuthenticodeSignature -FilePath $target -Certificate $certificate -TimestampServer 'http://timestamp.digicert.com';if($signature.Status -ne 'Valid'){throw 'Installer signature validation failed'}}
$manifestPath=Join-Path $release 'manifest.json'
$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
$manifest|Add-Member -NotePropertyName installerUrl -NotePropertyValue '/downloads/QCodeSetup-0.4.0.exe' -Force
$manifest|Add-Member -NotePropertyName installerSha256 -NotePropertyValue (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -Force
[IO.File]::WriteAllText($manifestPath,($manifest|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
Write-Output "Built installer: $target"
