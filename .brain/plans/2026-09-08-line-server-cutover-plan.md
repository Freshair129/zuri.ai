---
version: "0.1.1b"
created_at: "2026-09-08T21:55:00+07:00,CLAUDE"
last_update: "2026-09-08T22:05:00+07:00,CLAUDE"
status: "accepted — execution placement decided"
attributes:
  domain: "line-oa-studio"
  doc_type: "cutover-plan"
  scope: "Move LINE ingress and delivery for OA @949xcfau from the legacy edge receiver (Funnel :8787) to the ADR-061 server-owned transport"
---

# LINE server cutover plan (ADR-061)

Governing decision: [ADR-061](../../docs/decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md) D1–D8 and its
"Before activation" paragraph. Deployment layer: [ADR-058](../../docs/decisions/ADR-058-DOCKER-COMPOSE-AND-NGROK-REPLACE-VERCEL.md).
Incident that motivates it: [RCA 2026-09-08](../rca/2026-09-08-line-webhook-funnel-502-edge-receiver-not-restarted.md).

## 0. Verified starting state (2026-09-08 21:40 +07:00)

| Layer | State | Evidence |
|---|---|---|
| Provider | LINE delivers to `https://desktop-vetatmq.tail71c7d1.ts.net/webhook/line` (Funnel → 127.0.0.1:8787) | 5 signed events received today, 3 replies DELIVERED |
| Legacy receiver | `webhook serve` running in LEGACY_EDGE; `ZuriEdgeStack` task re-registered with `-TransportOwner LEGACY_EDGE` | RCA |
| Funnel | publishes `/webhook/line` only (BR-009 restored) | `tailscale funnel status` |
| Server image | `zuri-ai-web:local` from `0eb6c03a`, healthy behind ngrok; native route deployed, answers 503 `LINE_SERVER_DISABLED` | probes |
| Server env | `ZURI_LINE_SERVER_ENABLED`, `ZURI_LINE_SECRET_FILE`, `ZURI_LINE_WORKER_TOKEN`, `ZURI_LINE_REPLY_SEAL_KEY` all unset; `line-worker` profile not running; `PUBLIC_BASE_URL` = ngrok domain | container env |
| Migrations | `20260906160000_server_line_jobs` and `20260906180000_line_conversation_job_rls_policy` APPLIED | `supabase_migrations.schema_migrations` |
| Account | `LineOaAccount` `84ef8528-b1a2-4561-9137-8b7d327eed16` "Zuri" `@949xcfau`: status CONNECTED, `transportMode` CLOUD, `serverEnabled` **true** (set before runtime existed), `executionMode` EDGE, `modelAccess` LOCAL_ONLY, `allowDelayedPush` true, version 4, epoch 4 | DB |
| Connection | `IntegrationConnection` `c92db7a9-d06c-4a34-bef7-5361e5eea250` ACTIVE, `externalAccountId` `U98abb02044e4786cfd9b250e1273857c` (= webhook `destination`) | DB |
| Credential row | `IntegrationCredential` `78b7046e-…` ACTIVE, `secretRef` `deployment-secret:line-949xcfau`, no expiry; no mount backs it yet | DB |
| Jobs | 0 `LineConversationJob`, 0 `RawExternalRecord` — nothing UNKNOWN blocks handoff | DB |
| Edge | checkout 0.2.0b (≥ PR #22 `b089320`); `conversation serve` exists; device credential row exists; `ZURI_CLOUD_BASE_URL` / `ZURI_EDGE_DEVICE_KEY` state unknown (in edge `.env`) | edge src |

Tenant `77cdbe70-3111-4a04-922a-8059be99a8b0`, Business `834fa869-62f3-431c-a287-e9a95e91175b`.

## 1. Owner decisions before anything is touched

1. **Execution placement: SERVER — decided by the owner on 2026-09-08.** (Original options kept for the record.) EDGE + `LOCAL_ONLY` means every
   customer answer waits for this workstation's compute worker; with the device offline the job waits visibly
   and the customer gets nothing (ADR-061 D2, Consequences). SERVER needs the cloud model credential and the
   scoped business-knowledge reader configured on the server (agent charter; `ZURI_LINE_BUSINESS_AGENT_ENABLED`
   exists in `.env`). Recommendation: cut over with SERVER execution, prove it, then switch to EDGE via
   `CONFIGURE_EXECUTION` once the compute worker survives a reboot.
2. **Turn Webhook redelivery ON in LINE Developers before the window.** Any 5xx during the switch is then
   retried by LINE (`deliveryContext.isRedelivery`), which is the only recovery path for events that land in
   the gap.
3. **Window:** a quiet hour; the whole switch is minutes, the observation window a day.
4. **Retention of the legacy path:** keep the Funnel and the LEGACY_EDGE task for 7 days as rollback, then
   retire (step 7).

## 2. Prepare the server runtime (no traffic impact)

All on the production host, from the primary checkout at `origin/main` (`git worktree list` first; read-only
tree, `apps/server` is the compose directory).

1. Generate secrets and put them in `apps/server/.env` (never commit):
   - `ZURI_LINE_WORKER_TOKEN` — ≥ 32 random characters.
   - `ZURI_LINE_REPLY_SEAL_KEY` — exactly 64 hex characters.
   - `ZURI_LINE_SECRET_FILE_HOST` — absolute path **outside** any checkout, e.g. `C:\zuri-secrets\zuri-line.json`
     (the runtime rejects a mount inside the checkout: `LINE_SECRET_MOUNT_MUST_BE_OUTSIDE_CHECKOUT`). Make sure
     Docker Desktop file sharing allows that folder.
2. Write the mounted credential file (schema `zMountedFile` in
   `server-line-transport.js`; every field is required and `strict`):

   ```json
   {
     "version": 1,
     "entries": [
       {
         "secretRef": "deployment-secret:line-949xcfau",
         "tenantId": "77cdbe70-3111-4a04-922a-8059be99a8b0",
         "businessId": "834fa869-62f3-431c-a287-e9a95e91175b",
         "accountId": "84ef8528-b1a2-4561-9137-8b7d327eed16",
         "connectionId": "c92db7a9-d06c-4a34-bef7-5361e5eea250",
         "destination": "U98abb02044e4786cfd9b250e1273857c",
         "version": "2026-09-08",
         "expiresAt": "2026-12-08T00:00:00+07:00",
         "channelSecret": "<LINE channel secret>",
         "channelAccessToken": "<long-lived channel access token>"
       }
     ]
   }
   ```

   The channel secret and token are the same ones the edge `.env` holds (`LINE_CHANNEL_SECRET`,
   `LINE_CHANNEL_ACCESS_TOKEN`); copy them by hand, do not let an agent read that file. `expiresAt` is the
   operator's rotation deadline; the resolver refuses an expired entry.
3. Bring the stack up with the overlay (this recreates `web`; the console is unavailable for ~1 minute, ngrok
   keeps the domain):

   ```bash
   cd apps/server
   docker compose -f docker-compose.yml -f docker-compose.line-server.yml --profile line-server up -d --build
   ```

4. Verify, all read-only:
   - `GET https://<ngrok>/api/health` → 200.
   - unsigned `POST https://<ngrok>/api/line-oa/accounts/84ef8528-…/webhook` with `{"events":[]}` → **401/400**
     (signature rejected) instead of 503. 503 means the mount or env is still wrong; the error code is in the
     container log.
   - `docker compose --profile line-server ps` shows `line-worker` up; its log ticks `line.worker.tick` with
     status 200/204, not `unavailable`.
   - `docker exec zuri-ai-web-1 sh -c 'printenv ZURI_LINE_SERVER_ENABLED; ls -la /run/secrets'` → `true`, file present.

## 3. Put the account into a known activation state

The account was flagged `serverEnabled=true` on 2026-09-07 03:04 before any runtime existed, which inverts
ADR-061 D3's order. Reset it through the versioned owner action on `PATCH /api/line-oa/accounts/{id}` (or the
Studio Command Center), sending the current `version` each time:

