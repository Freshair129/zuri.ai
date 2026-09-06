@echo off
set "PATH=C:\Users\freshair\AppData\Local\GoVibeToolchains\node-v24.16.0-win-x64;%PATH%"
cd /d "D:\workspace\zuri-edge-llm"

echo =====================================================================
echo       🚀 GENESISBLOCK MCP SERVER (Model Context Protocol)
echo =====================================================================
echo [*] Mode: Remote SSE Server (Port 8989)
echo [*] Protocol Endpoint: http://localhost:8989/sse
echo.

node dist/mcp/genesis-mcp-server.js --port 8989
pause
