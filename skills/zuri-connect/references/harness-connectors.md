# Wiring the Zuri connector per harness

One endpoint for every harness: `POST {ZURI_BASE_URL}/api/mcp`, Streamable HTTP, MCP
protocol `2024-11-05`, tools `project_manager.plan_dry_run` and
`project_manager.plan_commit`.

Zuri authenticates the **session that the request carries** — there is no token exchange
and no per-agent credential. In practice that means the connector must send a cookie
header belonging to a session a human already established on that instance
(`ZURI_SESSION_COOKIE`). Keep it in the harness's secret store, never in the repo.

## Claude Code

```bash
claude mcp add --transport http zuri "$ZURI_BASE_URL/api/mcp" --header "Cookie: $ZURI_SESSION_COOKIE"
```

Check with `claude mcp list`; the two `project_manager.*` tools should appear in the
session's tool list.

## Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.zuri]
url = "https://zuri.example.com/api/mcp"
http_headers = { Cookie = "${ZURI_SESSION_COOKIE}" }
```

## Gemini CLI

`.gemini/settings.json` (project) or `~/.gemini/settings.json` (user):

```json
{
  "mcpServers": {
    "zuri": {
      "httpUrl": "https://zuri.example.com/api/mcp",
      "headers": { "Cookie": "$ZURI_SESSION_COOKIE" }
    }
  }
}
```

## Any other MCP client

Point it at the same URL with the same header. Header names and env interpolation differ
between clients — if yours cannot inject a header, fall back to the REST path below.

## No MCP client at all

The scripts in this pack speak plain HTTPS and need nothing but Node 18+:

```bash
export ZURI_BASE_URL="https://zuri.example.com"
export ZURI_SESSION_COOKIE="<cookie header value>"
node skills/zuri-connect/scripts/zuri-verify-connection.mjs
node skills/zuri-execution-plan/scripts/zuri-plan.mjs dry-run plan.json --http
```

`--http` uses `/api/import/dry-run` and `/api/import/commit`, which run the *same*
service functions the MCP tools call. Choosing a transport never changes what is
validated, what is written, or what is audited.

## Local development instance

```bash
# in the Zuri checkout, with ZURI_LOCAL_DEMO_AUTH=1 in .env.local
npm run dev
export ZURI_BASE_URL="http://localhost:3000"
export ZURI_SESSION_COOKIE="zuri_local_demo_session=enabled"
```

That cookie is refused outright when `NODE_ENV=production`. It is a local convenience,
never a production login, and any result obtained through it must be reported as such.