1. `DISABLE_SERVER` → epoch +1, no jobs to fence.
2. `CONFIGURE_EXECUTION` with the decision from §1 (`executionMode` SERVER or EDGE, `modelAccess`,
   `allowDelayedPush`). Push consumes the OA's message allowance; leave `allowDelayedPush` true only if that is
   wanted.
3. `ENABLE_SERVER` → validates status/CLOUD and re-arms the epoch. The Studio must now show LIVE **with** the
   runtime enabled, not from the DB flag alone.

If `ENABLE_SERVER` fails with `LINE_OA_SERVER_ACTIVATION_INVALID`, the account is paused/archived or not CLOUD;
fix that first.

## 4. Edge compute worker (only if `executionMode` = EDGE)

1. Confirm the edge `.env` has `ZURI_CLOUD_BASE_URL` (the ngrok origin, or `http://127.0.0.1:3000` on this host)
   and `ZURI_EDGE_DEVICE_KEY` (the minted `edgk_…`); the CLI refuses a half-configured pair.
2. Start the worker without touching the legacy receiver: `node dist\cli\index.js conversation serve` from
   the edge checkout, or the launcher in default mode. It only claims jobs, so it is safe alongside LEGACY_EDGE.
3. Fix the launcher gate before relying on it at boot: today the webhook and the worker are skipped when the
   embed sidecar misses 180 s (`$ok=false`), which happened on 2026-09-08 06:27. Either set `HF_HUB_OFFLINE=1`
   for the sidecar or decouple the worker from `$ok` (edge repo change, PR).

