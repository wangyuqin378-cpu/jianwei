@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-android-talkback-smoke-windows.ps1" %*
exit /b %errorlevel%
