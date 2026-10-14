[CmdletBinding()]
param([string]$Gateway='',[string]$InstallRoot='',[switch]$NoPath,[switch]$ManagedSetup)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+';'+$env:PSModulePath
$exitCode=1;$transcribing=$false;$logFile='';$destination=''
if($env:QCODE_SETUP_NO_PATH -eq '1'){$NoPath=$true}
try{
    if(-not $InstallRoot){$InstallRoot=if($env:QCODE_CLIENT_ROOT){$env:QCODE_CLIENT_ROOT}else{Join-Path $env:LOCALAPPDATA 'QCode'}}
    $logs=Join-Path $InstallRoot 'logs'
    New-Item -ItemType Directory -Force -Path $logs|Out-Null
    $logFile=Join-Path $logs ('setup-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)+'.log')
    Start-Transcript -LiteralPath $logFile -Force|Out-Null;$transcribing=$true
    Write-Host 'QCode setup is starting. Please keep this window open.'
    if($ManagedSetup){Write-Host 'QCODE_PROGRESS|5|payload'}
    $source=Join-Path $PSScriptRoot 'client.zip'
    if(-not (Test-Path -LiteralPath $source)){throw 'client.zip is missing. Download the complete installer again.'}
    if(-not $Gateway){$Gateway=$env:QCODE_GATEWAY}
    $settingsFile=Join-Path $InstallRoot 'settings.json'
    if(-not $Gateway -and (Test-Path -LiteralPath $settingsFile)){
        try{$Gateway=(Get-Content -LiteralPath $settingsFile -Raw|ConvertFrom-Json).gateway}catch{throw 'Existing QCode settings.json is invalid; fix it or pass -Gateway explicitly.'}
    }
    if(-not $Gateway){
        $gatewayFile=Join-Path $PSScriptRoot 'gateway.txt'
        if(-not (Test-Path -LiteralPath $gatewayFile)){throw 'gateway.txt is missing. Download the complete installer again.'}
        $Gateway=(Get-Content -LiteralPath $gatewayFile -Raw).Trim()
    }
    $gatewayUri=$null
    if(-not [Uri]::TryCreate($Gateway,[UriKind]::Absolute,[ref]$gatewayUri) -or $gatewayUri.Scheme -notin @('http','https') -or $gatewayUri.UserInfo -or $gatewayUri.Query -or $gatewayUri.Fragment -or $gatewayUri.AbsolutePath -ne '/'){throw 'QCode gateway must be an HTTP(S) origin without credentials, path, query or fragment.'}
    $destination=Join-Path $env:TEMP ('qcode-setup-'+[guid]::NewGuid().ToString('N'))
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Write-Host 'Extracting the bundled client...'
    if($ManagedSetup){Write-Host 'QCODE_PROGRESS|15|extract'}
    [IO.Compression.ZipFile]::ExtractToDirectory($source,$destination)
    if($ManagedSetup){
        & (Join-Path $destination 'install.ps1') -Gateway $Gateway -InstallRoot $InstallRoot -NoPath:$NoPath -NoShortcuts -ProgressEvents
    }else{
        & (Join-Path $destination 'install.ps1') -Gateway $Gateway -InstallRoot $InstallRoot -NoPath:$NoPath
    }
    if($LASTEXITCODE -ne 0){throw "Bundled installer failed with exit code $LASTEXITCODE."}
    Write-Host 'QCode installation succeeded.' -ForegroundColor Green
    if($ManagedSetup){Write-Host 'QCODE_PROGRESS|100|complete'}
    Write-Host 'Open the QCode desktop shortcut, or open a NEW terminal and run qcode or qcodeweb.'
    Write-Host 'Login and AI requests require a connection to your QCode gateway.'
    $exitCode=0
}catch{
    Write-Host 'QCode installation failed.' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host $_.ScriptStackTrace
    Write-Host 'Please send the setup log to your administrator.'
}finally{
    # Remove only the unique extraction directory owned by this invocation.
    if($destination -and (Test-Path -LiteralPath $destination)){
        try{
            $tempRoot=[IO.Path]::GetFullPath($env:TEMP).TrimEnd([IO.Path]::DirectorySeparatorChar)
            $resolved=[IO.Path]::GetFullPath($destination)
            if([IO.Path]::GetDirectoryName($resolved) -ne $tempRoot -or [IO.Path]::GetFileName($resolved) -notmatch '^qcode-setup-[a-f0-9]{32}$'){throw 'Unexpected extraction directory'}
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }catch{Write-Warning "Could not clean this installation's temporary files: $destination"}
    }
    if($transcribing){try{Stop-Transcript|Out-Null}catch{Write-Warning 'Could not close the setup log.'}}
    if($logFile){Write-Host "Setup log: $logFile"}
}
exit $exitCode
