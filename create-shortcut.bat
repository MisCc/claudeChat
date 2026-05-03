@echo off
set SCRIPT_DIR=%~dp0

:: Generate icon via Node.js
node "%SCRIPT_DIR%generate-icon.js"

:: Create shortcut via PowerShell script
powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%create-shortcut.ps1"

echo.
echo Done! Double-click "Claude Chat" on Desktop to start.
pause
