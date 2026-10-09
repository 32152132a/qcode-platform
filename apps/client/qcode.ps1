[CmdletBinding()]
param(
    [Parameter(Position=0)][ValidateSet('web','tui','login','logout','switch','doctor','update','rollback','help')][string]$Command='web',
    [string]$Gateway=$env:QCODE_GATEWAY,[string]$WorkDir='', [string]$HarnessEntry=$env:QCODE_HARNESS_ENTRY,[switch]$NoOpen
)
$ErrorActionPreference='Stop'
$clientVersion='0.3.0'
if($Command -eq 'help'){Write-Host 'qcode [web|tui|login|logout|switch|doctor|update|rollback] [-Gateway URL] [-WorkDir PATH] [-NoOpen]';exit 0}
$clientRoot=if($env:QCODE_CLIENT_ROOT){$env:QCODE_CLIENT_ROOT}else{Join-Path $env:LOCALAPPDATA 'QCode'}
New-Item -ItemType Directory -Force -Path $clientRoot | Out-Null
$settingsFile=Join-Path $clientRoot 'settings.json'
if(-not $Gateway -and (Test-Path -LiteralPath $settingsFile)){$Gateway=(Get-Content -LiteralPath $settingsFile -Raw|ConvertFrom-Json).gateway}
if(-not $Gateway){$Gateway='http://127.0.0.1:3100'}
$address=[Uri]$Gateway
if(-not $address.IsAbsoluteUri -or $address.Scheme -notin @('http','https') -or $address.UserInfo -or $address.Query -or $address.Fragment -or $address.AbsolutePath -ne '/'){throw 'Gateway must be an HTTP(S) origin without credentials or a path.'}
$Gateway=$Gateway.TrimEnd('/')
if($address.Scheme -eq 'http' -and -not $address.IsLoopback){Write-Warning 'Unencrypted HTTP: configure company HTTPS before sending real credentials.'}
if($Command -eq 'update'){& (Join-Path $PSScriptRoot 'install.ps1') -Gateway $Gateway -Update;exit $LASTEXITCODE}
if($Command -eq 'rollback'){& (Join-Path $PSScriptRoot 'install.ps1') -Rollback;exit $LASTEXITCODE}
$sha=[Security.Cryptography.SHA256]::Create()
try{$serverId=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Gateway)))).Replace('-','').Substring(0,24)}finally{$sha.Dispose()}
$serverRoot=Join-Path $clientRoot $serverId
New-Item -ItemType Directory -Force -Path $serverRoot | Out-Null
$sessionFile=Join-Path $serverRoot 'session.json'
$storeHelper=Join-Path $PSScriptRoot 'secure-store.ps1'
$utf8=New-Object Text.UTF8Encoding($false)
$OutputEncoding=$utf8
function Invoke-Gateway($Path,$Method='GET',$Body=$null,$Token=''){
    $options=@{Uri="$Gateway$Path";Method=$Method;TimeoutSec=15;ContentType='application/json';Headers=@{}}
    if($Token){$options.Headers.Authorization="Bearer $Token"}
    if($null -ne $Body){$options.Body=[Text.Encoding]::UTF8.GetBytes(($Body|ConvertTo-Json -Depth 10))}
    try{Invoke-RestMethod @options}catch{if($_.ErrorDetails.Message){throw "Gateway: $($_.ErrorDetails.Message)"};throw 'Gateway unreachable; check the address and network.'}
}
$nodeExecutable=$env:QCODE_NODE
if(-not $nodeExecutable){$installedNode=Join-Path $clientRoot 'runtime/node-v24.19.0-win-x64/node.exe';$armNode=Join-Path $clientRoot 'runtime/node-v24.19.0-win-arm64/node.exe';if(Test-Path -LiteralPath $installedNode){$nodeExecutable=$installedNode}elseif(Test-Path -LiteralPath $armNode){$nodeExecutable=$armNode}}
if(-not $nodeExecutable){$nodeCommand=Get-Command node -ErrorAction SilentlyContinue;if($nodeCommand){$nodeExecutable=$nodeCommand.Source}}
if(-not $nodeExecutable -or [version](& $nodeExecutable -p 'process.versions.node') -lt [version]'24.0.0'){
    $existingRuntime=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    if(-not $env:QCODE_NODE -and (Test-Path -LiteralPath $existingRuntime)){$nodeExecutable=$existingRuntime}else{throw 'Node.js 24 LTS is required; run the QCode installer or set QCODE_NODE.'}
}
if(-not $HarnessEntry){
    $installedHarness=Join-Path $clientRoot 'harness/node_modules/@deepseek-ai/dsh/lib/bin.js'
    if(Test-Path -LiteralPath $installedHarness){$HarnessEntry=$installedHarness}else{$repository=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent;$HarnessEntry=Join-Path $repository '.stage1-dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'}
}
if($Command -eq 'doctor'){
    $health=Invoke-Gateway '/health'
    Write-Host "QCode: $clientVersion | Gateway: $Gateway ($($health.status))"
    Write-Host "Node: $(& $nodeExecutable -p 'process.versions.node') | Harness installed: $(Test-Path -LiteralPath $HarnessEntry) | Saved login: $(Test-Path -LiteralPath $sessionFile)"
    exit 0
}
$session=$null
if(Test-Path -LiteralPath $sessionFile){
    $plain=& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $storeHelper -Action read -Path $sessionFile
    if($LASTEXITCODE -ne 0){throw 'Saved login could not be decrypted. Use the original Windows account or remove this saved session.'}
    $session=($plain -join "`n")|ConvertFrom-Json;$plain=$null
}
if($Command -in @('logout','switch')){
    if($session){
        try{$renewed=Invoke-Gateway '/auth/refresh' 'POST' @{refreshToken=$session.refreshToken} $session.token;Invoke-Gateway '/auth/logout' 'POST' @{} $renewed.token|Out-Null}
        catch{if($_.Exception.Message -notmatch 'INVALID_TOKEN|USER_DISABLED'){throw}}
    }
    if(Test-Path -LiteralPath $sessionFile){Remove-Item -LiteralPath $sessionFile};$session=$null
    if($Command -eq 'logout'){Write-Host 'Logged out. Existing model requests have been revoked.';exit 0}
}
if(-not $session){
    $username=Read-Host 'Username';$secure=Read-Host 'Password' -AsSecureString
    $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try{$password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer);$session=Invoke-Gateway '/auth/login' 'POST' @{username=$username;password=$password;device=$env:COMPUTERNAME}}
    finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$password=$null;$secure=$null}
    # Pipe the session to a helper, never place access or refresh tokens on a process command line.
    $session|ConvertTo-Json -Depth 20 -Compress|powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $storeHelper -Action write -Path $sessionFile
    if($LASTEXITCODE -ne 0){throw 'Unable to save encrypted login'}
}
[IO.File]::WriteAllText($settingsFile,(@{gateway=$Gateway}|ConvertTo-Json),$utf8)
if($Command -in @('login','switch')){Write-Host "Logged in as $($session.user.username). Run qcode web or qcode tui.";exit 0}
if(-not (Test-Path -LiteralPath $HarnessEntry -PathType Leaf)){throw 'Harness is missing; run the QCode installer or set QCODE_HARNESS_ENTRY.'}
$previousPath=$env:PATH
try{
    $env:PATH=(Split-Path $nodeExecutable -Parent)+';'+$env:PATH
    $launcherArguments=@((Join-Path $PSScriptRoot 'launcher.mjs'),'--gateway',$Gateway,'--session',$sessionFile,'--entry',$HarnessEntry,'--mode',$Command,'--no-open',([string]$NoOpen.IsPresent).ToLowerInvariant())
    if($WorkDir){$launcherArguments+=@('--workdir',$WorkDir)}
    & $nodeExecutable @launcherArguments
    if($LASTEXITCODE -ne 0){throw 'QCode exited with an error. If your session was revoked, run qcode switch.'}
}finally{$env:PATH=$previousPath;$session=$null}
