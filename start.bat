@echo off
setlocal
cd /d "%~dp0"
title Photos to 3D

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed. Opening nodejs.org: install the LTS version, then double-click start.bat again.
  start "" https://nodejs.org
  pause
  exit /b 1
)

node scripts\start.mjs
if errorlevel 1 (
  echo.
  echo Something went wrong. Copy the messages above to get help.
  pause
)
