@echo off
setlocal

REM Compatibility entry point for the local conversation and RAG stack.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-edge-stack.ps1"
exit /b %errorlevel%
