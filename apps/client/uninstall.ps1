[CmdletBinding()]
param([string]$InstallRoot='', [switch]$RemoveAllData, [string]$ConfirmAllData='', [switch]$NonInteractive)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+[IO.Path]::PathSeparator+$env:PSModulePath
if(-not $InstallRoot){$InstallRoot=if(Test-Path -LiteralPath (Join-Path $PSScriptRoot '.qcode-install.json')){$PSScriptRoot}elseif($env:QCODE_CLIENT_ROOT){$env:QCODE_CLIENT_ROOT}else{Join-Path $env:LOCALAPPDATA 'QCode'}}
$InstallRoot=[IO.Path]::GetFullPath($InstallRoot).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
$logRoot=Join-Path $env:LOCALAPPDATA 'QCode-uninstall-logs'
New-Item -ItemType Directory -Force -Path $logRoot|Out-Null
$logFile=Join-Path $logRoot ("uninstall-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
$transcriptStarted=$false
$installLock=$null
function Assert-SafeInstallRoot {
    $root=[IO.Path]::GetPathRoot($InstallRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $protected=@($root,$env:USERPROFILE,$env:LOCALAPPDATA,$env:APPDATA,[Environment]::GetFolderPath('Desktop'))|Where-Object{$_}|ForEach-Object{[IO.Path]::GetFullPath($_).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)}
    if($protected -contains $InstallRoot){throw "拒绝卸载：安装目录指向受保护位置：$InstallRoot"}
    Assert-NoLinks $InstallRoot
    $marker=Join-Path $InstallRoot '.qcode-install.json'
    if(Test-Path -LiteralPath $InstallRoot){
        if(Test-Path -LiteralPath $marker -PathType Leaf){
            try{$owner=Get-Content -LiteralPath $marker -Raw|ConvertFrom-Json}catch{throw '拒绝卸载：QCode 安装标记已损坏'}
            if($owner.product -ne 'QCode' -or $owner.scope -ne 'CurrentUser'){throw '拒绝卸载：安装标记不属于 QCode 当前用户安装'}
        }else{
            # Older installers identify owned releases instead of the installation root.
            $pointer=Get-Content -LiteralPath (Join-Path $InstallRoot 'current.json') -Raw|ConvertFrom-Json
            if($pointer.version -notmatch '^\d+\.\d+\.\d+$'){throw '拒绝卸载：缺少有效 QCode 安装标记'}
            $release=Join-Path $InstallRoot "versions/$($pointer.version)"
            $saved=Get-Content -LiteralPath (Join-Path $release '.qcode-release.json') -Raw|ConvertFrom-Json
            if($saved.version -ne $pointer.version -or -not (Test-Path -LiteralPath (Join-Path $release 'qcode.ps1'))){throw '拒绝卸载：旧版本所有权校验失败'}
        }
    }
}
function Assert-NoLinks([string]$Path){
    $cursor=[IO.Path]::GetFullPath($Path)
    while($cursor){
        if(Test-Path -LiteralPath $cursor){$item=Get-Item -LiteralPath $cursor -Force;if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "拒绝删除链接或联接路径：$cursor"}}
        $cursor=[IO.Path]::GetDirectoryName($cursor)
    }
    if(Test-Path -LiteralPath $Path -PathType Container){
        foreach($item in Get-ChildItem -LiteralPath $Path -Force){
            if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "拒绝删除含链接或联接的目录：$($item.FullName)"}
            if($item.PSIsContainer){Assert-NoLinks $item.FullName}
        }
    }
}
function Remove-IfPresent([string]$Path,[switch]$Recurse){
    $resolved=[IO.Path]::GetFullPath($Path)
    if(-not $resolved.StartsWith($InstallRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw "拒绝删除安装目录之外的路径：$resolved"}
    Assert-NoLinks $resolved
    if(Test-Path -LiteralPath $resolved){Remove-Item -LiteralPath $resolved -Force -Recurse:$Recurse}
}
function Remove-Shortcut([string]$Path){
    if(-not (Test-Path -LiteralPath $Path -PathType Leaf)){return}
    $shell=New-Object -ComObject WScript.Shell;$shortcut=$shell.CreateShortcut($Path);$target=[IO.Path]::GetFullPath($shortcut.TargetPath);if($target.StartsWith($InstallRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){Remove-Item -LiteralPath $Path -Force}
}
try{
    Start-Transcript -LiteralPath $logFile -Force|Out-Null;$transcriptStarted=$true
    Write-Host "QCode 卸载日志：$logFile"
    Assert-SafeInstallRoot
    if(-not (Test-Path -LiteralPath $InstallRoot)){Write-Host 'QCode 已卸载，无需再次清理。' -ForegroundColor Green;exit 0}
    $lockPath=Join-Path $InstallRoot 'install.lock'
    try{$installLock=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch{throw '另一个 QCode 安装或卸载正在运行，请稍后重试'}
    if(-not $NonInteractive -and -not $RemoveAllData){Write-Host '1. 卸载 QCode（默认，保留个人配置与登录会话）';Write-Host '2. 删除全部 QCode 本地数据（包含登录 Token）';if((Read-Host '请选择 [1]') -eq '2'){$RemoveAllData=$true}}
    if($RemoveAllData){if(-not $ConfirmAllData -and -not $NonInteractive){$ConfirmAllData=Read-Host '此操作不可恢复。请输入“删除全部 QCode 本地数据”继续'};if($ConfirmAllData -cne '删除全部 QCode 本地数据'){throw '未收到正确的完整数据删除确认，已取消卸载'}}
    Write-Host "卸载目录：$InstallRoot"
    # Never remove user workspaces or arbitrary files inside a custom installation root.
    if($RemoveAllData){Write-Host '用户项目及 workspace 目录始终保留。'}
    foreach($file in Get-ChildItem -LiteralPath $InstallRoot -Filter 'running.lock' -Recurse -File){
        $runningPid=0
        if(-not [int]::TryParse((Get-Content -LiteralPath $file.FullName -Raw).Trim(),[ref]$runningPid)){throw "运行锁损坏，请先检查：$($file.FullName)"}
        if(Get-Process -Id $runningPid -ErrorAction SilentlyContinue){throw "QCode 仍在运行（PID $runningPid），请先关闭客户端"}
    }
    $versions=Join-Path $InstallRoot 'versions'
    if(Test-Path -LiteralPath $versions){foreach($release in Get-ChildItem -LiteralPath $versions -Force){
        if(-not $release.PSIsContainer -or $release.Name -notmatch '^\d+\.\d+\.\d+$' -or -not (Test-Path -LiteralPath (Join-Path $release.FullName '.qcode-release.json'))){throw "拒绝删除无法确认所有权的版本：$($release.FullName)"}
        $metadata=Get-Content -LiteralPath (Join-Path $release.FullName '.qcode-release.json') -Raw|ConvertFrom-Json
        if($metadata.version -ne $release.Name){throw "版本所有权标记不匹配：$($release.FullName)"}
    }}
    if(-not (Test-Path -LiteralPath (Join-Path $InstallRoot '.qcode-install.json'))){
        $utf8=New-Object Text.UTF8Encoding($false)
        [IO.File]::WriteAllText((Join-Path $InstallRoot '.qcode-install.json'),'{"product":"QCode","scope":"CurrentUser"}',$utf8)
    }
    $bin=Join-Path $InstallRoot 'bin';$pathChanged=$false
    $entries=@([Environment]::GetEnvironmentVariable('Path','User') -split ';'|Where-Object{
        if(-not $_){return $true}
        try{$isQCodeBin=[IO.Path]::GetFullPath($_.Trim().Trim('"')).TrimEnd('\') -eq $bin.TrimEnd('\')}catch{$isQCodeBin=$false}
        if($isQCodeBin){$pathChanged=$true;return $false};return $true
    })
    if($pathChanged){[Environment]::SetEnvironmentVariable('Path',($entries -join ';'),'User')}
    Remove-Shortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'QCode.lnk')
    $programs=[Environment]::GetFolderPath('Programs')
    Remove-Shortcut (Join-Path $programs 'QCode\QCode.lnk')
    if($RemoveAllData){
        Remove-Shortcut (Join-Path $programs 'QCode\卸载 QCode.lnk')
        $startMenuDirectory=Join-Path $programs 'QCode';if((Test-Path -LiteralPath $startMenuDirectory) -and -not (Get-ChildItem -LiteralPath $startMenuDirectory -Force)){Remove-Item -LiteralPath $startMenuDirectory -Force}
        Remove-IfPresent (Join-Path $InstallRoot 'settings.json')
        foreach($gateway in Get-ChildItem -LiteralPath $InstallRoot -Directory | Where-Object{$_.Name -match '^[A-Fa-f0-9]{24}$'}){
            foreach($name in @('session.json','running.lock')){Remove-IfPresent (Join-Path $gateway.FullName $name)}
            $users=Join-Path $gateway.FullName 'users'
            if(Test-Path -LiteralPath $users){foreach($user in Get-ChildItem -LiteralPath $users -Directory | Where-Object{$_.Name -match '^(?:\d+|[A-Fa-f0-9]{32})$'}){
                foreach($name in @('opencode','harness','harness-tui','agents','agents-tui')){Remove-IfPresent (Join-Path $user.FullName $name) -Recurse}
            }}
        }
    }
    foreach($name in @('versions','runtime','downloads','bin')){Remove-IfPresent (Join-Path $InstallRoot $name) -Recurse}
    Remove-IfPresent (Join-Path $InstallRoot 'current.json')
    if($RemoveAllData){
        $installLock.Dispose();$installLock=$null
        Remove-IfPresent $lockPath
        foreach($name in @('uninstall.cmd','uninstall.ps1','.qcode-install.json','qcode.ico')){Remove-IfPresent (Join-Path $InstallRoot $name)}
        foreach($gateway in Get-ChildItem -LiteralPath $InstallRoot -Directory | Where-Object{$_.Name -match '^[A-Fa-f0-9]{24}$'}){
            $users=Join-Path $gateway.FullName 'users'
            if(Test-Path -LiteralPath $users){
                foreach($user in Get-ChildItem -LiteralPath $users -Directory | Where-Object{$_.Name -match '^(?:\d+|[A-Fa-f0-9]{32})$'}){if(-not (Get-ChildItem -LiteralPath $user.FullName -Force)){Remove-IfPresent $user.FullName}}
                if(-not (Get-ChildItem -LiteralPath $users -Force)){Remove-IfPresent $users}
            }
            if(-not (Get-ChildItem -LiteralPath $gateway.FullName -Force)){Remove-IfPresent $gateway.FullName}
        }
        if(-not (Get-ChildItem -LiteralPath $InstallRoot -Force)){Remove-Item -LiteralPath $InstallRoot -Force}
        Write-Host 'QCode 本地配置、会话及登录 Token 已删除；用户项目已保留。' -ForegroundColor Green
    }else{
        Write-Host 'QCode 程序、内置运行环境、启动快捷方式及 PATH 项已删除；个人配置、登录会话和“卸载 QCode”数据清理入口已保留。' -ForegroundColor Green
    }
    Write-Host "卸载日志：$logFile";exit 0
}catch{Write-Host "QCode 卸载失败：$($_.Exception.Message)" -ForegroundColor Red;Write-Host "卸载日志：$logFile";exit 1}finally{if($installLock){$installLock.Dispose();if(Test-Path -LiteralPath $lockPath){Remove-Item -LiteralPath $lockPath -Force}};if($transcriptStarted){Stop-Transcript|Out-Null}}
