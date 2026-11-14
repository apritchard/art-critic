@echo off
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get version 22.12 or newer from https://nodejs.org/
  goto fail
)
if not exist node_modules (
  call npm install
  if errorlevel 1 goto fail
)
call npm run dev -- --open
if errorlevel 1 goto fail
exit /b 0

:fail
pause
exit /b 1
