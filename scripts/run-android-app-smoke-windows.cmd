@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-android-app-smoke-windows.ps1" %*
exit /b %errorlevel%
