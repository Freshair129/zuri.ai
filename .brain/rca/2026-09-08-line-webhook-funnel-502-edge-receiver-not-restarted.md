---
version: "0.2.0b"
created_at: "2026-09-08T19:05:00+07:00,CLAUDE"
last_update: "2026-09-09T01:20:00+07:00,CLAUDE"
status: "under review"
attributes:
  domain: "line-oa-studio"
  doc_type: "root-cause-analysis"
  scope: "LINE webhook delivery: the Tailscale Funnel URL answers 502 because no receiver listens on 8787 and the server-owned receiver is not live"
---

# RCA - LINE webhook Funnel 502: legacy edge receiver died and cannot come back; server receiver not live

## Complexity and risk

- **Complexity:** C-2 - topology diagnosis across the edge Funnel, the Compose stack and provider configuration; no code changed
- **Risk:** HIGH while open - customer LINE messages reach no automated receiver on either candidate URL; the restore itself is one launcher invocation

## Symptom

`https://desktop-vetatmq.tail71c7d1.ts.net/webhook/line` returned HTTP 502 to a read-only HEAD
request. The currently registered provider URL was not independently read from LINE. Affected-message
count, outage start time and provider redelivery state were unknown at open.

## Decisions consulted first

| Decision | What it says about this URL |
|---|---|
| ADR-058 D2 | The production webhook is `https://<NGROK_DOMAIN>/api/agent/line-webhook`, served by `web` through ngrok; "the separate zuri-cli transport ... owns the LINE channel credentials" |
| ADR-041 | The on-premise edge device hosts "LINE Messaging Ingress Webhooks" |
| ADR-061 point 3 | Server activation is explicit; "Disabling old processes and changing the LINE webhook in the provider console are deployment operations, not performed by merging this code"; old forwarding endpoints refuse an account whose server owner is enabled |
| ADR-061 activation | Requires the two migrations, a mounted credential entry, `ZURI_LINE_REPLY_SEAL_KEY`, `ZURI_LINE_WORKER_TOKEN`, `docker-compose.line-server.yml` with the `line-server` profile, then the console webhook change |
| line-oa-studio CHARTER | ADR-061 is the current transport authority; `transportMode` EDGE/CLOUD, one owner at a time; account health includes "last webhook" |
| Edge BR-009 / apps/edge/CLAUDE.md | The Funnel must publish `/webhook/line` alone; `tailscale funnel status` "must list /webhook/line and nothing else" |
| apps/edge/docs/EDGE-DEVICE-SETUP.md:231 | Names `https://desktop-vetatmq.tail71c7d1.ts.net/webhook/line` as the edge receiver's public URL |

So the URL under discussion is the **legacy edge receiver** (ADR-041, edge CLI `webhook serve` on port 8787),
not the Compose stack. ADR-058's URL is the edge-to-server forward seam, and the ADR-061 native route is a
third, distinct URL.

## Evidence (all times +07:00, Asia/Bangkok)

