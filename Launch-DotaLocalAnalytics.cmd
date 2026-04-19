@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%SCRIPT_DIR%Launch-DotaLocalAnalytics.ps1"
