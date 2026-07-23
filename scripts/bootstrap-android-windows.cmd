@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap-android-windows.ps1" %*
exit /b %errorlevel%
