@echo off
title Overdrive - Dev
cd /d "%~dp0.."
call npm run dev
if errorlevel 1 (
  echo.
  echo Overdrive dev se cerro con un error. Revisa el log de arriba.
  pause
)
