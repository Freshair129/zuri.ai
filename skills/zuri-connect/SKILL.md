---
name: zuri-connect
description: Use FIRST, before any other Zuri work — connect this harness (Claude Code, Codex, Gemini CLI, any MCP client) to a Zuri instance, verify which authenticated viewer it acts as, and list the scopes that viewer may write to. Triggers - "connect to zuri", "zuri login", "set up the zuri connector", "which zuri am I talking to", "zuri says 401/AUTH_REQUIRED", "ต่อ zuri", "เชื่อม zuri".
---

# Connect this harness to Zuri

Zuri accepts agent artifacts through **one** door per instance and re-authenticates
**every** request. There is no agent API key, no bearer token, and no way for an agent
to name the identity it wants to be. You connect a session that a human already owns,
you confirm what it can reach, and you stop when it cannot reach something.

## 1. Establish the three facts before anything else

| Fact | How you get it | If missing |
|---|---|---|
| Instance URL | the human tells you — `ZURI_BASE_URL` | ask; never guess between dev and production |
| Session | a session the human owns — `ZURI_SESSION_COOKIE` | ask; never fabricate, never reuse another instance's |
| Target scope | `workspaceId` you were given, or `scope.workspaceCode` in the artifact | ask; never pick "the only one you can see" |

Put both values in the harness's environment or secret store. **Never** write them into
the repository, a plan file, a commit, or a log line you print back.

## 2. Wire the connector

The MCP endpoint is `POST {ZURI_BASE_URL}/api/mcp` (Streamable HTTP, protocol
`2024-11-05`). It exposes exactly two tools — `project_manager.plan_dry_run` and
`project_manager.plan_commit` — and nothing else. Per-harness configuration snippets:
[references/harness-connectors.md](references/harness-connectors.md).

Everything the MCP tools do not cover (dates, approvals, reads) goes over the same-origin
REST routes with the same session. Same viewer, same services, same audit trail.

## 3. Verify — do not assume

```bash
node skills/zuri-connect/scripts/zuri-verify-connection.mjs
```

It prints the resolved viewer (role, owned vs visible Business ids, operator flag), the
workspaces that viewer can see, and the MCP handshake result. A green run is the only
evidence that "connected" is true. Report the instance URL and the viewer summary to the
human before you write anything.

## 4. Read the refusals literally

| Response | Meaning | What you do |
|---|---|---|
| `401 AUTH_REQUIRED` | no authenticated session reached the server | stop; ask the human to supply a session. Do not retry, do not switch endpoints |
| `503 SESSION_UNAVAILABLE` | the instance's session adapter is not configured | stop and report; this is an operator problem, not yours |
| `-32002 MCP session is not initialized` | you skipped `notifications/initialized`, or the server restarted | re-run the handshake from `initialize` |
| `404` on a scope you expected | the target does not exist **or** you were not given it — deliberately indistinguishable | stop; ask for the target id. Never enumerate to find out which |
| `403` | the viewer lacks authority there | report the refusal. Never look for a second route to the same write |

## Hard rules

- **One instance per task.** Never hold a dev and a production connection open in the same
  run, and never move an id from one instance to the other.
- **Never write to the database directly** (Prisma, psql, Supabase console) to work around
  a refusal. Every legitimate write goes through a service that records an audit event.
- **The local demo cookie** (`zuri_local_demo_session=enabled`) only exists when the
  instance runs with `ZURI_LOCAL_DEMO_AUTH=1` outside production. It resolves a
  development-fallback owner viewer. Use it for local work only, and say so in your report
  whenever a result came from it.
- **Session ids are not grants.** An MCP session id is a protocol continuation token; the
  server re-authorizes every call. Nothing you cache widens what you may do.

## Next

Connected and verified → [zuri-execution-plan](../zuri-execution-plan/SKILL.md) to send
work, [zuri-schedule](../zuri-schedule/SKILL.md) to date it,
[zuri-approval](../zuri-approval/SKILL.md) to submit a human's decision.
