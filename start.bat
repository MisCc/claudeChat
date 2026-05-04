@echo off
cd /d "%~dp0"
set PATH=D:\software\nodejs;%APPDATA%\npm;%PATH%
node server.js
pause
