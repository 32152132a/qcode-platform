Option Explicit
Dim shell, files, root, target, command, result
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
target = files.BuildPath(root, ".setup\unins000.exe")
If files.FileExists(target) Then
  result = shell.Run(Chr(34) & target & Chr(34) & " /NORESTART", 1, True)
Else
  command = "powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Chr(34) & files.BuildPath(root, "uninstall.ps1") & Chr(34) & " -InstallRoot " & Chr(34) & root & Chr(34) & " -NonInteractive -Gui"
  result = shell.Run(command, 0, True)
End If
WScript.Quit result
