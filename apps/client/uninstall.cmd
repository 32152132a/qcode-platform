@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" -InstallRoot "%~dp0."
set "qcode_exit=%errorlevel%"
echo.
if not "%qcode_exit%"=="0" echo QCode uninstall failed. See the reason and log path above.
pause
exit /b %qcode_exit%
