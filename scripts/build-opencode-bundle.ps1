[CmdletBinding()]
param([string]$OpenCodeRepository='',[string]$OutputDirectory='',[string]$BunExecutable=$env:QCODE_BUN)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
if(-not $OpenCodeRepository){$OpenCodeRepository=Join-Path (Split-Path $root -Parent) 'qcode-opencode'}
$repository=(Resolve-Path -LiteralPath $OpenCodeRepository).Path
if(-not $OutputDirectory){$OutputDirectory=Join-Path $root 'artifacts/opencode-build'}
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
if(-not $BunExecutable){$privateBun=Join-Path $root 'artifacts/build-tools/package/bin/bun.exe';if(Test-Path -LiteralPath $privateBun){$BunExecutable=$privateBun}else{$BunExecutable=(Get-Command bun -ErrorAction Stop).Source}}
$BunExecutable=(Resolve-Path -LiteralPath $BunExecutable).Path
function Invoke-Build([string[]]$Arguments){& $BunExecutable @Arguments;if($LASTEXITCODE -ne 0){throw 'OpenCode build failed'}}
$buildVersion='1.19.0-qcode.1'
$arch=if($env:PROCESSOR_ARCHITECTURE -eq 'ARM64'){'arm64'}else{'x64'}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
$variables=@('PATH','TEMP','TMP','BUN_INSTALL_CACHE_DIR','npm_config_registry','HUSKY','OPENCODE_VERSION','OPENCODE_CHANNEL','OPENCODE_RELEASE','MODELS_DEV_API_JSON','SENTRY_AUTH_TOKEN')
$saved=@{};foreach($name in $variables){$saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
$materialized=@{}
Push-Location $repository
try{
    $commit=(& git rev-parse HEAD).Trim();if($LASTEXITCODE -ne 0){throw 'Cannot read runtime commit'}
    if((Get-Content packages/opencode/package.json -Raw|ConvertFrom-Json).version -ne '1.19.0'){throw 'Review the QCode integration before building a different upstream version'}
    if((Get-Content packages/app/index.html -Raw) -notmatch '<title>QCode</title>'){throw 'Expected QCode branded source'}
    $dist=[IO.Path]::GetFullPath((Join-Path $repository 'packages/opencode/dist'))
    if(-not $dist.StartsWith($repository+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Build output escaped repository'}
    # Upstream rebuilds this checked dist directory; never point it at user projects.
    $env:PATH=(Split-Path $BunExecutable -Parent)+';'+$env:PATH
    $env:TEMP=Join-Path $root 'artifacts/build-temp';$env:TMP=$env:TEMP
    $env:BUN_INSTALL_CACHE_DIR=Join-Path $root 'artifacts/bun-official-cache'
    New-Item -ItemType Directory -Force -Path $env:TEMP|Out-Null
    $env:HUSKY='0';$env:OPENCODE_VERSION=$buildVersion;$env:OPENCODE_CHANNEL='qcode';$env:OPENCODE_RELEASE='';$env:SENTRY_AUTH_TOKEN=''
    $snapshot=Join-Path $OutputDirectory 'models.json'
    if(-not (Test-Path -LiteralPath $snapshot)){& curl.exe -fsSL --connect-timeout 15 --max-time 120 -o $snapshot https://models.dev/api.json;if($LASTEXITCODE -ne 0){throw 'Cannot download model catalog'}}
    $null=Get-Content -LiteralPath $snapshot -Raw|ConvertFrom-Json
    $env:MODELS_DEV_API_JSON=$snapshot
    $env:npm_config_registry='https://registry.npmjs.org'
    Invoke-Build @('install','--frozen-lockfile','--registry','https://registry.npmjs.org')
    # Git on Windows can check out symlinks as text files. Restore those exact bytes after building.
    foreach($line in (& git ls-files -s -- packages/app/public)){
        if($line -notmatch '^120000 [a-f0-9]+ 0\s+(.+)$'){continue}
        $relative=$Matches[1];$file=Join-Path $repository $relative
        if((Get-Item -LiteralPath $file).LinkType){continue}
        $link=(& git show "HEAD:$relative") -join "`n"
        if([IO.File]::ReadAllText($file).Trim() -ne $link.Trim()){throw "Modified symlink placeholder: $relative"}
        $target=[IO.Path]::GetFullPath((Join-Path (Split-Path $file -Parent) $link.Trim()))
        if(-not $target.StartsWith($repository+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Asset escaped repository'}
        $materialized[$file]=[IO.File]::ReadAllBytes($file)
        [IO.File]::WriteAllBytes($file,[IO.File]::ReadAllBytes($target))
    }
    Invoke-Build @('run','packages/opencode/script/build.ts','--single','--skip-install')
    $binary=Join-Path $dist "opencode-windows-$arch/bin/opencode.exe"
    if(-not (Test-Path -LiteralPath $binary)){throw 'Expected compiled Windows executable'}
    $actual=& $binary --version;if($LASTEXITCODE -ne 0 -or ($actual -join '').Trim() -ne $buildVersion){throw 'Compiled runtime version mismatch'}
    $stage=Join-Path $OutputDirectory ('payload-'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path (Join-Path $stage 'bin')|Out-Null
    Copy-Item -LiteralPath $binary -Destination (Join-Path $stage 'bin/qcode-engine.exe')
    Copy-Item -LiteralPath (Join-Path $repository 'LICENSE') -Destination $stage
    Copy-Item -LiteralPath (Join-Path $repository 'QCODE.md') -Destination $stage
    $metadata=@{runtime='opencode';brand='QCode';version=$buildVersion;commit=$commit;platform='win32';arch=$arch;entry='bin/qcode-engine.exe';binarySha256=(Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()}
    $utf8=New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path $stage 'qcode-runtime.json'),($metadata|ConvertTo-Json),$utf8)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=Join-Path $OutputDirectory 'qcode-opencode-bundle.zip'
    if(Test-Path -LiteralPath $archive){throw 'Bundle already exists; use a new output directory'}
    [IO.Compression.ZipFile]::CreateFromDirectory($stage,$archive)
    $metadata.sha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText(($archive+'.json'),($metadata|ConvertTo-Json),$utf8)
    Write-Host "Built $archive"
}finally{
    foreach($file in $materialized.Keys){[IO.File]::WriteAllBytes($file,$materialized[$file])}
    foreach($name in $variables){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}
    Pop-Location
}
