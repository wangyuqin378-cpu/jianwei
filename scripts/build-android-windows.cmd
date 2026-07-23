@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-android-windows.ps1" %*
exit /b %errorlevel%
