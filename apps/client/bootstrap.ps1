$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$current=Get-Content -LiteralPath (Join-Path $root 'current.json') -Raw|ConvertFrom-Json
if($current.version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid QCode version pointer'}
$env:QCODE_CLIENT_ROOT=$root
& (Join-Path $root "versions/$($current.version)/qcode.ps1") @args
