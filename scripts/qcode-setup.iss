#ifndef ClientVersion
  #error Build via scripts/build-installer.ps1
#endif

[Setup]
AppId={{A868EA29-3EDC-4FD4-98C0-5C9731645612}
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
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#BuildDirectory}\client.zip"; Flags: dontcopy
Source: "{#BuildDirectory}\bootstrap.ps1"; Flags: dontcopy
Source: "{#BuildDirectory}\gateway.txt"; Flags: dontcopy
Source: "{#ProjectRoot}\apps\client\uninstall.ps1"; DestDir: "{app}"; Flags: ignoreversion uninsneveruninstall
Source: "{#ProjectRoot}\apps\client\uninstall.cmd"; DestDir: "{app}"; Flags: ignoreversion uninsneveruninstall
Source: "{#ProjectRoot}\apps\client\branding\qcode.ico"; DestDir: "{app}"; Flags: ignoreversion uninsneveruninstall

[Icons]
Name: "{userdesktop}\QCode"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\bin\desktop.ps1"""; IconFilename: "{app}\qcode.ico"; Check: CreateShortcuts
Name: "{userprograms}\QCode\QCode"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\bin\desktop.ps1"""; IconFilename: "{app}\qcode.ico"; Check: CreateShortcuts
Name: "{userprograms}\QCode\卸载 QCode"; Filename: "{uninstallexe}"; IconFilename: "{app}\qcode.ico"; Check: CreateShortcuts

[Code]
function DefaultInstallDirectory(Param: String): String;
begin
  Result := GetEnv('QCODE_CLIENT_ROOT');
  if Result = '' then Result := ExpandConstant('{localappdata}\QCode');
end;

function CreateShortcuts: Boolean;
begin
  Result := GetEnv('QCODE_SETUP_NO_PATH') <> '1';
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
  Params: String;
begin
  Result := '';
  ExtractTemporaryFile('client.zip');
  ExtractTemporaryFile('bootstrap.ps1');
  ExtractTemporaryFile('gateway.txt');
  Params := '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\bootstrap.ps1') + '" -InstallRoot "' + WizardDirValue + '" -ManagedSetup';
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Params, '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
    Result := 'Unable to launch QCode installation. See the setup log.'
  else if ExitCode <> 0 then
    Result := 'QCode installation failed. See ' + WizardDirValue + '\logs for the reason. Existing data was retained.';
end;

function CleanupQCode: Boolean;
var
  ExitCode: Integer;
  Params: String;
begin
  { Called after Inno confirmation, before files and the registry entry are removed. }
  Params := '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\uninstall.ps1') + '" -InstallRoot "' + ExpandConstant('{app}') + '" -SystemUninstall';
  if UninstallSilent then Params := Params + ' -NonInteractive';
  if (ExpandConstant('{param:QCODEPURGE|0}') = '1') and
     (ExpandConstant('{param:QCODECONFIRM|}') = '删除全部 QCode 本地数据') then
    Params := Params + ' -RemoveAllData -ConfirmAllData "删除全部 QCode 本地数据"';
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Params, '', SW_SHOW, ewWaitUntilTerminated, ExitCode);
  if Result then Result := ExitCode = 0;
  if not Result then SuppressibleMsgBox('QCode uninstall was cancelled or failed. See %LOCALAPPDATA%\QCode-uninstall-logs. The system uninstall entry was retained.', mbError, MB_OK, IDOK);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    if not CleanupQCode then Abort;
end;
