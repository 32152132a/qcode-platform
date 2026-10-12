[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$output=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $output|Out-Null
$stage=Join-Path $output ('tui-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage|Out-Null
foreach($file in @('package.json','pnpm-lock.yaml','pnpm-workspace.yaml')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot "tui-runtime/$file") -Destination $stage}
Push-Location $stage
try{
    & pnpm install --prod --frozen-lockfile --store-dir (Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/pnpm-store')
    if($LASTEXITCODE -ne 0){throw 'Pinned TUI dependency installation failed'}
    $core=Get-Content 'node_modules/@deepseek-ai/dsh/package.json' -Raw|ConvertFrom-Json
    $plugin=Get-Content 'node_modules/@deepseek-harness-tui/dsh-tui/package.json' -Raw|ConvertFrom-Json
    $expected=Get-Content 'package.json' -Raw|ConvertFrom-Json
    if($core.version -ne $expected.dependencies.'@deepseek-ai/dsh' -or $plugin.version -ne $expected.dependencies.'@deepseek-harness-tui/dsh-tui'){throw 'TUI runtime versions differ from the pinned pair'}
    & node 'node_modules/@deepseek-ai/dsh/lib/bin.js' --help | Out-Null
    if($LASTEXITCODE -ne 0){throw 'Pinned TUI core cannot start'}
    $architecture=& node -p 'process.arch'
    $metadata=@{harnessVersion=$core.version;tuiVersion=$plugin.version;platform='win32';arch=$architecture;entry='node_modules/@deepseek-ai/dsh/lib/bin.js';lockSha256=(Get-FileHash 'pnpm-lock.yaml' -Algorithm SHA256).Hash.ToLowerInvariant()}
    [IO.File]::WriteAllText((Join-Path $stage 'qcode-tui-runtime.json'),($metadata|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
}finally{Pop-Location}
$archive=Join-Path $output 'qcode-tui-bundle.zip'
if(Test-Path -LiteralPath $archive){throw 'TUI archive already exists; choose a fresh output directory'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage,$archive,[IO.Compression.CompressionLevel]::Optimal,$false)
$metadata.sha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($archive+'.json'),($metadata|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
Write-Host "Built pinned TUI bundle: $archive"
