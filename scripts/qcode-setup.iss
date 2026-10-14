#ifndef ClientVersion
  #error Build via scripts/build-installer.ps1
#endif

#ifndef TestAppId
  #define IsTestBuild 0
  #define TestAppId "{{A868EA29-3EDC-4FD4-98C0-5C9731645612}"
#else
  #define IsTestBuild 1
#endif

[Setup]
AppId={#TestAppId}
AppName=QCode
AppVersion={#ClientVersion}
AppPublisher=QCode
DefaultDirName={code:DefaultInstallDirectory}
DefaultGroupName=QCode
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
WizardStyle=modern
SetupIconFile={#ProjectRoot}\apps\client\branding\qcode.ico
UninstallDisplayIcon={uninstallexe}
UninstallFilesDir={app}\.setup
OutputDir={#OutputDirectory}
OutputBaseFilename=QCodeSetup-{#ClientVersion}
Compression=lzma2
SolidCompression=yes
CloseApplications=no
RestartApplications=no
SetupLogging=yes
ChangesEnvironment=yes
MinVersion=10.0

[Languages]
Name: "chinesesimplified"; MessagesFile: "languages\ChineseSimplified.isl"

[Messages]
FinishedLabel=QCode 已安装完成。%n%n打开桌面或开始菜单中的 QCode，在网页中登录即可使用。离线安装不需要连接网关，登录和更新需要网络。
ConfirmUninstall=确定要卸载 QCode 吗？%n%n将删除程序与登录 Token，下次使用需重新登录。个人配置、历史会话和用户项目会保留。

[Files]
Source: "{#BuildDirectory}\client.zip"; Flags: dontcopy
Source: "{#BuildDirectory}\bootstrap.ps1"; Flags: dontcopy
Source: "{#BuildDirectory}\gateway.txt"; Flags: dontcopy
Source: "{#ProjectRoot}\apps\client\uninstall.ps1"; DestDir: "{app}"; Flags: ignoreversion uninsneveruninstall
Source: "{#ProjectRoot}\apps\client\uninstall.cmd"; DestDir: "{app}"; Flags: ignoreversion uninsneveruninstall
Source: "{#ProjectRoot}\apps\client\uninstall.vbs"; DestDir: "{app}"; Flags: ignoreversion uninsneveruninstall
Source: "{#ProjectRoot}\apps\client\branding\qcode.ico"; DestDir: "{app}"; Flags: ignoreversion uninsneveruninstall

[Icons]
Name: "{userdesktop}\QCode"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\bin\desktop.ps1"""; IconFilename: "{app}\qcode.ico"; Check: CreateShortcuts
Name: "{userprograms}\QCode\QCode"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\bin\desktop.ps1"""; IconFilename: "{app}\qcode.ico"; Check: CreateShortcuts
Name: "{userprograms}\QCode\卸载 QCode"; Filename: "{uninstallexe}"; IconFilename: "{app}\qcode.ico"; Check: CreateShortcuts

[Code]
var
  InstallProgress: TOutputProgressWizardPage;
  LastStage: String;

procedure InitializeWizard;
begin
  InstallProgress := CreateOutputProgressPage('正在安装 QCode', '请稍候，正在准备本地运行环境。');
end;

procedure InstallationOutput(const S: String; const Error, FirstLine: Boolean);
var
  Separator, Progress: Integer;
  Value, Stage: String;
begin
  Log(S);
  if Pos('QCODE_PROGRESS|', S) <> 1 then Exit;
  Value := Copy(S, 16, Length(S));
  Separator := Pos('|', Value);
  if Separator = 0 then Exit;
  Progress := StrToIntDef(Copy(Value, 1, Separator - 1), 0);
  Stage := Copy(Value, Separator + 1, Length(Value));
  if Stage = 'payload' then LastStage := '正在读取内置安装包（离线安装，无需下载）'
  else if Stage = 'extract' then LastStage := '正在解压安装文件'
  else if Stage = 'verify' then LastStage := '正在校验安装文件'
  else if Stage = 'runtime' then LastStage := '正在安装编程运行环境'
  else if Stage = 'node' then LastStage := '正在安装内置 Node 运行环境'
  else if Stage = 'activate' then LastStage := '正在保存配置并切换版本'
  else if Stage = 'complete' then LastStage := '安装完成，正在创建快捷方式';
  InstallProgress.SetText(LastStage, '详细记录保存在安装目录的 logs 文件夹。');
  InstallProgress.SetProgress(Progress, 100);
end;

function DefaultInstallDirectory(Param: String): String;
begin
  Result := GetEnv('QCODE_CLIENT_ROOT');
  if Result = '' then begin
#if IsTestBuild
    Result := ExpandConstant('{localappdata}\QCode-Tests\{#TestAppId}');
#else
    Result := ExpandConstant('{localappdata}\QCode');
#endif
  end;
end;

function CreateShortcuts: Boolean;
begin
  Result := (GetEnv('QCODE_SETUP_NO_PATH') <> '1') and ({#IsTestBuild} = 0);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
  Params: String;
begin
  Result := '';
  InstallProgress.SetText('正在准备离线安装包', '请稍候…');
  InstallProgress.SetProgress(0, 100);
  InstallProgress.Show;
  try
  ExtractTemporaryFile('client.zip');
  ExtractTemporaryFile('bootstrap.ps1');
  ExtractTemporaryFile('gateway.txt');
  Params := '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\bootstrap.ps1') + '" -InstallRoot "' + WizardDirValue + '" -ManagedSetup';
#if IsTestBuild
  Params := Params + ' -NoPath';
#endif
  if not ExecAndLogOutput(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Params, '', SW_HIDE, ewWaitUntilTerminated, ExitCode, @InstallationOutput) then
    Result := '无法启动安装程序。请检查系统权限，并查看安装日志：' + WizardDirValue + '\logs'
  else if ExitCode <> 0 then
    Result := LastStage + '时未能完成。请检查磁盘空间、文件占用和安装包完整性后重试。详细原因和日志：' + WizardDirValue + '\logs。个人数据会保留。';
  finally
    InstallProgress.Hide;
  end;
end;

function CleanupQCode: Boolean;
var
  ExitCode: Integer;
  Params: String;
begin
  { Called after Inno confirmation, before files and the registry entry are removed. }
  Params := '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\uninstall.ps1') + '" -InstallRoot "' + ExpandConstant('{app}') + '" -SystemUninstall -NonInteractive';
  if (ExpandConstant('{param:QCODEPURGE|0}') = '1') and
     (ExpandConstant('{param:QCODECONFIRM|}') = '删除全部 QCode 本地数据') then
    Params := Params + ' -RemoveAllData -ConfirmAllData "删除全部 QCode 本地数据"';
  Result := ExecAndLogOutput(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Params, '', SW_HIDE, ewWaitUntilTerminated, ExitCode, nil);
  if Result then Result := ExitCode = 0;
  if not Result then SuppressibleMsgBox('卸载未完成，请先关闭 QCode 并检查文件占用或目录安全问题。详细原因和日志：' + ExpandConstant('{localappdata}\QCode-uninstall-logs') + '。系统卸载入口已保留，可稍后重试。', mbError, MB_OK, IDOK);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    if not CleanupQCode then Abort;
end;
