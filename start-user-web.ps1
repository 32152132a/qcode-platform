[CmdletBinding()]
param([string]$Gateway = '', [string]$WorkDir = '')
& (Join-Path $PSScriptRoot 'apps/client/qcode.ps1') web -Gateway $Gateway -WorkDir $WorkDir
