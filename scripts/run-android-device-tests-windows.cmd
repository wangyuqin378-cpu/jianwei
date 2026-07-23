@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-android-device-tests-windows.ps1" %*
exit /b %errorlevel%
