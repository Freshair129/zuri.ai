# CLAUDE.md — Working Guide for the Edge Local Runtime

## Product boundary

ADR-110 retires Edge Device pairing, device credentials and heartbeat, the device executor for LINE OA,
the Edge LINE webhook adapters, and harness surfaces. The retained `apps/edge` scope is local
Knowledge/RAG, GenesisBlock catalog access, and local command-line/MCP integrations. These components
do not claim LINE ingress, delivery, device enrollment, or authority in zuri.ai.

Read the root `AGENTS.md`, this app's `AGENTS.md`, and ADR-110 D1, D4, and D5 before changing these
boundaries. Treat older setup guides, RCAs, and implementation records as historical evidence where
they say they are retired or superseded.

## Main source areas

- `src/answer/` — local answer generation and headless CLI integration.
- `src/mcp/` — GenesisBlock MCP server over stdio or HTTP/SSE.
- `src/rag/` — local GenesisBlock and catalog Knowledge/RAG services.
- `scripts/start-edge-stack.ps1` — health-gated startup for the retained local RAG services.
- `start-genesis-mcp.bat` — launcher for the HTTP/SSE MCP mode.

## Local Knowledge/RAG

The retained RAG services can be started with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-edge-stack.ps1
```

This launcher checks service health and leaves an already-running service alone. It does not start a
device executor or a LINE webhook.

## GenesisBlock MCP server

Build before launching the compiled entry point:

```powershell
npm run build
```

Use stdio for a local Claude Desktop or Cursor integration:

```powershell
node dist/mcp/genesis-mcp-server.js
```

Use HTTP/SSE with the batch launcher:

```powershell
.\start-genesis-mcp.bat
```

HTTP/SSE defaults to `127.0.0.1`. Set `GENESIS_MCP_HOST` explicitly for a LAN bind; every non-loopback
bind requires `GENESIS_MCP_TOKEN` with at least 32 characters. A tunnel can forward to loopback, but
configure a token before exposing it. Whenever a token is configured, requests to `/sse` and
`/messages` must send `Authorization: Bearer <token>`. The public `/health` response contains only
`status` and `service`; a valid bearer token receives readiness detail. The MCP service does not
enable browser CORS access.

The MCP entry point reads these values from its process environment and does not load `.env`. For an
explicit LAN bind, replace the token placeholder with a unique generated value before launching:

```powershell
$env:GENESIS_MCP_HOST = '0.0.0.0'
$env:GENESIS_MCP_TOKEN = '<generate-a-unique-token-with-at-least-32-characters>'
.\start-genesis-mcp.bat
```

Never place a real token in the repository or print it in logs.
