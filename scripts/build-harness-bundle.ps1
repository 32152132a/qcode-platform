[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$HarnessRepository,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$repository=(Resolve-Path -LiteralPath $HarnessRepository).Path
$output=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $output|Out-Null
$stage=Join-Path $output ('runtime-'+[guid]::NewGuid().ToString('N'))
$prepare=Join-Path $PSScriptRoot 'prepare-harness-bundle.mjs'
Push-Location $repository
try{
    & pnpm --filter '@deepseek-ai/dsh' deploy --legacy --prod --config.allow-unused-patches=true --config.node-linker=hoisted --config.auto-install-peers=false --config.link-workspace-packages=true --config.hoist-workspace-packages=false $stage
    if($LASTEXITCODE -ne 0){throw 'Harness export failed'}
    & pnpm exec tsx $prepare $repository $stage
    if($LASTEXITCODE -ne 0){throw 'Harness payload validation failed'}
}finally{
    & pnpm install --offline --frozen-lockfile --prod=false --ignore-scripts
    $restoreExit=$LASTEXITCODE
    Pop-Location
    if($restoreExit -ne 0){throw 'Restore the Harness development dependencies before continuing'}
}
$metadata=Get-Content -LiteralPath (Join-Path $stage 'qcode-runtime.json') -Raw|ConvertFrom-Json
$previousTestEntry=$env:QCODE_TEST_HARNESS_ENTRY
try{
    $env:QCODE_TEST_HARNESS_ENTRY=Join-Path $stage 'lib/bin.js'
    & node --test --test-name-pattern='packaged' (Join-Path (Split-Path $PSScriptRoot -Parent) 'apps/server/test/harness-runtime.test.js')
    if($LASTEXITCODE -ne 0){throw 'Employee login/Web/model gateway checks failed; runtime was not packaged'}
}finally{$env:QCODE_TEST_HARNESS_ENTRY=$previousTestEntry}
$archive=Join-Path $output ('qcode-harness-'+$metadata.version+'-'+$metadata.platform+'-'+$metadata.arch+'-'+$metadata.commit.Substring(0,10)+'.zip')
if(Test-Path -LiteralPath $archive){throw 'Artifact already exists; choose a fresh output directory'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage,$archive,[IO.Compression.CompressionLevel]::Optimal,$false)
$metadata|Add-Member -NotePropertyName sha256 -NotePropertyValue (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($archive+'.json'),($metadata|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
Write-Output "Built $archive (metadata: $archive.json)"
