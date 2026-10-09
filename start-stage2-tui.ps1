param([switch]$HelpOnly)

$ErrorActionPreference = 'Stop'
$stageRoot = Join-Path $PSScriptRoot '.stage1-dsh'
$nodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) {
    throw 'The Node 24 test runtime is missing.'
}
$env:PATH = (Split-Path $nodePath) + ';' + $env:PATH
$env:DSH_HOME = Join-Path $stageRoot 'home'
Set-Location (Join-Path $PSScriptRoot 'stage1-workspace')
$entry = Join-Path $stageRoot 'node_modules\@deepseek-ai\dsh\lib\bin.js'
if ($HelpOnly) {
    & $nodePath $entry --profile stage2-tui --help
} else {
    & $nodePath $entry --profile stage2-tui
}