## 5. Canary (real provider, still on the legacy path)

ADR-061 requires a real provider canary. The console's **Verify** only hits the registered URL, so the canary
is the switch itself, done reversibly:

1. Confirm the edge outbox has no `DISPATCHING`/`PENDING` record and no job is `SENDING`/`UNKNOWN` (D7: cutover
   waits for in-flight sends).
2. Stop the legacy receiver: `Stop-Process -Id <pid of "webhook serve">`; re-register the task compute-only
   `scripts\start-edge-stack.ps1 -Install` (default SERVER). Port 8787 closes; Funnel now answers 502 —
   redelivery is ON from §1, so anything arriving now is retried later.
3. In LINE Developers → Messaging API: set Webhook URL to
   `https://unspirited-expostulatory-angila.ngrok-free.dev/api/line-oa/accounts/84ef8528-b1a2-4561-9137-8b7d327eed16/webhook`,
   Use webhook ON, press **Verify** → must succeed (signed empty request; D4).
4. Send a DM from a test user. Expect within ~30 s: one `RawExternalRecord`, one CRM inbound message, one
   `LineConversationJob` moving ADMITTED → … → ACCEPTED, one CRM outbound, and the reply in LINE. Then a group
   message **with** a bot mention (D4) and one without (must be archived only).
5. If anything fails: set the console URL back to the Funnel URL, run
   `scripts\start-edge-stack.ps1 -TransportOwner LEGACY_EDGE`, re-register with `-Install -TransportOwner LEGACY_EDGE`.
   Do **not** roll back while a job is SENDING or UNKNOWN (ADR-061 activation paragraph).

## 6. Observation window (24 h)

- Watch `line-worker` logs and `LineConversationJob` states every few hours; any UNKNOWN is an operator
  reconciliation, never a resend.
- Watch the LINE console error statistics; they should stay at zero.
- External probe of the registered URL (expect 405 on HEAD, alert on 502/503/timeout) — the one signal that
  would have caught this week's outage at 01:12.

## 7. Retire the legacy path (after the window)

1. `tailscale funnel reset` on this machine (the Funnel then publishes nothing); the retired machine
   `desktop-8ur61u8` still advertises a `/webhook/line` Funnel and should be reset too.
2. Leave the `ZuriEdgeStack` task compute-only; `webhook serve` stays available behind `LEGACY_EDGE` for
   emergencies only.
3. Records: ADR-061 evidence refresh (production activation happened), ROADMAP FR-149/150 production status,
   RCA follow-up, memory note. Consider ADR-058 D8's VPS + real domain step so the OA does not depend on a
   free ngrok domain.

## Rollback summary

| Phase | Rollback |
|---|---|
| 2 | `docker compose up -d` without the overlay restores the previous runtime; nothing at LINE changed |
| 3 | `DISABLE_SERVER`; legacy edge keeps answering |
| 5 | Console URL back to the Funnel; launcher `-TransportOwner LEGACY_EDGE`; wait out SENDING/UNKNOWN first |
| 7 | Re-publish `/webhook/line` with `tailscale funnel --bg --set-path=/webhook/line 8787` **from PowerShell** (Git Bash mangles the path) |

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.1.1b | 2026-09-08 | accepted | Owner chose SERVER execution for the cutover; §4 becomes optional follow-up | CLAUDE |
| 0.1.0b | 2026-09-08 | draft | First plan from verified production state; owner decisions in §1 pending | CLAUDE |
