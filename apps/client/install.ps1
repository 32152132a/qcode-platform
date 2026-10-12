[CmdletBinding()]
param([string]$Gateway='', [switch]$Update, [switch]$Rollback, [switch]$Uninstall, [switch]$SkipRuntime, [switch]$SkipHarness, [switch]$NoPath, [string]$InstallRoot='')
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
# A Node/PowerShell 7 parent can pass a module search path incompatible with Windows PowerShell.
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+[IO.Path]::PathSeparator+$env:PSModulePath
$version=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release.json') -Raw|ConvertFrom-Json).version
if(-not $InstallRoot){$InstallRoot=if($env:QCODE_CLIENT_ROOT){$env:QCODE_CLIENT_ROOT}else{Join-Path $env:LOCALAPPDATA 'QCode'}}
$InstallRoot=[IO.Path]::GetFullPath($InstallRoot)
$utf8=New-Object Text.UTF8Encoding($false)
$pointerFile=Join-Path $InstallRoot 'current.json'
$bin=Join-Path $InstallRoot 'bin'
$shortcutFile=Join-Path ([Environment]::GetFolderPath('Desktop')) 'QCode.lnk'
function Write-JsonFile($Path,$Value){[IO.File]::WriteAllText($Path,($Value|ConvertTo-Json -Depth 10),$utf8)}
function Assert-Child($Path){$resolved=[IO.Path]::GetFullPath($Path);if(-not $resolved.StartsWith($InstallRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Installer path escaped the QCode directory'};return $resolved}
function Expand-CheckedArchive($Archive,$Destination){
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $target=[IO.Path]::GetFullPath($Destination)
    $prefix=$target+[IO.Path]::DirectorySeparatorChar
    $zip=[IO.Compression.ZipFile]::OpenRead($Archive)
    try{
        # Validate every entry before writing, then use .NET instead of Expand-Archive.
        foreach($entry in $zip.Entries){
            $entryPath=[IO.Path]::GetFullPath([IO.Path]::Combine($target,$entry.FullName))
            if(-not $entryPath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe archive path'}
        }
        $elapsed=[Diagnostics.Stopwatch]::StartNew()
        foreach($entry in $zip.Entries){
            $entryPath=[IO.Path]::GetFullPath([IO.Path]::Combine($target,$entry.FullName))
            if($entry.FullName.EndsWith('/') -or $entry.FullName.EndsWith('\')){
                [IO.Directory]::CreateDirectory($entryPath)|Out-Null
            }else{
                [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($entryPath))|Out-Null
                [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$entryPath,$true)
            }
        }
        Write-Host "Extracted $($zip.Entries.Count) entries in $([int]$elapsed.Elapsed.TotalSeconds)s."
    }finally{$zip.Dispose()}
}
function Install-CustomRuntime($Source,$Destination){
        $runtimeMetadata=Join-Path $Source 'harness-bundle.json'
        if(Test-Path -LiteralPath $runtimeMetadata){
            $runtime=Get-Content -LiteralPath $runtimeMetadata -Raw|ConvertFrom-Json
            $machineArch=if($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64'){'arm64'}else{'x64'}
            if($runtime.brand -ne 'QCode' -or $runtime.platform -ne 'win32' -or $runtime.arch -ne $machineArch -or $runtime.entry -ne 'lib/bin.js' -or $runtime.sha256 -notmatch '^[a-f0-9]{64}$'){throw 'Custom Harness bundle is invalid or incompatible with this computer'}
            $bundle=Join-Path $Source 'harness-bundle.zip'
            if((Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash.ToLowerInvariant() -ne $runtime.sha256){throw 'Custom Harness checksum mismatch'}
            $customStage=Join-Path $Destination 'harness-custom'
            Expand-CheckedArchive $bundle $customStage
            $embedded=Get-Content -LiteralPath (Join-Path $customStage 'qcode-runtime.json') -Raw|ConvertFrom-Json
            if($embedded.commit -ne $runtime.commit -or $embedded.version -ne $runtime.version -or -not (Test-Path -LiteralPath (Join-Path $customStage 'lib/bin.js'))){throw 'Custom Harness payload does not match the release metadata'}
        }
}
function Install-OpenCodeRuntime($Source,$Destination){
    $info=Get-Content -LiteralPath (Join-Path $Source 'opencode-bundle.json') -Raw|ConvertFrom-Json
    $machineArch=if($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64'){'arm64'}else{'x64'}
    if($info.runtime -ne 'opencode' -or $info.brand -ne 'QCode' -or $info.platform -ne 'win32' -or $info.arch -ne $machineArch -or $info.entry -ne 'bin/qcode-engine.exe' -or $info.sha256 -notmatch '^[a-f0-9]{64}$' -or $info.binarySha256 -notmatch '^[a-f0-9]{64}$'){throw 'Invalid or incompatible OpenCode bundle'}
    $archive=Join-Path $Source 'opencode-bundle.zip'
    if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $info.sha256){throw 'OpenCode bundle checksum mismatch'}
    $runtime=Join-Path $Destination 'opencode'
    Expand-CheckedArchive $archive $runtime
    $embedded=Get-Content -LiteralPath (Join-Path $runtime 'qcode-runtime.json') -Raw|ConvertFrom-Json
    if($embedded.version -ne $info.version -or $embedded.commit -ne $info.commit -or (Get-FileHash -LiteralPath (Join-Path $runtime $info.entry) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $info.binarySha256){throw 'OpenCode payload does not match its metadata'}
}
function Install-TuiRuntime($Source,$Destination){
    $metadata=Join-Path $Source 'tui-bundle.json'
    if(-not (Test-Path -LiteralPath $metadata)){throw 'TUI bundle is missing; download the complete QCode installer'}
    $info=Get-Content -LiteralPath $metadata -Raw|ConvertFrom-Json
    $machineArch=if($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64'){'arm64'}else{'x64'}
    if($info.platform -ne 'win32' -or $info.arch -ne $machineArch -or $info.entry -ne 'node_modules/@deepseek-ai/dsh/lib/bin.js' -or $info.sha256 -notmatch '^[a-f0-9]{64}$'){throw 'Invalid or incompatible TUI bundle'}
    $archive=Join-Path $Source 'tui-bundle.zip'
    if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $info.sha256){throw 'TUI bundle checksum mismatch'}
    $runtime=Join-Path $Destination 'harness-tui'
    Expand-CheckedArchive $archive $runtime
    $embedded=Get-Content -LiteralPath (Join-Path $runtime 'qcode-tui-runtime.json') -Raw|ConvertFrom-Json
    $core=Get-Content -LiteralPath (Join-Path $runtime 'node_modules/@deepseek-ai/dsh/package.json') -Raw|ConvertFrom-Json
    $plugin=Get-Content -LiteralPath (Join-Path $runtime 'node_modules/@deepseek-harness-tui/dsh-tui/package.json') -Raw|ConvertFrom-Json
    if($embedded.lockSha256 -ne $info.lockSha256 -or $core.version -ne $info.harnessVersion -or $plugin.version -ne $info.tuiVersion -or -not (Test-Path -LiteralPath (Join-Path $runtime $info.entry))){throw 'TUI runtime does not match its metadata'}
}
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
$lockPath=Join-Path $InstallRoot 'install.lock'
try{$installLock=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch{throw 'Another QCode installer is running'}
try{
    $current=if(Test-Path -LiteralPath $pointerFile){Get-Content -LiteralPath $pointerFile -Raw|ConvertFrom-Json}else{$null}
    if($Uninstall){
        foreach($name in @('qcode.cmd','qcodeweb.cmd','bootstrap.ps1')){$target=Assert-Child (Join-Path $bin $name);if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target}}
        if(-not $NoPath){$entries=@([Environment]::GetEnvironmentVariable('Path','User') -split ';'|Where-Object{$_ -and $_ -ne $bin});[Environment]::SetEnvironmentVariable('Path',($entries -join ';'),'User');if(Test-Path -LiteralPath $shortcutFile){Remove-Item -LiteralPath $shortcutFile}}
        Write-Host 'QCode command removed. Projects, encrypted sessions and runtime files were preserved.';return
    }
    if($Rollback){
        if(-not $current.previous -or $current.previous -notmatch '^\d+\.\d+\.\d+$'){throw 'No previous QCode release is available'}
        $previousDir=Assert-Child (Join-Path $InstallRoot "versions/$($current.previous)")
        if(-not (Test-Path -LiteralPath (Join-Path $previousDir 'qcode.ps1'))){throw 'Previous release is incomplete'}
        Write-JsonFile $pointerFile @{version=$current.previous;previous=$current.version};Write-Host "Rolled back to QCode $($current.previous). Restart the client.";return
    }
    if(-not $Gateway){$settings=Join-Path $InstallRoot 'settings.json';if(Test-Path -LiteralPath $settings){$Gateway=(Get-Content -LiteralPath $settings -Raw|ConvertFrom-Json).gateway}}
    if(-not $Gateway){$Gateway=Read-Host 'Company QCode gateway URL'}
    $address=[Uri]$Gateway
    if(-not $address.IsAbsoluteUri -or $address.Scheme -notin @('http','https') -or $address.UserInfo -or $address.Query -or $address.Fragment -or $address.AbsolutePath -ne '/'){throw 'Invalid gateway origin'}
    $Gateway=$Gateway.TrimEnd('/')
    Invoke-RestMethod "$Gateway/health" -TimeoutSec 15|Out-Null
    $source=$PSScriptRoot
    if($Update){
        $manifest=Invoke-RestMethod "$Gateway/downloads/manifest.json" -TimeoutSec 15
        $installerRuntime=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release.json') -Raw|ConvertFrom-Json).runtime
        if($installerRuntime -eq 'opencode' -and $manifest.runtime -ne 'opencode'){throw 'Update contains an incompatible runtime'}
        if($manifest.version -notmatch '^\d+\.\d+\.\d+$' -or $manifest.sha256 -notmatch '^[a-f0-9]{64}$' -or $manifest.downloadUrl -notmatch '^/downloads/qcode-client-\d+\.\d+\.\d+\.zip$'){throw 'Invalid release manifest'}
        if($current -and [version]$manifest.version -le [version]$current.version){Write-Host 'QCode is already current.';return}
        $version=$manifest.version
        $cache=Assert-Child (Join-Path $InstallRoot ('downloads/'+[guid]::NewGuid().ToString('N')))
        New-Item -ItemType Directory -Force -Path $cache|Out-Null
        $archive=Join-Path $cache 'client.zip'
        Invoke-WebRequest "$Gateway$($manifest.downloadUrl)" -OutFile $archive -UseBasicParsing -TimeoutSec 180
        if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256){throw 'Client archive checksum mismatch'}
        $source=Join-Path $cache 'source';Expand-CheckedArchive $archive $source
        $releaseInfo=Get-Content -LiteralPath (Join-Path $source 'release.json') -Raw|ConvertFrom-Json
        if($releaseInfo.version -ne $version){throw 'Downloaded client version does not match the manifest'}
        if(($manifest.runtime -eq 'opencode') -ne ($releaseInfo.runtime -eq 'opencode')){throw 'Downloaded client runtime does not match the manifest'}
    }
    $isOpenCode=(Get-Content -LiteralPath (Join-Path $source 'release.json') -Raw|ConvertFrom-Json).runtime -eq 'opencode'
    $target=Assert-Child (Join-Path $InstallRoot "versions/$version")
    if(Test-Path -LiteralPath $target){
        $installed=Join-Path $target '.qcode-release.json'
        if(-not (Test-Path -LiteralPath $installed)){throw 'Release directory already exists without an ownership marker; refusing to overwrite'}
        if($isOpenCode){
            $desired=Get-Content -LiteralPath (Join-Path $source 'opencode-bundle.json') -Raw|ConvertFrom-Json
            $saved=Get-Content -LiteralPath (Join-Path $target 'opencode-bundle.json') -Raw|ConvertFrom-Json
            if($desired.sha256 -ne $saved.sha256){throw 'This version contains a different OpenCode build; publish a new client version'}
            $entry=Join-Path $target 'opencode/bin/qcode-engine.exe'
            if(-not (Test-Path -LiteralPath $entry)){Install-OpenCodeRuntime $source $target}
            elseif((Get-FileHash -LiteralPath $entry -Algorithm SHA256).Hash.ToLowerInvariant() -ne $saved.binarySha256){throw 'Installed OpenCode checksum mismatch'}
        }else{
        $desiredRuntime=Join-Path $source 'harness-bundle.json';$installedRuntime=Join-Path $target 'harness-bundle.json'
        if((Test-Path -LiteralPath $desiredRuntime) -and (Test-Path -LiteralPath $installedRuntime)){
            if((Get-Content -LiteralPath $desiredRuntime -Raw|ConvertFrom-Json).sha256 -ne (Get-Content -LiteralPath $installedRuntime -Raw|ConvertFrom-Json).sha256){throw 'This release version already contains a different Harness build; publish a new client version'}
        }
        if(-not (Test-Path -LiteralPath (Join-Path $target 'harness-custom/lib/bin.js'))){Install-CustomRuntime $source $target}
        $desiredTui=Get-Content -LiteralPath (Join-Path $source 'tui-bundle.json') -Raw|ConvertFrom-Json
        $installedTui=Get-Content -LiteralPath (Join-Path $target 'tui-bundle.json') -Raw|ConvertFrom-Json
        if($desiredTui.sha256 -ne $installedTui.sha256){throw 'This version contains a different TUI build; publish a new client version'}
        if(-not (Test-Path -LiteralPath (Join-Path $target 'harness-tui/node_modules/@deepseek-ai/dsh/lib/bin.js'))){Install-TuiRuntime $source $target}
        }
    }else{
        $stage=Assert-Child (Join-Path $InstallRoot ('versions/stage-'+[guid]::NewGuid().ToString('N')))
        New-Item -ItemType Directory -Force -Path $stage|Out-Null
        foreach($file in Get-ChildItem -LiteralPath $source -File){if($file.Extension -in @('.ps1','.cmd','.mjs','.json','.md')){Copy-Item -LiteralPath $file.FullName -Destination $stage}}
        if($isOpenCode){Install-OpenCodeRuntime $source $stage}else{
        $harnessSource=Join-Path $source 'harness';$harnessStage=Join-Path $stage 'harness';New-Item -ItemType Directory -Force -Path $harnessStage|Out-Null
        foreach($file in @('package.json','package-lock.json')){Copy-Item -LiteralPath (Join-Path $harnessSource $file) -Destination $harnessStage}
        Install-CustomRuntime $source $stage
        Install-TuiRuntime $source $stage
        }
        Write-JsonFile (Join-Path $stage '.qcode-release.json') @{version=$version;installedAt=[DateTime]::UtcNow.ToString('o')}
        Move-Item -LiteralPath $stage -Destination $target
    }
    $architecture=if($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64'){'arm64'}else{'x64'}
    $nodeDirectory=Assert-Child (Join-Path $InstallRoot "runtime/node-v24.19.0-win-$architecture")
    $node=Join-Path $nodeDirectory 'node.exe'
    if(-not $SkipRuntime -and -not (Test-Path -LiteralPath $node)){
        $expected=if($architecture -eq 'arm64'){'8502f4a50b458d4cc38ed8f2001556c2cd239d464920f74017926ccb1e1c157f'}else{'57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73'}
        $runtimeRoot=Assert-Child (Join-Path $InstallRoot 'runtime');New-Item -ItemType Directory -Force -Path $runtimeRoot|Out-Null
        $nodeArchive=Join-Path $runtimeRoot "node-v24.19.0-win-$architecture.zip"
        $bundledNode=Join-Path $source "node-v24.19.0-win-$architecture.zip"
        if(Test-Path -LiteralPath $bundledNode){
            Write-Host 'Installing the bundled Node.js runtime...'
            Copy-Item -LiteralPath $bundledNode -Destination $nodeArchive -Force
        }elseif(Test-Path -LiteralPath (Join-Path $source 'node-bundle.json')){
            throw 'Bundled Node runtime is missing; download the complete installer again'
        }else{
            Write-Host 'Downloading the pinned Node.js runtime...'
            Invoke-WebRequest "https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-$architecture.zip" -OutFile $nodeArchive -UseBasicParsing -TimeoutSec 300
        }
        if((Get-FileHash -LiteralPath $nodeArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'Node runtime checksum mismatch'}
        # This official archive has already passed the pinned SHA-256 check.
        # .NET extraction avoids PowerShell per-file overhead in Node's npm tree.
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $nodeStage=Assert-Child (Join-Path $runtimeRoot ('stage-'+[guid]::NewGuid().ToString('N')))
        try{
            [IO.Compression.ZipFile]::ExtractToDirectory($nodeArchive,$nodeStage)
            if(Test-Path -LiteralPath $nodeDirectory){throw 'An incomplete Node runtime exists; remove that private runtime directory and retry'}
            Move-Item -LiteralPath (Join-Path $nodeStage "node-v24.19.0-win-$architecture") -Destination $nodeDirectory
        }finally{if(Test-Path -LiteralPath $nodeStage){Remove-Item -LiteralPath $nodeStage -Recurse -Force}}
    }
    if(-not $isOpenCode -and -not $SkipHarness -and -not (Test-Path -LiteralPath (Join-Path $target 'harness-custom/lib/bin.js'))){
        if(-not (Test-Path -LiteralPath $node)){if($env:QCODE_NODE){$node=$env:QCODE_NODE}else{throw 'A Node.js runtime is required to install Harness'}}
        $harness=Assert-Child (Join-Path $target 'harness');New-Item -ItemType Directory -Force -Path $harness|Out-Null
        $desiredLock=Join-Path $target 'harness/package-lock.json';$savedLock=Join-Path $harness 'package-lock.json'
        $needsInstall=-not (Test-Path -LiteralPath (Join-Path $harness 'node_modules/@deepseek-ai/dsh/lib/bin.js'))
        if(-not (Test-Path -LiteralPath $savedLock) -or (Get-FileHash -LiteralPath $savedLock).Hash -ne (Get-FileHash -LiteralPath $desiredLock).Hash){$needsInstall=$true}
        if($needsInstall){
            # npm ci uses the reviewed lockfile and verifies package integrity hashes.
            # Dependencies belong to this release, so rollback switches the runtime too.
            $npm=Join-Path (Split-Path $node -Parent) 'node_modules/npm/bin/npm-cli.js'
            $oldPath=$env:PATH
            try{$env:PATH=(Split-Path $node -Parent)+';'+$env:PATH;& $node $npm ci --prefix $harness --no-audit --no-fund;if($LASTEXITCODE -ne 0){throw 'Harness dependency installation failed'}}finally{$env:PATH=$oldPath}
        }
    }
    if($isOpenCode){
        $engine=Join-Path $target 'opencode/bin/qcode-engine.exe'
        $expectedVersion=(Get-Content -LiteralPath (Join-Path $target 'opencode-bundle.json') -Raw|ConvertFrom-Json).version
        $actualVersion=& $engine --version
        if($LASTEXITCODE -ne 0 -or ($actualVersion -join '').Trim() -ne $expectedVersion){throw 'OpenCode startup verification failed; current release was not changed'}
    }else{
    $customEntry=Join-Path $target 'harness-custom/lib/bin.js'
    if(Test-Path -LiteralPath $customEntry){
        if(-not (Test-Path -LiteralPath $node)){if($env:QCODE_NODE){$node=$env:QCODE_NODE}else{throw 'Node is required to verify the custom runtime'}}
        & $node $customEntry --help | Out-Null
        if($LASTEXITCODE -ne 0){throw 'Custom Harness startup verification failed; current release was not changed'}
    }
    & $node (Join-Path $target 'harness-tui/node_modules/@deepseek-ai/dsh/lib/bin.js') --help | Out-Null
    if($LASTEXITCODE -ne 0){throw 'TUI core startup verification failed; current release was not changed'}
    }
    New-Item -ItemType Directory -Force -Path $bin|Out-Null
    Copy-Item -LiteralPath (Join-Path $target 'bootstrap.ps1') -Destination $bin -Force
    [IO.File]::WriteAllText((Join-Path $bin 'qcode.cmd'),"@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0bootstrap.ps1`" %*`r`n",[Text.Encoding]::ASCII)
    [IO.File]::WriteAllText((Join-Path $bin 'qcodeweb.cmd'),"@echo off`r`ncall `"%~dp0qcode.cmd`" web %*`r`n",[Text.Encoding]::ASCII)
    Write-JsonFile $pointerFile @{version=$version;previous=$(if($current -and $current.version -ne $version){$current.version}else{$current.previous})}
    Write-JsonFile (Join-Path $InstallRoot 'settings.json') @{gateway=$Gateway}
    if(-not $NoPath){
        $entries=@([Environment]::GetEnvironmentVariable('Path','User') -split ';'|Where-Object{$_ -and $_ -ne $bin});[Environment]::SetEnvironmentVariable('Path',(($entries+$bin) -join ';'),'User')
        $shell=New-Object -ComObject WScript.Shell;$shortcut=$shell.CreateShortcut($shortcutFile);$shortcut.TargetPath=Join-Path $bin 'qcode.cmd';$shortcut.Arguments='web';$shortcut.Save()
    }
    Write-Host "QCode $version installed. Open a new terminal and run qcode (TUI) or qcode web."
}finally{$installLock.Dispose();if(Test-Path -LiteralPath $lockPath){Remove-Item -LiteralPath $lockPath}}
