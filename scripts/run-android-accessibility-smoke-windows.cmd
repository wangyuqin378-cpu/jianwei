@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-android-accessibility-smoke-windows.ps1" %*
exit /b %errorlevel%
