[CmdletBinding()]
param([string]$Gateway='',[string]$InstallRoot='',[switch]$NoPath)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+';'+$env:PSModulePath
$exitCode=1;$transcribing=$false;$logFile=''
try{
    if(-not $InstallRoot){$InstallRoot=if($env:QCODE_CLIENT_ROOT){$env:QCODE_CLIENT_ROOT}else{Join-Path $env:LOCALAPPDATA 'QCode'}}
    $logs=Join-Path $InstallRoot 'logs'
    New-Item -ItemType Directory -Force -Path $logs|Out-Null
    $logFile=Join-Path $logs ('setup-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)+'.log')
    Start-Transcript -LiteralPath $logFile -Force|Out-Null;$transcribing=$true
    Write-Host 'QCode setup is starting. Please keep this window open.'
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
    if(-not [Uri]::TryCreate($Gateway,[UriKind]::Absolute,[ref]$gatewayUri) -or $gatewayUri.Scheme -notin @('http','https')){throw 'QCode gateway must be an absolute HTTP(S) URL.'}
    $destination=Join-Path $env:TEMP ('qcode-setup-'+[guid]::NewGuid().ToString('N'))
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Write-Host 'Extracting the bundled client...'
    [IO.Compression.ZipFile]::ExtractToDirectory($source,$destination)
    & (Join-Path $destination 'install.ps1') -Gateway $Gateway -InstallRoot $InstallRoot -NoPath:$NoPath
    if($LASTEXITCODE -ne 0){throw "Bundled installer failed with exit code $LASTEXITCODE."}
    Write-Host 'QCode installation succeeded.' -ForegroundColor Green
    Write-Host 'Open the QCode desktop shortcut, or open a NEW terminal and run qcode or qcodeweb.'
    Write-Host 'Login and AI requests require a connection to your QCode gateway.'
    $exitCode=0
}catch{
    Write-Host 'QCode installation failed.' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host $_.ScriptStackTrace
    Write-Host 'Please send the setup log to your administrator.'
}finally{
    if($transcribing){try{Stop-Transcript|Out-Null}catch{Write-Warning 'Could not close the setup log.'}}
    if($logFile){Write-Host "Setup log: $logFile"}
}
exit $exitCode
