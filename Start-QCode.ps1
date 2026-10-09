[CmdletBinding()]
param([Parameter(Position=0)][ValidateSet('demo','start','setup','test','check','package','backup')][string]$Command='demo',[string]$Node=$env:QCODE_NODE)
$ErrorActionPreference='Stop'
if(-not $Node){$candidate=Get-Command node -ErrorAction SilentlyContinue;if($candidate){$Node=$candidate.Source}}
if(-not $Node -or [version](& $Node -p 'process.versions.node') -lt [version]'24.0.0'){
    $bundled=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    if(Test-Path -LiteralPath $bundled){$Node=$bundled}else{throw 'Install Node.js 24 LTS or pass -Node PATH_TO_NODE_EXE'}
}
$server=Join-Path $PSScriptRoot 'apps/server'
Push-Location -LiteralPath $server
try{
    if($Command -in @('demo','start','package')){& $Node scripts/package-client.js;if($LASTEXITCODE -ne 0){throw 'Client packaging failed'}}
    switch($Command){
        'demo' {& $Node scripts/demo.js}
        'start' {& $Node --env-file=.env src/index.js}
        'setup' {& $Node scripts/prepare-local-test.js}
        'test' {& $Node test/run.js}
        'check' {& $Node scripts/check.js}
        'backup' {& $Node --env-file=.env scripts/maintenance.js backup}
        'package' {Write-Host 'Client ZIP is ready in apps/server/releases'}
    }
    if($LASTEXITCODE -ne 0){throw "QCode $Command failed"}
}finally{Pop-Location}