| When | Fact | Source |
|---|---|---|
| 2026-09-06 13:28:34 | Edge receiver `webhook serve` started, endpoint `0.0.0.0:8787/webhook/line`, outbox on | `zuri-edge-device/state/startup-logs/webhook.log` |
| 2026-09-06 10:33 (commit) | Edge launcher `scripts/start-edge-stack.ps1` gains `-TransportOwner` defaulting to `SERVER`; the webhook starts only under `LEGACY_EDGE`; the task description text changed | edge commit `4a6e7ca` |
| unknown (before 09-06) | Scheduled task `ZuriEdgeStack` registered by the earlier launcher; its action passes **no** `-TransportOwner`; its description is still the pre-`4a6e7ca` text "...LINE webhook) at logon" | `Get-ScheduledTask ZuriEdgeStack` |
| 2026-09-07 03:04 | Production `LineOaAccount` "Zuri" (`84ef8528-b1a2-4561-9137-8b7d327eed16`) last updated: `serverEnabled=true`, `transportMode=CLOUD`, `executionMode=EDGE`, status CONNECTED | read-only query inside `zuri-ai-web-1` |
| 2026-09-07 14:36:05 | Last inbound LINE event archived by the edge receiver (`receivedAt 07:36:05Z`) | `state/line-history/_dm/.../2026-W37.jsonl`, `webhook.log` mtime |
| 2026-09-07 23:32:57 | Last heartbeat line from the receiver; no error, no exit message; 3,214 heartbeats over its life | `webhook.log.err` (213 KB, 0 non-heartbeat lines in the last 400) |
| 2026-09-08 00:55:48 | Unexpected shutdown (System 6008; Kernel-Power 41, BugcheckCode 0); OS back 01:12:08 | Windows System log |
| 2026-09-08 05:52:17 | Second unexpected shutdown; OS back 06:27:00 | Windows System log |
| 2026-09-08 06:27:14 | `ZuriEdgeStack` ran, `LastTaskResult 1` ("stack came up INCOMPLETE"); embed sidecar delayed by TLS retries to huggingface.co; RAG up 06:31 with `embedReady:false`; **no** webhook, **no** conversation worker (no `conversation.log`) | task info, `startup-logs/*` |
| 2026-09-08 13:20:06 | `zuri-edge-device-v0.2.0-windows-x64.exe` (Tauri desktop app) started from Downloads; it binds nothing on 8787 | process table, `apps/edge/src-tauri` |
| 2026-09-08 17:40 | `zuri-ai-web:local` built from revision `0eb6c03a`; container healthy since 17:43; ngrok up | `docker inspect`, `compose ps` |
| 2026-09-08 18:49-19:02 | Funnel maps `/` to 5173, `/webhook/line` to 8787, `:8443/` to 8080; `/`, `/api/health`, `/webhook/line` all **502**; `127.0.0.1:8787` connection refused; nothing listens on 8787 or 5173 | `tailscale funnel status`, `netstat`, curl |
| same | ngrok `/api/health` 200; `HEAD /api/agent/line-webhook` 405; native `HEAD /api/line-oa/accounts/<id>/webhook` 405; unsigned empty `POST` there gives **503 LINE_WEBHOOK_NOT_ACCEPTED** | curl via ngrok |
| same | `web` container: `ZURI_LINE_SERVER_ENABLED` empty, `ZURI_LINE_SECRET_FILE` empty, no worker token, no seal key, no `/run/secrets`; `line-server` profile not running; `ZURI_LINE_BINDING_STATUS=PENDING` | container env (names only) |
| same | Production DB: 0 `LineConversationJob`, 0 `RawExternalRecord` rows ever; `zuri_core.line_channel_binding` LINE-SMARTGIFT-OA is PENDING | read-only query |
| same | ngrok inspection buffer (200 requests back to 10:53) holds no webhook POST; `web` logs show 0 webhook lines in 72 h | `127.0.0.1:4040/api/requests/http`, `docker logs` |
| same | Retired dev machine `desktop-8ur61u8` is online and its `/webhook/line` Funnel also answers 502; `:8443/` on this machine serves the `web-ui-smg` container publicly (200) | `tailscale status`, curl |

## Root cause

1. **The live LINE receiver was the legacy edge process and it stopped at 23:32:57 on 2026-09-07.** Nothing in its
   own logs explains the stop (no exception, no exit line); the machine then suffered two unexpected shutdowns.
   Whether it hung at 23:33 or was killed, it was gone by the 00:55 reset.
2. **Nothing can bring it back automatically.** The `ZuriEdgeStack` logon task still runs the launcher without
   `-TransportOwner`, and since edge commit `4a6e7ca` the launcher's default is `SERVER` (compute-only, per ADR-061).
   The task was never re-registered with `-Install -TransportOwner LEGACY_EDGE`, so every logon since the change
   starts the RAG dependencies and, at best, a conversation worker, never the 8787 listener. Today it did not even
   reach that step (`$ok=false` after the embed sidecar missed its 180 s budget).
3. **The successor receiver is not live either.** ADR-061's native route is deployed and reachable through ngrok,
   and the production account is flagged `serverEnabled=true` / `CLOUD`, but the running `web` container has none
   of the ADR-061 activation inputs, so `serverLinePorts()` throws `LINE_SERVER_DISABLED` and the route returns 503
   to every POST. No job or evidence row has ever been written server-side.

