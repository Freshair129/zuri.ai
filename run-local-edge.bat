@echo off
setlocal

set "NODE_DIR=C:\Users\freshair\AppData\Local\GoVibeToolchains\node-v24.16.0-win-x64"
if exist "%NODE_DIR%" (
    set "PATH=%NODE_DIR%;%PATH%"
)

cd /d "d:\workspace\zuri-edge-llm"
call "d:\workspace\zuri-edge-llm\start-edge-llm.bat"
