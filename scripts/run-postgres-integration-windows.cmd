@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-postgres-integration-windows.ps1" %*
exit /b %errorlevel%
