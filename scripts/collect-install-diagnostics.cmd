@echo off
setlocal
set "PSModulePath="
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0collect-install-diagnostics.ps1"
if errorlevel 1 echo Please send a photo of this window if no report was created.
pause
