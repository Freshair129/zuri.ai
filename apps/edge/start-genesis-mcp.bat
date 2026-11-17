@echo off
setlocal
cd /d "%~dp0"

echo =====================================================================
echo       🚀 GENESISBLOCK MCP SERVER (Model Context Protocol)
echo =====================================================================
echo [*] Mode: HTTP/SSE (Port 8989)
if defined GENESIS_MCP_HOST (
  echo [*] Bind host configured through GENESIS_MCP_HOST
) else (
  echo [*] Default bind host: 127.0.0.1
)
if defined GENESIS_MCP_TOKEN echo [*] Bearer authentication is enabled
echo.

node dist/mcp/genesis-mcp-server.js --port 8989
if errorlevel 1 echo [!] MCP server exited with an error.
pause