Net effect: the Funnel answers 502 on the URL LINE most likely still holds, and the ngrok URL would answer 503.
There is no working LINE receiver on either path.

## Where LINE most likely points

Not read from LINE (needs the channel access token, which lives in the edge checkout's `.env` - never read by an
agent - or the LINE Developers Console). Inference from evidence: the edge receiver kept receiving events until
14:36 on 2026-09-07, eleven hours **after** the account was flagged server-enabled in the database, and the server
has never admitted an event. So the console was not repointed when the flag was set, consistent with ADR-061
point 3, and the registered URL is very probably still the Funnel URL above.

## Still unknown, and how to close each gap (operator, read-only)

1. **Registered URL:** with the token from the edge `.env` (`LINE_CHANNEL_ACCESS_TOKEN`, or the `LINE_POC_` / `_FILE` variants read by `src/config/index.ts`):
   `GET https://api.line.me/v2/bot/channel/webhook/endpoint` returns `{ endpoint, active }`.
   Console path: LINE Developers, channel, Messaging API tab, Webhook URL. The console's **Verify** button POSTs to the registered URL and shows its status.
2. **Affected-message count:** LINE Developers, Messaging API tab, Webhook, error statistics. Our side stores nothing for events that never arrived (edge archive ends 14:36 on 09-07; server tables are empty). LINE Official Account Manager's chat inbox still holds the customers' messages if chat is enabled; check it for unanswered messages since that time.
3. **Redelivery:** a console toggle, off by default. If it is on, LINE has been retrying every non-2xx delivery with `deliveryContext.isRedelivery=true`; count and interval are undisclosed. If off, nothing since the outage start will be resent.
4. **Outage start:** bounded between 23:32:57 on 2026-09-07 (last heartbeat) and 00:55:48 on 2026-09-08 (reset). Since the 01:12 boot the Funnel has answered 502 rather than timing out, because `tailscaled` is up and 8787 is closed.

## Options (not executed - owner decision)

- **A. Restore the legacy receiver now** (minutes, no secrets): run the launcher with `-TransportOwner LEGACY_EDGE`, then re-register the task with `-Install -TransportOwner LEGACY_EDGE` so it survives the next logon. ADR-061 allows LEGACY_EDGE "only during the documented cutover"; that cutover has not happened, so this is the live path. Note ADR-061 point 3: the server refuses legacy forwarding for the server-enabled account, but the edge answers customers locally in this mode.
- **B. Complete the ADR-061 cutover** (hours, secrets and a console change): provision `ZURI_LINE_WORKER_TOKEN`, `ZURI_LINE_REPLY_SEAL_KEY`, `ZURI_LINE_SECRET_FILE_HOST` and the credential file; bring `web` up with `docker-compose.line-server.yml` and `--profile line-server`; run a canary; then set the console webhook to `https://unspirited-expostulatory-angila.ngrok-free.dev/api/line-oa/accounts/84ef8528-b1a2-4561-9137-8b7d327eed16/webhook` and stop the legacy receiver.

Either way, read the registered URL first.

## Related finding (security, not changed)

The Funnel publishes `/` to 5173 (dead) and `:8443/` to 8080, the `web-ui-smg` container, which answers the public
internet with 200. Edge BR-009 and `apps/edge/CLAUDE.md` require `/webhook/line` alone. The retired dev machine
`desktop-8ur61u8` is also still on the tailnet with its own dead `/webhook/line` Funnel.

## Why the issue escaped detection

- The receiver's heartbeat is outbound and proves liveness only while it is alive; nothing polls the Funnel URL from outside.
- The logon task runs hidden and its exit code 1 is reported nowhere.
- The launcher's default changed on 2026-09-06 without re-registering the task that invokes it; the task's stale description is the only visible trace.
- The Studio dashboard labels the account "LIVE" from the database flag alone (`LineStudioDashboard.jsx:98-99`), while the runtime gate (`server-line-runtime.js:7`) is closed.

## Proposed prevention

