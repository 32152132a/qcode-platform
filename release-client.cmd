@echo off
setlocal
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0scripts\release-interactive.ps1"
set "release_exit=%errorlevel%"
echo.
pause
exit /b %release_exit%
