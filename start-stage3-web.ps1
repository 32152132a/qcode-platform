$ErrorActionPreference = 'Stop'
$nodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$env:PATH = (Split-Path $nodePath) + ';' + $env:PATH
$env:DSH_HOME = Join-Path $PSScriptRoot '.stage1-dsh\gateway-home'
# Avoid inheriting a provider key into the isolated client.
Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
Set-Location (Join-Path $PSScriptRoot 'stage1-workspace')
$entry = Join-Path $PSScriptRoot '.stage1-dsh\node_modules\@deepseek-ai\dsh\lib\bin.js'
# Ask the web server to let the OS choose an unused loopback port.
& $nodePath $entry web --port 0