1. Make the launcher compare the registered task's description or arguments with its own contract and warn loudly when they differ; document that any `-TransportOwner` change requires `-Install`.
2. Add an external liveness probe of the registered webhook URL (expect 405/200, alert on 502/503/timeouts) - the one signal that would have fired at 01:12.
3. Show LIVE in the Studio only when the runtime is enabled and the credential mount is present, not from `serverEnabled` alone; surface `LINE_SERVER_DISABLED` in account health.
4. Have the edge stack's startup check assert `tailscale funnel status` lists `/webhook/line` alone (BR-009) and report drift.
5. Once the cutover is done, record the provider's registered URL in `getAccountHealth` by calling the endpoint API under the CLOUD credential.

## Addendum 2026-09-09 00:00-01:15 — a second bug found and fixed during the cutover, and the latency root cause quantified

Restoring the legacy receiver (this document's Option A) was only the emergency fix. Completing the ADR-061
cutover (owner-directed, execution mode SERVER then EDGE) surfaced a second, independent, pre-existing bug:

- **The Studio's account destination was wrong from account creation.** `IntegrationConnection.externalAccountId`
  was `U98abb02044e4786cfd9b250e1273857c`; the real LINE-computed destination for `@949xcfau` is
  `Uc629e1f98dbb89048b2b38a7db5a5063` (read from the raw request body captured by ngrok's inspection API after
  three `403 LINE_WEBHOOK_DESTINATION_MISMATCH` responses). Corrected in both the DB row and the mounted
  credential file's `destination` field.
- **Every real admission then failed with Prisma `P2028` ("Transaction already closed"), silently.** PR #290
  (`bd385c1d`, merged before tonight, an ancestor of the deployed `0eb6c03a` image) added an execution-trace
  write (`appendTraceEvent`, four extra sequential queries) inside `admitLineConversation`'s existing interactive
  transaction. The webhook route's catch blocks swallow every error without logging, by explicit design ("do not
  echo parser/provider errors or event material") — so this had zero visibility in `docker logs` since #290
  landed. Confirmed by adding temporary redacted diagnostic logging (kept) and reproducing with a signed
  synthetic request: reliably ~7s, then `P2028`, `503`.
- **Root cause quantified, not just located.** `select 1` against the production Postgres measures ~100ms
  steady-state round-trip (matches ADR-058 D9's session-mode measurement). The admission path — `resolveAccount`,
  `evidenceFactory`, `evidence.record`, then inside `admitLineConversation`'s transaction: account/job lookups,
  `ingestLineMessage` (tenant/business/conversation/identity/customer/message, several of them sequential
  create-or-find pairs), job creation, `recordAudit`, and `appendTraceEvent`'s own four queries — issues roughly
  25-30 **sequential**, unbatched round trips. At ~100ms each that alone is 2.5-3.0s; the observed ~7s includes
  slower individual queries and no parallelization anywhere in the chain. No single query is pathological; the
  cost is architectural (one round trip per step, nothing batched, nothing run concurrently).
- **Fix shipped:** [PR #299](https://github.com/Freshair129/zuri.ai/pull/299) (merged `3fb7d1a5`) raises
  `admitLineConversation`'s transaction to `{ timeout: 15000, maxWait: 5000 }` and adds the redacted diagnostic
  logging permanently. Verified twice post-fix with a signed synthetic webhook (internal and through the full
  ngrok path): `200 accepted`, ~7.4-7.7s. All synthetic test data (rows keyed to two fixed synthetic LINE user
  ids) was deleted from production afterward; the two real trace-event rows from the customer's actual DM and
  its LINE-driven redelivery (turnId `8574e7d2…`, 22:07 local) were left untouched as genuine evidence — that
  message never landed in CRM (admission threw before commit) and is not recoverable from our side.
- **Deliberately not done tonight:** the ~7s latency is still real and worth fixing — reducing round trips
  (batching, or running independent lookups concurrently) is a multi-file refactor across
  `line-conversation-jobs.js`, `line-ingest-service.js`, `resolve-line-identity.js`, `channel-identity.js` and
  `execution-trace.js`, not something to start at 01:15 local. Tracked as a follow-up, not a defect in the fix
  that shipped.
- **Production image realignment:** the destination fix and PR #299 were tested via a locally-tagged
  `zuri-ai-web:diag-logging` image while the fix was still on a branch; once PR #299 merged, `zuri-ai-web:local`
  was rebuilt from a disposable worktree on merged `origin/main` (the primary checkout was left untouched — it
  had unrelated uncommitted edits to `LineCrmLiveChat.jsx`/`LineCrmMembers.jsx` from another session, so
  `git checkout --detach origin/main` there correctly refused) and redeployed, retiring the diagnostic tag.

## Current resolution state

- **Option A executed 2026-09-08 19:14 (+07:00) on the owner's instruction.** The old receiver logs were copied to
  `state/startup-logs/rca-2026-09-08-backup/` first. `start-edge-stack.ps1 -TransportOwner LEGACY_EDGE` found
  Ollama, the embed sidecar and the RAG service already up and started `webhook serve`; exit 0 in 4 s.
- The receiver (PID 50676, detached, parent gone) listens on `0.0.0.0:8787`; its log reports `listening`,
  `outboxEnabled: true`, an outbox sweep of 6 entries, a cloud heartbeat `ok:true`, and `qwen3.5:9b` warmed.
- The Funnel URL now answers 405 to HEAD and 200 to GET (liveness JSON); `127.0.0.1:8787/` answers liveness. The
  Funnel map itself is unchanged.
- `ZuriEdgeStack` was re-registered with `-Install -TransportOwner LEGACY_EDGE`; its action now carries the flag, so
  the next logon starts the receiver again. Residual risk: the launcher still gates the webhook on the embed sidecar
  answering within 180 s, which it missed this morning.
- Heartbeat target verified by catching the connection: the receiver reports to `127.0.0.1:3000`, the Docker host
  port of the production `web` container, not through ngrok; it also holds connections to Ollama (11434) and the RAG
  service (8888), so the local answer path is live.
- The outbox sweep removed 6 settled records past their inspection window (`sweep()` in `src/delivery/outbox.ts`).
  The 4 records that remain are `DELIVERED`, one attempt each, recipients redacted; nothing was re-sent and nothing
  is pending.
- **Live delivery proven 2026-09-08 19:49:05 (+07:00).** A real LINE event (group text, 948-byte signed POST)
  reached the receiver through the Funnel 2 s after LINE timestamped it (`occurredAt` 12:49:03.933Z,
  `receivedAt` 12:49:05.549Z) and was archived under the `team` group. No reply was generated because the
  receiver's group guard (`webhook-server.ts:927-931`) answers group text only when it contains "zuri" or "ซูริ";
  that is the designed behaviour, not a fault. This settles the registered-URL question empirically: LINE delivers
  to this machine's Funnel, the only public path to port 8787.
- An earlier test message the owner reported sending at about 19:20 never appeared in any log and was not
  redelivered, consistent with it being sent while 8787 was still closed and with redelivery being off (the console
  default). Events LINE tried to deliver between 23:33 on 09-07 and 19:14 on 09-08 should therefore be assumed lost
  to the bot; the console's error statistics hold the count.
- Not yet done: the redelivery toggle and error statistics are still unread (owner-side). Compose, the tailnet and
  LINE were not touched.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.2.0b | 2026-09-09 | under review | ADR-061 cutover found and fixed two independent pre-existing bugs: wrong `externalAccountId`/destination, and a Prisma P2028 transaction timeout since PR #290 that silently failed every real admission; fix in PR #299 (merged `3fb7d1a5`); latency root cause quantified (~100ms/round-trip × ~25-30 sequential queries) and left as a follow-up | 3fb7d1a5 | CLAUDE |
| 0.1.1b | 2026-09-08 | under review | Option A executed: receiver restarted in LEGACY_EDGE mode, logon task re-registered with the flag, Funnel verified 405/200; owner-side checks still open | working-tree | CLAUDE |
| 0.1.0b | 2026-09-08 | under review | Diagnosed the Funnel 502: legacy receiver dead since 23:32 on 09-07, logon task cannot restart it after edge `4a6e7ca`, server receiver deployed but disabled | working-tree | CLAUDE |
