# CLAUDE.md — Working Guide for Zuri Edge Device

## Current runtime topology — upstream ADR-061

The owner-authorized server transport decision is documented in
`docs/SERVER-LINE-OPTIONAL-EDGE.md`. Compute-only is now the runtime default: Zuri owns LINE
credentials, ingress, delivery and CRM; this optional device pulls leased conversation jobs.
References below to Edge LINE ownership describe explicitly selected `LEGACY_EDGE` migration
mode. They do not authorize direct sends from compute jobs. All secret, tenant, query, shell,
filesystem, approval and policy boundaries below remain applicable.


Read `AGENTS.md` for the full persona, governance, and architectural contracts (ADR-041).

## Overview

This repository (`zuri-edge-device` / `zuri-command-agent`) is the **Zuri Edge Device Node & Runtime Environment** for Zuri AI and SmartGift operations:
- **Zuri Edge Device**: The customer-premise hardware node paired with Zuri Cloud via Zero-Trust telemetry.
- **Zuri Edge Runtime**: Local background engine running GenesisBlock Graph Database, Codex CLI (`gpt-5.6-luna`), LINE Webhook Gateway, Web Config GUI (`:8787/gui`), and Live Graph Viewer (`:8787/graph`).
- **Zuri Edge Command**: CLI toolchain (`zuri-agent`) and MCP Server for Cursor / Claude Desktop.

---

## Directory Structure

```
├── .agents/                      # Multi-persona prompt definitions (e.g. zuri-01)
├── src/
│   ├── answer/                  # AI response generation, headless CLI runner, persona loader
│   ├── cli/                     # CLI commands (webhook serve, test-answer, etc.)
│   ├── mcp/                     # GenesisBlock MCP Server (SSE & Stdio)
│   ├── rag/                     # GenesisBlock Graph RAG engine & HQL queries
│   └── history/                 # LINE Webhook server, local JSONL archive, live graph API
├── edge-gui.html                # Local Web Config GUI (:8787/gui)
├── graph-viewer.html            # Live Interactive Knowledge Graph Viewer UI (:8787/graph)
├── start-edge-device.bat        # 1-Click launcher for Zuri Edge Device Runtime
└── start-genesis-mcp.bat        # 1-Click launcher for GenesisBlock MCP Server
```

---

## Common Commands & Workflows

### 1. Run Local Edge Runtime (Webhook + RAG)
```bash
# Health-gated and idempotent: starts embed sidecar -> RAG service -> webhook, skipping whatever is
# already answering. `-Install` registers it as a Scheduled Task at logon so a reboot restores it.
powershell -ExecutionPolicy Bypass -File scripts/start-edge-stack.ps1
```

```bash
# Or manual execution:
npm run build
node dist/cli/index.js webhook serve
```

The `start-edge-*.bat` scripts belong to the retired dev machine (`desktop-8ur61u8`): they hardcode
that machine's user and `D:` drive, and force-kill every `node` process on the box. Do not run them.

### 2. Run GenesisBlock MCP Server
```bash
# Remote SSE server on port 8989
.\start-genesis-mcp.bat

# Stdio mode (for local Claude Desktop / Cursor MCP config)
node dist/mcp/genesis-mcp-server.js
```

### 3. Public Ingress (Tailscale Funnel)
```bash
# Publishes ONE path. Anything wider exposes the config surface to the internet.
tailscale funnel --bg --set-path=/webhook/line 8787
tailscale funnel status        # must list /webhook/line and nothing else
```

The Cloudflare command that used to be here named a binary under `C:\Users\freshair\...`, which is
the retired dev machine. `zuri.app` is registered with GoDaddy, so a named Cloudflare tunnel would
need the domain moved; Tailscale Funnel needs neither.

---

## Key Endpoints

**Everything except `/` and `POST /webhook/line` requires the operator key** (`ZURI_EDGE_ADMIN_KEY_HASH`,
minted on first start and printed once to the runtime log). A browser gets a sign-in page; a script
sends `Authorization: Bearer zadm_...`. See `docs/EDGE-DEVICE-SETUP.md` section 4.

- **LINE Webhook**: `POST /webhook/line` (Instant 200 OK ACK with non-blocking AI answer). Open —
  authenticated by LINE's request signature, not the operator key. The only path the Funnel publishes.
- **Device liveness**: `POST $ZURI_CLOUD_BASE_URL/api/agent/heartbeat` every 40s from `webhook serve`,
  presenting the minted `edgk_` device key. Reports `healthy` / `degraded` / `unavailable` from a real
  probe; the cloud drops a device from "online" after 120s without one. Silent when the device pair is
  not configured.
- **Live Knowledge Graph Viewer**: `GET /graph` or `GET /graph-viewer`
- **Live Graph API**: `GET /api/graph[?limit=N]` (Proxies the RAG service on :8888, which builds a bounded `{ nodes, edges }` sample of the GenesisBlock store. The webhook server cannot open the store itself — the engine locks it exclusively, even readOnly.)
- **Cloud Heartbeat**: `POST $ZURI_CLOUD_HEARTBEAT_URL` on launcher startup, skipped when unset. zuri-ai moved
  to a per-deployment origin (Docker Compose + ngrok, ADR-058), so there is no fixed platform URL any
  more — the old `zuri-ai-woad.vercel.app` address is retired. Set `ZURI_CLOUD_HEARTBEAT_URL` in `.env`
  to your own deployment's origin (see `.env.example`). The GUI's Cloud Console link (`ZURI_CLOUD_CONSOLE_URL`)
  follows the same rule.
