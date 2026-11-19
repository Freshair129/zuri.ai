# CLAUDE.md — Working Guide for the Edge Local Runtime

## Product boundary

ADR-110 retires Edge Device pairing, device credentials and heartbeat, the device executor for LINE OA,
the Edge LINE webhook adapters, and harness surfaces. ADR-119 (amendment 1, owner instruction option X,
2026-11-16) additionally removes the Edge SmartGift catalog pricing engine, catalog build pipeline and
local catalog serving path: the local RAG service (:8888), its embed sidecars, the GenesisBlock MCP
server and the taxonomy tooling no longer exist, and the ADR-110 statement that `apps/edge` retains
a local Knowledge/RAG runtime is superseded for this app. The server-side Knowledge 17-stage pipeline,
GenesisRAG17, MSP/GKS and Business-scoped reads are unchanged.

The retained `apps/edge` scope is a local command-line runtime plus the Conversation executor that
answers only from the published GenesisRAG17 corpus of a server-derived Business scope. It claims no LINE
ingress, delivery, device enrollment, catalog pricing or authority in zuri.ai.

Read the root `AGENTS.md`, this app's `AGENTS.md`, ADR-110 D1, D4 and D5, and ADR-119 amendment 1 before
changing these boundaries. Treat older setup guides, RCAs, specs and implementation records as historical
evidence where they say they are retired, superseded or removed.

## Main source areas

- `src/answer/` — local answer generation over published evidence and the headless CLI integration (no MCP
  tool server).
- `src/conversation/` — the Conversation executor; Business turns read only the published corpus.
- `src/rag/genesis-rag.ts`, `src/rag/v4/{http-client,search,schema,embed-client,query-parser,price}.ts` —
  the retrieval client types the answer layer still uses; the service they spoke to is removed.
- `src/rag/genesisrag17/` — the published-corpus client (MSP stdio, product/record readers).
- `src/safety/`, `src/identity/`, `src/history/`, `src/delivery/`, `src/plugin/`, `src/cards/`,
  `src/queries/` — local safety, identity register, history, outbox, plugin and DuckDB card/query code.

## Removed (do not recreate without a new decision)

Edge pricing engine, `zuri-agent price`, the pricing HTTP service/page, the pricing MCP server, the SmartGift
catalog build/ingest/eval pipeline, `npm start`/`rag:serve`, the embed sidecars, `start-edge-stack.ps1`,
`start-genesis-mcp.bat`, `dist/mcp/genesis-mcp-server.js` and `zuri-agent taxonomy preview`.
