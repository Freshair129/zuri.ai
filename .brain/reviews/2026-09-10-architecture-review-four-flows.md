# zuri-ai architecture review — four flows, gaps, refinements

Read-only review, 2026-09-10 (03:55 ICT / 2026-09-09T20:55Z). Code read from
`C:\Users\pc\workspace\zuri-ai-line-ack` (tree identical to `origin/main` at
`2fa9a256`, PR #306 merged — verified `git diff --stat HEAD origin/main` empty).
All paths below are relative to that checkout unless stated. Runtime observed on
this machine: Compose project `zuri-ai` (`zuri-ai-web-1` healthy, image built
2026-09-09T18:19Z; `zuri-ai-line-worker-1`; `zuri-ai-ngrok-1`), ngrok inspector
`127.0.0.1:4040`, and read-only Prisma aggregates run inside the web container.

Legend: **[obs]** observed at runtime · **[code]** read from source · **[doc]**
asserted by a document · **unverified** = could not be settled tonight.

---

## Flow 1 — LINE ingress → answer

### 1.1 The flow as it actually is

```
LINE ──► ngrok (web:3000, host-header preserved) ──► POST /api/line-oa/accounts/{id}/webhook
   route.js:37  resolveAccount(id)      — DB + secret mount /run/secrets/zuri-line.json [obs: mounted]
   route.js:38-40 bounded body (1 MiB) → HMAC verify on raw bytes → destination match
   route.js:41-42 evidence recorder; REQUIRED (throws LINE_EVIDENCE_UNAVAILABLE if no LINE_OA IntegrationConnection)
   route.js:64-80 per event: evidence.record() → RawExternalRecord (processingStatus RECEIVED)
   route.js:84-87 admitCaptured(...) — NOT awaited
   route.js:91-93 respond 503 if any event failed to store, else 200 {accepted, captured:n}
                                                        │
   (same process, after the response)                   ▼
   line-conversation-jobs.js:202-233 admitCapturedLineEvents: per event, admitLineConversation with
       retries at +4s, +12s (line 179); deterministic 4xx → SKIPPED; else FAILED; label RawExternalRecord
   line-conversation-jobs.js:82-130 admitLineConversation: seal replyToken (AES-GCM, ZURI_LINE_REPLY_SEAL_KEY),
       one 15s transaction: ingestLineMessage (CRM) + LineConversationJob{QUEUED, executionMode from account,
       replyExpiresAt = now+45s, expiresAt = now+30min} + audit + TURN_RECEIVED trace
                                                        │
   EDGE execution (production account: executionMode=EDGE, modelAccess=LOCAL_ONLY, allowDelayedPush=true [obs])
   edge device ──► POST /api/edge/conversation-jobs/claim  every ~7s [obs: 170 polls / 20 min, all 204]
       claim/route.js:11-16  ZURI_LINE_SERVER_ENABLED + resolveEdgeDeviceContext (edgk_ key; writes lastUsedAt each call,
                             edge-device-credential.js:191)
       line-conversation-jobs.js:235-244  maintenance() (4 updateMany) + claimExecution (findMany, CAS to CLAIMED,
                             lease 300s, EXECUTION_STARTED trace) → minimized job {question, conversationKey, lease, policy}
   edge answers locally, then POST /complete {version,text} or /fail {version, code∈{EXECUTION_FAILED,LOCAL_POLICY_UNAVAILABLE}}
       line-conversation-jobs.js:246-263 settleExecution: CAS on version/claimant/lease → READY (answerText) or FAILED
                                                        │
   SEND (server worker; runs for EDGE-completed jobs too — worker picks any READY job, line 325)
   zuri-ai-line-worker-1: scripts/server-line-worker.mjs loops POST /api/line-oa/worker then /rich-menu-worker, 1s sleep
       [obs: 2186 ticks each / 2h ≈ one tick per 3.3s, all 200]
   worker/route.js → runLineConversationWorker (line-conversation-jobs.js:307-404):
       maintenance → reconcile ACCEPTED → claim SERVER work (none in prod) → pick READY job
       method = REPLY if sealed token && replyExpiresAt > now, else PUSH if allowDelayedPush, else FAILED (line 334-338)
       fence account version + SENDING (30s lease) + SEND_STARTED trace → replyTransport/pushTransport (10s timeout)
       ACCEPTED_BY_LINE → ACCEPTED → reconcileAccepted → CRM outbound + OUTBOUND_RECORDED → RECORDED
```

**Observed production ledger [obs, read-only Prisma inside the container]:**
12 `LineConversationJob` rows total — 8 `RECORDED` (EDGE/REPLY, attempts=1) and
4 `FAILED` with `errorCode=LOCAL_POLICY_UNAVAILABLE` (EDGE, attempts=0, no send).
`RawExternalRecord` provider `LINE_OA`: 34 `RECEIVED`, 3 `ADMITTED`, 0
`SKIPPED`/`FAILED`. Latest `RECEIVED` row is 17:49:21Z (before the 18:19Z deploy
of #306); the 3 `ADMITTED` rows are the post-#306 events. For the 8 successful
jobs, `createdAt → acceptedAt` was 11 s, 27 s, 15 s, 24 s, 21 s, 27 s, 20 s, 29 s;
`replyExpiresAt − createdAt` ≈ 42–44 s, so the reply-token margin at send time
was as low as **~14 s** (job 18:21:15Z: accepted 18:21:42, token deadline
18:21:57).

**Web container logs (24 h) [obs]:** exactly one `line-webhook-request` line —
`status 401 LINE_WEBHOOK_SIGNATURE_INVALID` (source unverified; ngrok's 200-entry
buffer had already rotated to claim polls). No `line-admission-after-ack` lines,
i.e. no post-ack admission failures since deploy.

### 1.2 Where documents and code disagree

| # | Document says | Code does | Anchor |
|---|---|---|---|
| D1 | ADR-061 D4: "Text events create account-scoped CRM inbound and a uniquely keyed job in one transaction **before HTTP 200**" | 200 is returned after evidence capture; admission runs after the response | `docs/decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md` §Decisions 4 vs `webhook/route.js:84-93` |
| D2 | PRD FR-149: "persist inbound CRM and a durable conversation job **before acknowledgment**" | same as D1 | `docs/PRD-SDD-v1.0.md:419` vs `webhook/route.js:84-93` |
| D3 | The route's own header: `@req FR-149 — native signed webhook; acknowledge only durable admission.` | the body beneath it acknowledges durable *capture* | `webhook/route.js:8` vs `:43-57` |
| D4 | `line-oa-evidence.js:33-36`: "`null` is a configuration answer, not a failure: a deployment that has not provisioned the connection keeps working exactly as before" | the native route throws `LINE_EVIDENCE_UNAVAILABLE` → 503 for every event when the recorder is `null` | `line-oa-evidence.js:33-36` vs `webhook/route.js:42` |
| D5 | `docker-compose.yml:9-10`: "the LINE webhook seam (`POST /api/agent/line-webhook`) … served by `web`" | the live seam is `/api/line-oa/accounts/{id}/webhook`; `/api/agent/line-webhook` is the retained legacy forwarding route that refuses server-enabled accounts (`api/agent/line-webhook/route.js:10`) | stale comment; the legacy route still exists |
| D6 | ADR-061 D6: "after a send with an **ambiguous** outcome never switch to Push" | code never switches methods at all: `sendMethod` is sticky once set (`:333`) and a *definite* REPLY 4xx maps to terminal `FAILED` (`:378-380`) | code is stricter than the ADR; see G1.5 |

### 1.3 Gaps

**G1.1 — Ack-then-die loses the event with no recovery and no distinguishable marker.** (known; sharpened)
*What breaks:* process exit between `route.js:93` and `admitCaptured` finishing.
*Condition:* most likely during a deploy — `docker compose up -d --build web`
recreates the container with Docker's default 10 s stop grace (no
`stop_grace_period` in `docker-compose.yml`, none in the Dockerfile), while a
retried admission can run 4 s + 12 s + 3 × (7–11 s) ≈ 40 s. A message arriving in
the ~40 s before every deploy is at risk. *How a person notices:* they do not —
the customer gets no reply, the Studio jobs table shows nothing (no job exists),
and the only trace is a `RawExternalRecord` at `RECEIVED`. Worse, `RECEIVED` is
already the label on all 34 pre-#306 rows (never relabelled), so a "find
RECEIVED rows" query has 34 false positives from day one. No code scans
`RECEIVED` LINE rows (grep: none outside the label writer). *Blast radius:* one
customer message per occurrence; silently.

**G1.2 — Retried admission can seal a reply token that is already dead, and the code then refuses the Push it is allowed to make.**
`replyExpiresAt = now + 45 s` is computed at *admission* time
(`line-conversation-jobs.js:109`), not at LINE delivery time, and `now` is
re-taken on each retry (`:82`, default parameter). An admission that succeeds on
attempt 3 (≥ 16 s after ack, plus 7–11 s of transaction) stamps a deadline
~60–70 s after LINE's delivery — past the real token life. The worker then
chooses REPLY (`:334`), LINE answers 400, `PERMANENT_FAILURE` → `FAILED`
(`:378-380`), terminal, even though `allowDelayedPush=true` and `answerText` is
persisted. *How noticed:* Studio jobs row `FAILED / LINE_HTTP_400`; customer gets
nothing. *Blast radius:* every late admission (also every job whose device is
slow: the 8 observed successes had 14–30 s of margin left, on a 7 s poll).

**G1.3 — `LOCAL_POLICY_UNAVAILABLE` is a silent customer-facing failure with no owner.** [obs: 4 of 12 production jobs]
The device rejects the job within ~8 s (`updatedAt − createdAt`), the job is
terminal `FAILED`, no send is attempted, no fallback exists by design (ADR-061
D2 "no automatic SERVER fallback"), and nothing alerts. The customer wrote to
the OA and received nothing, four times over 09-08/09-09. The Studio Edge
Connection page shows `errorCode` in a table cell
(`LineStudioEdgeConnection.jsx:795`) only if someone opens it.

**G1.4 — Offline device → 30 min TTL → `EXECUTION_EXPIRED`, same silence.**
`JOB_TTL_MS` (`:18`) and `maintenance` (`:133-134`). ADR-061 says such work
"remain[s] visibly waiting or expire[s]" — visible only in the jobs table, and
the expiry sends no apology and raises nothing.

**G1.5 — Evidence connection is now a hard dependency of the ingress, contrary to the evidence module's own contract.** (D4)
If the `LINE_OA` `IntegrationConnection` is deactivated, archived, or its
`externalAccountId` diverges from the account's destination, *every* LINE
delivery gets 503 and LINE redelivers forever. Fails closed (good), but the
error name `LINE_EVIDENCE_UNAVAILABLE` is logged only through the diagnostic
`console.error` and nothing on the Studio page says "your ingress is down".

**G1.6 — Idle polling is the dominant production load.** [obs]
An empty edge claim costs 4 `updateMany` + 1 `findMany` + 1 credential
`updateMany` (`lastUsedAt`) ≈ 1.7 s per call over the session-mode pool, every
7 s; the server worker adds 4 `updateMany` + 3 finds every ~3.3 s, plus a
rich-menu tick. ngrok's own http p50 is 1.73 s — that number *is* the edge poll.
Not a correctness bug; it is the reason the tunnel's latency histogram is
useless for spotting a real problem, and it doubles as an availability risk if
the free-tier tunnel meters requests (unverified).

**G1.7 — Two `maintenance()` sweepers with overlapping scope.** Server worker
(global) and every edge claim (tenant/business-scoped) both run the same four
`updateMany`. Harmless today (CAS by `version`), but it means lease expiry and
reply-expiry policy live in a function invoked by an *untrusted caller's* poll
cadence.

**G1.8 — PR #292 still edits the pre-#306 route.** `gh pr diff 292` shows
context lines (`await evidence.record…; await admit(…)`) that no longer exist →
it will conflict, not silently regress. Low risk; noting so nobody "resolves"
the conflict by taking the PR side.

**G1.9 — The ngrok tunnel dropped once on 09-09 (14:44:57Z, "read EOF from remote peer", reconnected 1.4 s later).** [obs]
During that window LINE deliveries fail at the edge of ngrok; LINE only
redelivers if redelivery is enabled on the channel (it is — `isRedelivery`
was observed earlier tonight). Nothing records the outage on our side.

### 1.4 Refinements

**R1.1 — Make the unadmitted-evidence case recoverable, and make `RECEIVED` mean one thing.**
(a) In `admitCapturedLineEvents`, label the row `ADMITTING` *before* the first
attempt (one extra `updateMany`, already non-fatal), so after a crash the
stranded rows are exactly `ADMITTING`, not a superset with 34 legacy rows.
(b) Add a bounded reconciler to the existing worker tick
(`runLineConversationWorker`, which already runs every ~3 s and already owns
`maintenance`): `findMany RawExternalRecord{provider LINE_OA, processingStatus
ADMITTING, receivedAt < now − 60 s}` → re-run `admitLineConversation` with the
event material from `payloadJson`, with `replyToken` absent (it was stripped at
capture — `line-oa-webhook.js:103`), so the job is created with
`sealedReplyToken=null` and the existing `:334` logic routes it to PUSH when
allowed, or `REPLY_EXPIRED_PUSH_DISABLED` when not. This reuses every
idempotency key that already exists. (c) `stop_grace_period: 60s` on `web` in
`docker-compose.yml`, so a deploy waits for in-flight admission.
*Trade-off:* the reconciler is another sweeper on a hot path; keep it `take: 5`
per tick. *Rejected:* a separate container/cron — a third process for a job the
worker already ticks. *ADR change:* ADR-061 D4 should say "acknowledge on
durable capture; admission is asynchronous, retried, and reconciled from
evidence" and name the recovery path; FR-149's row (`PRD-SDD:419`) reworded the
same way (rewording is free under ADR-039).

**R1.2 — Anchor the reply deadline to LINE's clock, and allow a REPLY→PUSH switch on a *definite* rejection.**
`replyExpiresAt` should be `min(event.timestamp + ~55 s, ingressReceivedAt +
45 s)` — both values are already in hand at `:82` (`event.timestamp` is
LINE's, `ingressReceivedAt` is the route's). Then in the worker, treat
`LINE_HTTP_400` on REPLY as a *known* non-delivery and, when
`allowDelayedPush`, re-queue as `READY` with `sendMethod=PUSH` instead of
`FAILED`. This is inside ADR-061 D6's letter (it forbids switching after an
*ambiguous* outcome; a 400 is not ambiguous) — no ADR change needed, but D6
should gain the sentence so the next reader does not "fix" it back.
*Trade-off:* Push consumes the OA's monthly allowance (the reason D6 is
conservative). *Rejected:* shortening the edge poll to beat the deadline —
it attacks the symptom and raises G1.6.

**R1.3 — Give terminal EDGE failures an owner.** For `FAILED` with
`LOCAL_POLICY_UNAVAILABLE`/`EXECUTION_EXPIRED`/`LINE_HTTP_4xx` and
`allowDelayedPush=true`, push a fixed Thai holding message ("รับข้อความแล้ว
เจ้าหน้าที่จะติดต่อกลับ") through the same `pushTransport` with the job's
`retryKey`, recorded as an outbound with `source: 'FALLBACK'`; and surface a
red count on the Studio Edge Connection card. *Trade-off:* it is a message the
model did not write; it must be a constant, never model output, and it must
not be sent for `PDPA_ERASURE`. *Rejected:* automatic SERVER fallback — ADR-061
D2 forbids it, and SERVER/LOCAL_ONLY would answer with the deterministic
template model anyway (`server-line-answer.js:47`), not an LLM.

**R1.4 — Cheapen the idle path.** Edge claim: run `maintenance` at most once
per 30 s per scope (a `Map<scope, lastRunAt>` in module scope is fine — it is
a cache, not state), and drop the per-call `lastUsedAt` write to once per
minute. Server tick: same throttle. This takes an empty poll from ~6 queries to
1. *Trade-off:* lease/expiry sweeps become up to 30 s late — irrelevant against
a 300 s lease and a 30 min TTL. *Rejected:* long-polling the claim endpoint —
ngrok/Next.js function timeouts and it does not remove the maintenance cost.

**R1.5 — Fix the four text disagreements (D1–D5)** in one docs PR; D3 and D4
are comments inside the code and should move in the same PR as R1.1.

---

## Flow 2 — Edge device lifecycle (pairing FR-144, desktop runtime FR-150)

Paths under `apps/edge/` (Rust in `src-tauri/src/`) and `apps/server/src/`.

### 2.1 The flow as it actually is

**What is running [obs]:** `C:\Users\pc\ZuriEdgeDesktop\0.3.2\zuri-edge-device.exe`
(PID 43784) supervising `…\0.3.2\runtime\node.exe …\worker\dist\desktop-worker.js`
(PID 44280) — the parent/child shape of `supervisor.rs:196-206`, i.e. a
**packaged build of the monorepo `apps/edge`** at desktop version 0.3.2, while
this worktree's `Cargo.toml` says 0.3.1 (the installed package is newer than
`main`). Config `%APPDATA%\zuri-edge-device\edge-config.json` (metadata only):
`is_paired: true`, `cloud_base_url` = the ngrok domain, provider `ollama` /
`qwen3.5:9b` / `allow_cloud:false`, key sealed with a `dpapi:` prefix,
`last_heartbeat_at: null`. Production: 1 ACTIVE `EdgeDeviceCredential`
(created 09-09 17:05Z, `lastUsedAt` 21:03:52Z) + 1 REVOKED; the account is
`executionMode: EDGE` — so this path **is** the live customer path.

**Pairing (FR-144) — two paths, one device parser.**

| | QR / browser path | Manual mint (Studio) |
|---|---|---|
| Start | `commands.rs:167-208` `connect_zuri` → `POST /api/edge/pairing/start` | `LineStudioEdgeConnection.jsx:97-123` → `POST /api/platform/edge-devices/credentials` |
| Server | `edge-pairing.js:37-53`: three unrelated 43-char secrets (`requestId`, `deviceSecret`, browser `code` in the URL **fragment**), digests only, TTL 300 s (`:12`), process-local `Map` on `globalThis` (`edge-pairing-runtime.js:10-12`); global cap 30 starts/60 s, 200 rows (`:39-41`) | mints immediately, builds a JSON download (`edge-pairing-download.js:4-10`) |
| Origin authority | server env via `resolvePublicBaseUrl()` (`edge-pairing-http.js:7-13`) | **the operator's browser `window.location`** (`LineStudioEdgeConnection.jsx:76-79,113`) |
| Approve | `/edge/pair` page moves the fragment to `sessionStorage` (`page.jsx:32-36`), `approve` requires `isInstallationOperator ∥ ownsBusiness` and re-checks after every await (`edge-pairing.js:60-77`) | — |
| Redeem | `poll` flips to `REDEEMING` before any I/O (`:89`), mints in a tx (`edge-pairing-runtime.js:19`), one-shot | device imports via `import_pairing_payload` (`commands.rs:141-165` → `pairing.rs:40-63`) |

**Credential.** `edgk_` + 24 random bytes base64url
(`edge-device-credential.js:24,27,78`); server keeps SHA-256 `keyHash` + 13-char
`keyPrefix` (`:85-86`); audit rows carry no material (`:93-101`). **No
`expiresAt` exists** — lifetime is unbounded until `REVOKED` (`:140-143`).
Device side: Windows **DPAPI** (`CryptProtectData`, user-bound,
`credential_store.rs:58-63`), non-Windows errors (`:54-57`); plaintext
legacy files are re-sealed on load (`commands.rs:110-118`); the key never
enters env (`supervisor.rs:544-547`, `desktop-worker.ts:188-199`) and never
appears in status (`commands.rs:122-129`, test `:428-439`).

**Every edge call** (`claim/route.js:11-13`, `[id]/complete`, `[id]/fail`):
`ZURI_LINE_SERVER_ENABLED === 'true'` else 503; `resolveEdgeDeviceContext`
(`edge-device-credential.js:181-202`): bearer with `edgk_` prefix → hash
lookup → `status === 'ACTIVE'` → **write** `lastUsedAt` → context. Returns
`null` for every failure shape → one indistinguishable 401. Job layer then
re-checks tenant/business scope, `claimantId === credentialId`, `version`,
`CLAIMED`, live lease and live account (`line-conversation-jobs.js:248-256`).

**Desktop runtime (FR-150).** `start_worker` (`desktop.rs:85-179`) pre-flights
the Ollama model list and refuses a missing model (`:104-114`); paths come
from `current_exe()` only (`:124-125`). `Supervisor::start`
(`supervisor.rs:176-325`): `validate_config` (`:403-450`), `verify_package`
— `manifest.json` v1, Node `v24.19.0`, SHA-256 of every listed file confined
to the package root (`:825-888`), exclusive lock handle (`:453-480`),
`env_clear()` + 11-name allow-list (`:512-530`), Job Object
`KILL_ON_JOB_CLOSE` (`:247-255`), single `initialize` line on stdin
(`:497-505`), 15 s `ready` timeout (`:293-323`); stdout lines ≤4096 bytes
re-built through `safe_event` (`:757-823`). **On child exit: state `FAILED`,
`failure = WORKER_EXITED`, handle dropped — nothing re-spawns**
(`supervisor.rs:658-687`); restart is a human clicking Start (`desktop.js:172`).

**Claim loop.** `poll_interval_ms 5000`, `heartbeat 40000` hard-coded
(`desktop.rs:174-175`, `supervisor.rs:105-106`); [obs] observed cadence ~7 s
(5 s sleep + ~1.7 s round-trip). One job at a time; the loop **always sleeps
`pollMs` even after a completed job** (`conversation/worker.ts:47-53`); backoff
5→10→20→30 s on failures (`:47`). No lease renewal: the device only re-reads
`leaseExpiresAt` (`:17,24,30`); an overrun returns `lease_expired` **without
calling `fail`** (`:30`). Executor budget `lease − 15 s`, cap 240 s
(`executor.ts:53-55`), yet headless `timeout: 120000`/`max_turns 8`
(`desktop.rs:155-156`).

**`/complete` and `/fail`** (`conversation/client.ts:55-61`): `{version,text}`
≤5000 chars, `{version, code ∈ EXECUTION_FAILED|LOCAL_POLICY_UNAVAILABLE}`,
`redirect:'error'`, 15 s timeout, claim body capped at 100 KB (`:42-48`).
`fail` is sent only when the answer *throws*; **a model failure does not
throw** — `answerWithModel` returns the rules fallback (`llm.ts:337-339`),
`executor.ts:90` drops `source`/`reason`, and the worker calls `complete()`.

**Heartbeat.** Worker → `POST /api/agent/heartbeat` every 40 s
(`zuri-api/heartbeat.ts:79-143`) with a probed status (`degraded` when RAG or
the model is missing, `desktop-worker.ts:410-432`) → a **process-local Map**
on the server (`edge-device-registry.js:14-40`, window 120 s) that **no server
UI reads** (grep for `api/agent/heartbeat` under `apps/server/src` → only the
OpenAPI table). On the desktop, all four "last verified" renders read the
*persisted* `last_heartbeat_at` that only the manual shell path writes
(`desktop.js:490,493,524,539` ← `commands.rs:324-327`) — [obs] `null` while the
worker is running.

**`packaged_runtime_tests.rs`** (`#[ignore]`, needs
`ZURI_DESKTOP_TEST_PACKAGE`, `:17-19`) proves: RUNNING against a 204-only
claim stub, idempotent start, a heartbeat within 8 s, clean stop, `FAILED`
after `taskkill`, and that a *subsequent explicit `start`* works
(`:112-116`); no `edgk_` in snapshots (`:124`). It does **not** prove
supervised restart, a real claim/complete/fail, the 401 path, or any provider.

### 2.2 Where documents and code disagree

| # | Document says | Code/runtime | Anchor |
|---|---|---|---|
| D2.1 | FR-144 note `:128-134`: the exe "is a control-shell exe, not an installer or bundled compute worker" | `verify_package` *requires* `runtime/node.exe` + `worker/dist/desktop-worker.js` (`supervisor.rs:78-109, 825-888`); the installed 0.3.2 package has both | stale relative to FR-150-P2 |
| D2.2 | ADR-041 D3 `:45,54`: secrets "exclusively within the local `.env`"; credentials edited "via `http://localhost:8787/gui`" | DPAPI-sealed `edge-config.json` (`commands.rs:78-99`); Tauri registers no HTTP listener (`lib.rs:67-87`); 8787 is closed [obs]; the Studio still deep-links to `localhost:8787/gui` and `/graph` (`LineStudioEdgeConnection.jsx:396-420`) — dead links from any browser that is not the device | — |
| D2.3 | `PHASE-FR-150-P2…md:69-73`: "keep the worker as the sole periodic heartbeat sender so a healthy GUI cannot conceal degraded execution" | the worker is the sender; the GUI never reads its result (`desktop.js` reads config, not `supervisor.rs:741-747,398`) | the display half was not built |
| D2.4 | RCA `2026-09-08-edge-desktop-runtime-contract-gap.md:50,52,54,146-153` list open defects | all four are now fixed (`pairing.rs:43-47`, `desktop.js:3`, `commands.rs:122-129`, `lib.rs:84-86`); `:181-185` "crash and **restart**" — the "restart" is the test calling `start` (`packaged_runtime_tests.rs:112`) | RCA not updated |
| D2.5 | Project memory / RCA topology notes: "native server route deployed but `LINE_SERVER_DISABLED`" | `ZURI_LINE_SERVER_ENABLED` is set in `zuri-ai-web-1` [obs env names], claims answer 204 not 503, 8 EDGE jobs `RECORDED` | stale |

### 2.3 Gaps

**G2.1 — A crashed worker never restarts.** `supervisor.rs:658-687`. *Condition:*
any child exit not initiated by Stop (OOM, Node fault, Windows update, a
`taskkill`). *How noticed:* a human looking at the Desktop window; the server
side sees heartbeats stop, in a registry nothing renders. *Blast radius:*
every EDGE conversation for the Business: 45 s later the reply token is dead,
30 min later `EXECUTION_EXPIRED`, customer silence throughout (= G1.4).
[obs] 12 `.worker-runtime-*` scratch dirs created today suggest ~12 start/stop
cycles; the cause is unverified.

**G2.2 — The failure reason is overwritten before anyone reads it.**
`AUTH_FAILED` (revoked key), `CONTRACT_INCOMPATIBLE` (404), `HEARTBEAT_FAILED`
are set by `record_event` (`supervisor.rs:748-751`) and then replaced by
`WORKER_EXITED` in `monitor_child` because the state is `FAILED`, not
`STOPPING/STOPPED` (`:671-674`); `last_event` becomes `stopped` (`:727`). The
UI shows a generic Thai error + `WORKER_EXITED` (`desktop.js:17,541`). *A
revoked key is indistinguishable from a crash* — the correct remedy
(re-pair) is not discoverable. (Code-read; unverified at runtime — settle by
pointing a packaged worker at a 401.)

**G2.3 — Ollama down = silent quality collapse reported as success.** See
G3.2/G3.3: rules fallback → `complete()` → server `ANSWER_READY` with
`executionEvidence: EXTERNAL_CONTEXT_NOT_REPORTED` (`line-conversation-jobs.js:259`).
Both sides record success; the only truthful signal (`degraded` heartbeat) is
unrendered. *This is the exact failure `heartbeat.ts:39-47` was written to
prevent.*

**G2.4 — Revocation has no operator surface.** `DELETE
/api/platform/edge-devices/credentials/{id}` exists
(`credentials/[id]/route.js:16-22`); no page calls it (grep: OpenAPI table
only); the Studio list shows a status badge and no button
(`LineStudioEdgeConnection.jsx:326-337`). AC-144.5 is satisfied by the
resolver and unreachable by the intended actor. [obs] the one REVOKED row was
made somehow — presumably by hand.

**G2.5 — Manual-mint files carry the operator's browser origin.** A file
minted from a `http://localhost:3000` tab pairs the device to *itself*;
`pairing.rs:10-11` and `supervisor.rs:416-426` accept loopback http; the
worker starts and reports `DEGRADED` forever, indistinguishable from a
network outage. The QR path cannot make this mistake.

**G2.6 — No lease renewal; an overrun is redone, not failed.** `worker.ts:30`
returns `lease_expired` without `fail`; `maintenance` requeues the job
(`line-conversation-jobs.js:135-136`) for the *same* device to redo; the
Desktop shows RUNNING/claimAccepted (`supervisor.rs:731`); the loop runs until
`JOB_TTL_MS`. Also the worker's own 240 s cap vs the headless 120 s default
means the budget is not the binding constraint the code thinks it is.

**G2.7 — Scratch directories leak on every non-graceful exit.**
`mkdtempSync` (`desktop-worker.ts:376`) removed only on the two clean paths
(`:511-514, 523-526`); `TerminateJobObject` skips both; [obs] 12 today, each
can hold `memory/` and `headless-sandbox/`.

**G2.8 — Two lock schemes that cannot see each other.** Native exclusive
handle on `.zuri-desktop-worker.lock` (`supervisor.rs:453-480`, never deleted
by design `:486-490`) plus the Node `openSync('wx')` `.zuri-worker.lock`
(`desktop-worker.ts:164-180`) which the supervisor disables via
`ZURI_DESKTOP_NATIVE_LOCK=1` (`:536` → `:381`). A CLI worker and a supervised
worker in the same data root both succeed; `EXTERNAL_UNVERIFIED` detects only
a second *supervised* instance. Combined with `start-edge-stack.ps1:185-189`'s
`-NoComputeWorker` flag being the only guard against a second claimant, the
"one device, one claimant" invariant holds by a task-action string.

**G2.9 — Serial claiming with a mandatory 5 s gap** (`worker.ts:47-53`): a
backlog of N messages drains at N × (answer + 5 s). Not a bug; nobody has
written the ceiling down, and it is the reason the reply-token margin in G1.2
is so thin.

### 2.4 Refinements

**R2.1 — Supervised restart with bounded backoff, and keep the first failure.**
In `monitor_child` (`supervisor.rs:658-687`): if `failure` is already set,
do not overwrite it; if the exit was not operator-initiated and the failure
is not `AUTH_FAILED`/`CONTRACT_INCOMPATIBLE`/`PACKAGE_INVALID`, re-run
`start` after 5 s → 10 s → … → 60 s, max N per hour, surfacing the count.
Auth/contract failures stay terminal and say so in Thai. *Trade-off:* a
restart loop can mask a persistent crash — hence the cap and the visible
count. *Rejected:* a Windows service wrapper — it moves the problem to a
process that cannot show the user anything.

**R2.2 — Show the worker's heartbeat, on both ends.** Desktop: read
`lastHeartbeatAt`/`claimAccepted`/`status` from `get_worker_status`
(`supervisor.rs:398`) instead of the config field. Server: render
`GET /api/agent/heartbeat?businessId=` on the Studio Edge Connection card with
the `degraded` reason — the data already exists (FR-141); and since the
registry is process-local, add a `lastHeartbeatAt` to `EdgeDeviceCredential`
(one column + migration) so a web restart does not blank it. *Trade-off:*
the agent charter owns no Prisma models by design (`edge-device-registry.js:14-24`);
the column belongs to identity's `EdgeDeviceCredential`, not agent — so it
is a charter-consistent place. *Rejected:* persisting the whole heartbeat —
it is a cache.

**R2.3 — Make model failure truthful at the boundary.** Return `{text, source,
reason}` from the executor (`executor.ts:90`) and (a) send `source:'rules'` in
the heartbeat status, (b) when `source === 'rules'` *and* the catalog is
empty (G3.3), call `fail(job, 'EXECUTION_FAILED')` instead of `complete` —
which, with R1.3, becomes a holding message rather than a wrong answer.
*Trade-off:* fewer "answers", more holding messages while Ollama is cold.
*Rejected:* adding `source` to the `/complete` wire — a device must not be
able to label its own evidence quality; the server records
`EXTERNAL_CONTEXT_NOT_REPORTED` on purpose.

**R2.4 — Revoke button + expiry.** Add the revoke control to the Studio list
(the route exists) and an optional `expiresAt` to `EdgeDeviceCredential`
checked in `resolveEdgeDeviceContext` (FR-144 is silent on lifetime; ADR-061
D8 says "with expiry" only for the LINE secret mount). *Trade-off:* a
migration.

**R2.5 — One origin authority for pairing.** Manual mint should take
`resolvePublicBaseUrl()` from the server (as the QR path does) and the
device should refuse a loopback origin outside a `--dev` flag. *Rejected:*
warning in the UI — the wrong file still gets imported.

**R2.6 — Lease renewal or fail-on-overrun.** Either a `POST
/api/edge/conversation-jobs/{id}/heartbeat` that extends `leaseExpiresAt`
by CAS (mirrors the knowledge runtime's `heartbeat` at
`knowledge-runtime.js:71`), or make `worker.ts:30` call `fail` on
`lease_expired` so the job does not loop. The second is one line; do it
first.

**R2.7 — Clean scratch dirs on start** (delete `.worker-runtime-*` not
owned by a live lock), and unify the two lock files under one name.

---

## Flow 3 — Local RAG at the edge

Paths under `apps/edge/` unless stated; the standalone checkout is
`C:\Users\pc\workspace\zuri-edge-device` ("standalone"). Runtime probes were
read-only (`netstat`, `GET /health`, `GET /api/tags`, `GET /api/ps`,
`schtasks /query`).

### 3.1 The flow as it actually is

**Who is listening [obs, 2026-09-10 ~03:30 ICT]:**

| Port | Process | Source |
|---|---|---|
| 8888 | `node --import tsx scripts\rag-serve.ts` (PID 17472, since 09-09 20:19) | **standalone** checkout — `/health` reports `storePath: …\zuri-edge-device\data\genesis_smartgift_store_v4\2026-09-02T19-11-46-617Z`, `ok:true`, `staleRun:false` |
| 8891 | `python scripts\embed-sidecar.py` (uvicorn, FastAPI, sentence-transformers) | standalone; `/health` → `intfloat/multilingual-e5-small @ 614241f6…`, dim 384 |
| 11434 | `ollama.exe serve` | user-level autostart; `qwen3.5:9b` pulled (6.6 GB), **not resident** (`/api/ps` → none) |
| 8787 | nothing | the ADR-041 GUI/webhook tier is not running |

Autostart: scheduled task `ZuriEdgeStack` (AtLogon, last result 0) runs
`…\zuri-edge-device\scripts\start-edge-stack.ps1 -TransportOwner SERVER
-NoComputeWorker`. It waits for Ollama (`:169-173`), starts the sidecar
(`:176-177`) then the RAG service (`:181-182`), and deliberately does **not**
start a compute worker (`:185-189`). The compute worker is the Tauri app's
child: `zuri-edge-device.exe 0.3.2` supervising
`C:\Users\pc\ZuriEdgeDesktop\0.3.2\worker\dist\desktop-worker.js`.

**The client.** `GenesisLocalRag` (`src/rag/genesis-rag.ts`) has three
endpoints — `POST /api/rag/search` (`:90`; with `browseAll`, `qty`,
`budgetPerUnit` at `:117`), `POST /api/rag/price` (`:141`), `GET /health`
(`:170`) — default base `http://localhost:8888` (`:46`, `:83`), **3 000 ms**
timeout (`:47`) via `v4/http-client.ts:18-19`. It never throws: search returns
`unavailable:true, matches:[]` (`:60-71`, `:98`), price returns
`found:false, unavailable:true` (`:156-166`).

**Loopback enforcement** is not in the client. It is (a) the conversation
executor: `isLoopbackUrl` (`src/conversation/contract.ts:51-57`) → `throw
ConversationError('LOCAL_POLICY_UNAVAILABLE')` at `executor.ts:32`; (b) the
desktop worker's init validation (`desktop-worker.ts:129`, model URL `:140`,
cloud origin `:104-114`); (c) the server's default bind `127.0.0.1`
(`v4/serve.ts:194`, overridable by `RAG_HOST`); (d) Tauri validates the
Ollama origin (`src-tauri/src/providers.rs:763-783`). The legacy CLI/webhook
path takes `GENESIS_RAG_API_URL` raw (`src/cli/index.ts:685,741`,
`src/history/webhook-server.ts:488`, `src/mcp/pricing-server.ts:63`).

**The server** (`v4/serve.ts`): four routes (`:143` health, `:148` graph,
`:156` search, `:174` price), 404 otherwise (`:184`); opens the GenesisBlock
native addon `@freshair129/gks-genesis-block-native` read-only at startup
(`:113-121`; binding at `v4/genesis-binding.ts:15-19`); embeds one text per
search through 8891 (`search.ts:245`) with a **5 000 ms** embed timeout
(`serve.ts:69`); returns **503** for the whole service when the sidecar is down
(`:145`).

**Answer path.** Retrieval is exposed to the model as tools, not stuffed into
the prompt: `createConversationExecutor` (`conversation/executor.ts:43-93`) →
`provider: 'openai-compatible'` when `llmBaseUrl` set (`:60`), model from
config (`:65`), `timeoutMs = min(job, llmTimeoutMs || 12 000)` (`:68`),
`maxIterations: 4` (`:69`), `redirect:'error'` on every fetch (`:50`).
`answerConversation` computes the deterministic answer first (`respond.ts:342`),
then `answerWithModel` (`llm.ts:287-340`) with five tools (`llm.ts:147-270`:
`quote_price`, `find_within_budget`, `search_products` → 8888; `lead_time`,
`explain_policy` local). Post-checks: every figure ≥100 must appear in
evidence or the customer's text (`llm.ts:134-145`); a product list with zero
tool calls is refused (`:114-117`); either → deterministic fallback
(`llm.ts:298-303`, `respond.ts:338-352`) computed from the **on-disk rmb
catalog**, not from RAG (`respond.ts:171-195`).

**Model choice.** Desktop: `edge-config.json` → `ollama_model: "qwen3.5:9b"`,
`ollama_base_url: http://127.0.0.1:11434`, `allow_cloud:false`; `desktop.rs:129-142`
sends `llm_base_url = <base>/v1`, `llm_model`, `llm_num_ctx: 8192`, `rag_url:
http://127.0.0.1:8888` (`:173`); supervisor exports `GENESIS_RAG_API_URL`
after `env_clear()` (`supervisor.rs:548-551`). Tauri itself only ever calls
`GET /api/tags` (`providers.rs:785-830`) — inference is the Node worker's.
CLI path default is **`claude-opus-5`** with empty base URL
(`src/config/index.ts:265-266`) — a cloud default, gated by `llmAllowCloud`.

**What is in the index.** Manifest of the live store: schema v4.3, created
2026-09-02T19:12Z, 1 537 vectors (`e5_v4`), 11 017 edges; inputs are five
**local files** in the standalone checkout (identity-review JSON, a
FlowAccount xlsx dated **2026-06-21**, `catalog-2026.json`, two alias/map
JSONs). Built by `npm run catalog:ingest-v4` (`v4/ingest.ts:99-198`), upstream
default a sibling checkout `../business-01-smart-gift/...pricelist_master.json`
(`v4/paths.ts:46-54`). **No sync from the server, GKS or MSP exists** — greps
for `gks|ZURI_MSP|SotDataPlane` in `apps/edge/{src,scripts,src-tauri}` hit only
the native package name; GKS's own `docs/reports/2026-08-31-cr-002-response.md`
places `zuri-rag-service:8888` outside GKS's boundary.

### 3.2 Where documents and code disagree

| # | Document says | Code/runtime | Anchor |
|---|---|---|---|
| D3.1 | ADR-042 D4: GenesisBlockDB is "a client-neutral retrieval backend shared across multiple consumers … over standard REST/IPC/MCP endpoints on `:8888`" | one loopback-bound process, four routes, single-writer store ("a second opener would fail or … serve a stale run", `serve.ts:1-10`), no `query-ir.v1` anywhere in `apps/edge` | `serve.ts:143-194` |
| D3.2 | ADR-043 D2.1: Tier 1 "never talks directly to GenesisBlockDB or bypasses MSP governance"; D2.3: GKS "orchestrates RAG pipelines, generates `query-ir.v1`" | the customer-answering path is Tier 1 → Tier 4 in one hop; zero `gks_*` calls; episodic memory is a local dir with `retentionHours: 0` (`executor.ts:76`) | `genesis-rag.ts:11-18` ("talks to `zuri-rag-service` over HTTP and nothing else") |
| D3.3 | ADR-043 D3 promotion chain "Zuri Edge ➔ MSP ➔ Promotion Review ➔ GKS ➔ GenesisBlockDB" | no writer exists; `genesis-rag.ts:5` "this door has no write path"; the only writer is the manual xlsx ingest | — |
| D3.4 | ADR-041 D1/D3: operator GUI at `:8787/gui`, credentials edited there | 8787 closed; task runs `-TransportOwner SERVER` so the webhook branch (`start-edge-stack.ps1:190-192`) never runs; only the Tauri app is up | netstat |
| D3.5 | `.brain/rca/2026-09-08-line-webhook-funnel-502…md:178-180`: task "re-registered with `-TransportOwner LEGACY_EDGE`" | today's action string is `-TransportOwner SERVER -NoComputeWorker`; the script says "the mode the machine runs in since 2026-09-10" (`:41-44`) | the RCA's "current resolution state" is stale, and its own prevention item (an external probe) is still absent |
| D3.6 | ADR-041 D2: checkout at `D:\workspace\zuri-edge-device` | `C:\Users\pc\workspace\zuri-edge-device`, and the code also lives in `apps/edge/` (not mentioned) | same stale-path class CLAUDE.md already flags |

### 3.3 Gaps

**G3.1 — `find_within_budget` is broken end-to-end (verified live, always).**
`searchWithConstraints` deliberately sends `query: ''` (`genesis-rag.ts:107-108`;
called that way by `answer/tools.ts:250-256`), but the route guard rejects it
before `searchV4`'s `browseAll` seed-phrase handling (`search.ts:213-216`) is
reached: `if (!query) send(res, 400, {error:'query required'})`
(`serve.ts:158-161`). Observed: `POST /api/rag/search
{"query":"","browseAll":true,"qty":100,"budgetPerUnit":300}` → **400**; a
non-empty query → 200. *How noticed:* not at all — 400 → `http_400` →
`unavailable:true` → the model is told `ระบบราคาขัดข้องชั่วคราว`
(`tools.ts:267`); `/health` stays `ok:true`; `serve.ts:187` logs only 500s.
`tests/unit/v4-answer-tools.test.ts:137-159` asserts the client sends `''`
against a fake — no test starts the real server. *Blast radius:* the "100 ชุด
งบ 300" question, on both the desktop and legacy paths. [obs] 0 of the 8
production answers contain the unavailable copy, so no customer has hit it
*yet* — the eight were price/lookup turns.

**G3.2 — The model is never warmed on the worker path and is not resident now.**
`warmModel` has one caller, `src/cli/index.ts:965` (legacy `webhook serve`,
not running). `model-warmer.ts:9-12` records qwen3.5:9b **cold 91 s / warm
9 s**; the executor caps the call at 12 s (`executor.ts:68`). [obs] `/api/ps`
→ nothing loaded. *Consequence:* the next customer turn aborts at 12 s →
`model call failed` (`llm.ts:336-338`) → deterministic fallback — which is
G3.3.

**G3.3 — The deterministic fallback has an empty catalog on the desktop path, so it answers "we don't have that code".**
`desktop-worker.ts:240` sets `SMARTGIFT_CATALOG_ROOT = <dataRoot>/catalog`;
`catalog/store.ts:46-58` returns an empty catalog when the dir is missing, with
no error; [obs] `%APPDATA%\zuri-edge-device\runtime-data\` has no `catalog\`.
A well-formed SKU parses as `price` and takes `ไม่เจอรหัส <SKU> ในแคตตาล็อกค่ะ`
(`respond.ts:181`) — a confident denial of a product that is in the RAG index.
[obs] 0 of 8 production answers contain that copy so far. *This is the one gap
where the system says something false rather than "I can't".*

**G3.4 — Client timeout (3 s) < server embed timeout (5 s).** A 3–5 s embed
completes server-side and is reported client-side as `timeout`
(`genesis-rag.ts:47` vs `serve.ts:69`); indistinguishable from G3.1's text;
`search.ts:336` returns `timing.embedMs` and nothing records it.

**G3.5 — Failed job = silence to the customer.** `conversation/worker.ts:23-29`
→ `client.fail(job, code)` → server `FAILED, answerText:null`
(`line-conversation-jobs.js:254`); the dispatcher selects only `READY`
(`:325`). [obs] 4 production jobs ended this way (`LOCAL_POLICY_UNAVAILABLE`)
— same finding as G1.3, seen from the device side. The device-side trigger at
`executor.ts:32-39` is: non-loopback RAG URL, or a `LOCAL_ONLY` job on a
cloud-configured device.

**G3.6 — Single store owner; nothing restarts the service after an ingest.**
`serve.ts:116-121` opens the run named by `CURRENT` once; ingest can only warn
(`ingest.ts:227-243`); `staleRun` is a `/health` field nobody polls.

**G3.7 — Loopback is enforced twice on one path and zero times on the other.**
(`contract.ts:51-57` + `desktop-worker.ts:129` vs `cli/index.ts:685,741`,
`webhook-server.ts:488`, `pricing-server.ts:63`; the client's own default is
unvalidated `localhost`).

### 3.4 Refinements

**R3.1 — Fix the `browseAll` guard and add one real-server test.** In
`serve.ts:158-161` accept an empty query when `browseAll === true` (the
handling already exists at `search.ts:213-216`); add a test that boots
`startRagServer` on an ephemeral port and posts the exact body
`searchWithConstraints` sends. *Trade-off:* none material. *Rejected:* having
the client send a synthetic query — `genesis-rag.ts:107-108` explains why the
client must not invent text.

**R3.2 — Give model residency one owner.** Either `keep_alive: -1` in the
worker's chat requests (`openai-compatible.ts:112` region; Ollama honours
`keep_alive` in the request body) plus a warm call in `desktop-worker.ts`'s
init, or `OLLAMA_KEEP_ALIVE=-1` on the Ollama autostart. Prefer the request
body: it travels with the code that needs it. Also raise `llmTimeoutMs` on the
first turn after start. *Trade-off:* 6.6 GB of RAM held permanently on the
workstation. *Rejected:* warming from `start-edge-stack.ps1` — it explicitly
disclaims Ollama ownership (`:162-168`) and the task runs before the desktop
app.

**R3.3 — Never deny a SKU from an empty catalog.** In `respond.ts:171-195`,
if the loaded catalog has zero items, route `price` intents to the
"cannot answer now" copy (as `fallbackFor` already does for search/unknown at
`:322-328`) rather than `ไม่เจอรหัส`; and have `desktop-worker.ts` refuse
`READY`/report `degraded` when `SMARTGIFT_CATALOG_ROOT` is empty (it already
reports `degraded` for a missing model, `:414-430`). *Trade-off:* a slightly
less helpful fallback. *Rejected:* shipping the catalog inside the desktop
package — it is business data with its own refresh cadence.

**R3.4 — Align timeouts and record them.** Client 3 s → 8 s (or server embed
5 s → 2.5 s); log `timing.embedMs` from `search.ts:336` on the server.

**R3.5 — ADR-042 D4 and ADR-043 D2/D3 should be amended, not worked around.**
Either restate D4 as "the *edge* retrieval service is a loopback, single-
consumer, read-only projection of a hand-ingested catalogue; GKS/MSP are not
in the customer path" (what is true), or schedule the work that makes the ADRs
true. Today the ADRs describe a system that does not exist and the RCA
(`D3.5`) describes a machine state that no longer exists. *Rejected:*
leaving them — this is the second and third document tonight whose claim the
runtime contradicts.

**R3.6 — Make the launcher canonical in one place** (see Cross-cutting X2):
the standalone `start-edge-stack.ps1` is newer than the monorepo copy and is
the one the scheduled task runs.

---

## Flow 4 — Knowledge chain (ADR-067 push receiver, ADR-068 MSP pull, GenesisRAG17)

### 4.1 The flow as it actually is

**Receiver (ADR-067) [code]:** four routes under
`apps/server/src/app/api/pipelines/knowledge/[executionRunId]/{,stages,gate,finish}`
each try `resolveSotDataPlaneViewer` (bearer `sdpk_…`, SHA-256 lookup,
`sot-data-plane-auth.js:80-92`) then fall through to the session viewer. Present
in the running image (route manifest verified by the 09-07 RCA; env names list
shows no `ZURI_MSP_*`). **[obs]** `SotDataPlaneKey`: exactly **1 ACTIVE** row
(minted for the FR-100 SoT connector; whether GKS/GenesisBlockDB ever held it
is unverified — `lastUsedAt` not read). `PipelineRun`: no rows.
`KnowledgeEvidenceCursor`: 0 rows.

**Pull (ADR-068) [code]:** `POST /api/pipelines/knowledge/evidence/pull`
(`evidence/pull/route.js:17-23`) → `createMspTransportFromEnvironment` → `null`
when `ZURI_MSP_COMMAND` unset → 503. **[obs]** unset in the web container
(env names enumerated; MSP code not in image). `pullKnowledgeStageEvidence`
requires an installation operator (`knowledge-evidence-importer.js:183`).
Transport (`msp-stdio-transport.js:64-145`): spawn one MSP child **per call**,
`initialize` → `notifications/initialized` → `tools/call`, 15 s default
timeout, `child.kill()` in `finally`. MSP in turn spawns GKS per call
(`Memory-and-Soul-Passport/apps/msp-server/src/providers/gks-stdio-provider.mjs:19-22`,
`MSP_GKS_COMMAND/ARGS/CWD`). So one evidence pull = three processes and two
handshakes; and each MSP start refuses without `MSP_DB_PATH`
(`apps/msp-server/bin/msp-server.mjs:6-15`).

**GenesisRAG17 (ADR-073) [code]:** `genesisrag17-worker.js` calls
`msp_pipeline_submit / claim / graph_receipt / write_receipt / stage_failure /
gate / publication_receipt / evidence` (`genesisrag17-contract.js:26-33`).
`knowledge-runtime.js:143-150` + `src/instrumentation.js:5-8` start the
boot-owned admission loop only when `ZURI_KNOWLEDGE_ENABLED === '1'` **[obs:
unset in prod]**, and `resolveKnowledgeRuntimeBinding` additionally needs
`ZURI_KNOWLEDGE_BINDINGS` (exactly one entry) and an MSP transport
(`knowledge-runtime.js:19-40`). **[obs]** `KnowledgeEvidenceCursor` = 0 rows,
`PipelineRun` groupBy = no rows: the ledger has never held a knowledge run in
production.

### 4.2 Where documents and code disagree

| # | Document says | Reality | Anchor |
|---|---|---|---|
| D4.1 | ADR-068 D1: "Nothing here imports from the MSP repository; **the wire is the contract**" and ADR-073/FLOW doc link MSP, GKS and GenesisBlock at `codex/ki17-integration` | zuri-ai `main` calls eight `msp_pipeline_*` tools; MSP **`main`** (`8b8667d`) exposes none of them — its tool list is `msp_context_*`, `msp_evidence_record`, `msp_knowledge_evidence_export`, `msp_knowledge_promote`, `msp_memory_*`, `msp_vault_*`, `msp_workspace_register`; `pipeline-handlers.mjs` exists only in the `msp-ki17` worktree (branch `codex/ki17-integration`, no open PR). GKS `main` (`7b6e310`) has `gks-core/src/{index,resolve}.mjs` only; `pipeline.mjs`/`temporal.mjs` exist only on `gks-ki17`. | `genesisrag17-contract.js:26-33`; `Memory-and-Soul-Passport/apps/msp-server/src/transport/handlers/` (4 files on main, 5 on ki17); `Genesis-Knowledge-System/packages/gks-core/src/` |
| D4.2 | ADR-073 header: "moves this **unmerged branch** declaration…" (v1.3.0b) | ADR-073 and `genesisrag17-worker.js` are on zuri-ai `main` (`ddd02b41`) | `docs/decisions/ADR-073…md:22-30` |
| D4.3 | ADR-068 Consequences: `KnowledgeEvidenceCursor` migration "**not applied** to production" | table exists, 0 rows (also found by the 09-07 RCA) | ADR-068 §Consequences vs probe |
| D4.4 | FLOW doc: "worker loop ที่เริ่ม/หยุดและ resume ได้ … ไม่มี production deployment" (honest) vs ROADMAP/ADR language elsewhere | consistent with runtime: nothing is enabled | — |

### 4.3 Gaps

**G4.1 — The 17-stage chain is a four-repository feature of which one repository has merged.**
zuri-ai `main` depends on tool names that exist only on three unmerged
`codex/ki17-integration` branches (MSP, GKS, GenesisBlock). Any deployment that
sets `ZURI_MSP_COMMAND` to MSP `main` will get `MSP_TOOL_ERROR` on the first
`msp_pipeline_submit`. *How noticed:* only when someone tries; today the 503
at the pull route masks it. *Blast radius:* the whole knowledge feature; no
customer path today (LINE answers do not touch MSP —
`line-execution-trace.js:41-42`, `server-line-answer.js` "no memory").

**G4.2 — ADR-068 D1's spawn transport cannot run inside the shipped container, and it leaks the container's environment.**
(a) The image has no MSP, no GKS, no Node for them beyond the app's own, and no
SQLite path to own — `createMspTransportFromEnvironment` will always be `null`
in this deployment shape. (b) `spawn(command, args, { cwd, env })` passes the
*entire* `process.env` (`msp-stdio-transport.js:68`) — `DATABASE_URL`,
`ZURI_LINE_REPLY_SEAL_KEY`, `OPENAI_API_KEY`, `ZURI_SESSION_SECRET`, the
worker token — into MSP, which forwards its env to GKS the same way. ADR-068
D1 is silent on env scoping. *Blast radius:* if MSP is ever configured, every
Tier-1 secret is readable by Tier-2/3 code.

**G4.3 — Three processes per call, with an `initialize` handshake each time.**
`DEFAULT_TIMEOUT_MS = 15_000` applies per JSON-RPC request; MSP's own GKS
spawn adds its own startup. An evidence page pull is therefore bounded by
~30 s of pure process startup before any data moves. Acceptable for an
operator tick; not for the boot-owned loop at `intervalMs = 1000`
(`knowledge-runtime.js:66`), which would fork MSP+GKS every second per pending
job (`genesisrag17-worker.js:83-124` → `resumeGenesisRag17Worker` →
`send(...)` per batch).

**G4.4 — The receiver has no caller.** GKS never calls outward (ADR-068
context); GenesisBlockDB's worker on `codex/ki17-integration` reports through
MSP, not to these routes; the one ACTIVE `SotDataPlaneKey` [obs] was minted
for the FR-100 SoT connector (ADR-047), and ADR-067 D1 widened *that same key
family* to the knowledge receiver — so whoever holds the SoT key can now also
write Stage 9–17 events for the Tenant. ADR-068 D4 keeps the routes "for a
tier that may call outward" — today that tier is nobody. Dead surface with a
live auth resolver (`findUnique` + `updateMany lastUsedAt` on every bearer
that starts with `sdpk_`).

**G4.5 — The audited Stage 12 / temporal / negation / identity defects (RCA 09-08) live on the unmerged GKS branch** — so they cannot be fixed on GKS `main` (which has no Stage 10–14 at all) and are invisible to zuri-ai CI (acceptance tests skip without the sibling repo roots — `tests/acceptance/harness.js:20-26` hard-codes `ki17-test-*` credentials).

**G4.6 — No MSP database exists; no `MSP_DB_PATH` decision is recorded.** The
only `.db` on disk under the ki17 trees is a verification artefact
(`ki17-runtime/verification/20260908-fix-build.db`). Where MSP's SQLite lives
in production (host volume? container? which backup?) is undecided — it is the
Tier-2 store for memory *and* the relay's credential/grant state.

### 4.4 Refinements

**R4.1 — Decide the MSP hosting shape before wiring, and amend ADR-068 D1.**
Two lawful options: (A) MSP as a sidecar container in the same Compose
project, reached over stdio via `docker exec`-style spawn — awkward, and still
one process per call; (B) MSP long-lived in a sidecar with a **local HTTP or
Unix-socket JSON-RPC** listener bound to the Compose network only, with
zuri-ai's transport re-implemented as a persistent client. The prompt notes
MSP "has no HTTP surface" — that is the thing to add in MSP, not to design
around in zuri-ai. **Recommendation: B, with D1 amended** to "zuri-ai reaches
MSP over a loopback/Compose-network JSON-RPC endpoint owned by MSP; the spawn
transport remains the developer-machine and test transport." Keep the
`(name, input) => Promise<structuredContent>` shape so `createMspMemoryPort`
and the importer are untouched. *Rejected:* keeping spawn and baking MSP+GKS
into the web image — it makes the web image a three-repository build and
leaves G4.2(b) in place.

**R4.2 — Scope the child env now (one-line fix, independent of R4.1):**
pass an allow-list (`PATH`, `MSP_DB_PATH`, `MSP_GKS_*`, `NODE_*`) instead of
`env` at `msp-stdio-transport.js:68`. *Trade-off:* MSP needs its own
configuration file/env — which it must have anyway.

**R4.3 — Merge order and a compatibility gate.** Land MSP and GKS
`codex/ki17-integration` (or explicitly retire them) *before* any production
`ZURI_MSP_COMMAND`; add one contract test in zuri-ai that lists the tools MSP
advertises (`tools/list`) and fails if any of `genesisrag17-contract.js:26-33`
is absent — that turns D4.1 from a surprise into a red check. Fix the Stage 12
`predicate` ReferenceError, `unmapped` default, negation confidence, and the
name-only identity grouping on the GKS branch *before* the merge; they are
the audited list in
`.brain/rca/2026-09-08-genesisrag17-code-flow-audit.md`.

**R4.4 — Retire or gate the ADR-067 push routes.** Either mint a key for the
GenesisBlock worker (then it has a caller) or mark the four routes as
`operator-session only` until one exists. A resolver that writes `lastUsedAt`
for a key family with zero rows is surface area with no purpose.

---

## 5. Prioritised list (risk to live customer messages × cheapness)

Safe while serving traffic unless marked **[window]**.

| # | Item | Why now | Effort |
|---|---|---|---|
| 1 | R1.2(a) anchor `replyExpiresAt` to `event.timestamp`/`ingressReceivedAt` (`line-conversation-jobs.js:109`) | the observed 14 s margins say the next slow answer becomes a `LINE_HTTP_400` terminal failure | 1 line + 1 test |
| 2 | R1.2(b) REPLY-400 → PUSH when `allowDelayedPush` (`:378-380`) | turns a guaranteed lost reply into a delivered one; inside ADR-061 D6 | small |
| 3 | R1.1(c) `stop_grace_period: 60s` on `web` **[window: one container recreate]** | removes the most likely trigger of the ack-then-die loss | 1 line |
| 4 | R1.1(a) label `ADMITTING` before the first attempt | makes the loss *findable*; prerequisite for any recovery | 3 lines |
| 5 | R1.3 fallback push + Studio red count for terminal EDGE failures | 4 of 12 production conversations ended in silence | medium |
| 6 | R1.1(b) reconciler in the worker tick for `ADMITTING` rows older than 60 s | closes the known gap end-to-end; PUSH-only by construction | medium |
| 7 | R1.4 throttle `maintenance` + `lastUsedAt` | ~6 → 1 query per idle poll; makes the ngrok histogram meaningful again | small |
| 8 | R1.5 + D1–D5 text fixes (ADR-061 D4, PRD FR-149, route header, evidence comment, compose comment) | two documents currently promise a boundary the runtime no longer has | docs only |
| 9 | R3.2 model residency (`keep_alive:-1` in the worker's chat body + warm on init) — edge only, no server change | `/api/ps` shows the model unloaded now; the next turn is a 91 s cold start against a 12 s cap → rules fallback → G3.3 | small |
| 10 | R3.3 never deny a SKU from an empty catalog + `degraded` when catalog root is missing — edge only | the one place the system says something *false*; 0 hits so far, but every fallback path lands here | small |
| 11 | R3.1 `browseAll` guard fix in `serve.ts:158-161` + one real-server test **[window: restart the 8888 service]** | `find_within_budget` is 100 % broken; masked as "temporary outage" | tiny fix + restart |
| 12 | R2.6(b) `fail` on `lease_expired` (`worker.ts:30`) | stops a redo loop that burns GPU until TTL | 1 line |
| 13 | R2.1 keep-first-failure in `monitor_child` (`supervisor.rs:671-674`) — then supervised restart with backoff | today a revoked key looks like a crash; today a crash is permanent until a human clicks Start | small, then medium |
| 14 | R2.2 render the worker heartbeat (desktop + Studio card) | the `degraded` signal exists and is displayed nowhere; G2.3/G3.2 become visible | medium |
| 15 | R2.3 truthful `source:'rules'` → `fail` when the catalog is empty | closes the false-answer path structurally | small |
| 16 | R4.2 env allow-list in the MSP spawn (`msp-stdio-transport.js:68`) | zero-cost, closes a secret-exposure path before MSP is ever configured | 1 line |
| 17 | X2/X3 make the launcher canonical in one place; move the "one claimant" guard from a task-action string into code | the guard against two claimants is a CLI flag on a scheduled task pointing at the *old* checkout | small, one re-register **[window: edge]** |
| 18 | R2.4 revoke button; R2.5 one origin authority for pairing | incident-response hygiene | small |
| 19 | R4.3 tool-list contract test + merge order for MSP/GKS/GenesisBlock `codex/ki17-integration` | no customer impact today; prevents the first `ZURI_MSP_COMMAND` from failing on tool names | small test, large merge |
| 20 | R4.1 ADR-068 D1 amendment (MSP hosting shape) + R3.5 ADR-042 D4 / ADR-043 D2-D3 restatement | three ADRs describe a system that does not exist | decisions |
| 21 | R4.4 gate/retire ADR-067 push routes; R2.7 scratch-dir cleanup | hygiene | small |

## 6. Things not in the brief

**X1 — The Compose project is assembled from two checkouts, and three `.env` files exist.** [obs]
`docker compose ls` lists **four** config files for project `zuri-ai`:
`zuri-ai-line-ack\apps\server\docker-compose.yml` + overlay (the `web`
container, created 09-09 18:19Z) **and** `zuri-ai\apps\server\docker-compose.yml`
+ overlay (the `line-worker`, created 09-08 15:28Z from image revision
`0eb6c03a`, and `ngrok`, created 09-06). The line-worker therefore runs a
day-older image (harmless today — it is the 28-line tick script — but
`docker ps` shows it as a dangling image id). The primary checkout is stale
at `b17e7258`; a `docker compose up -d --build web` from *there* would ship
old code into the live stack — exactly the CLAUDE.md warning, now armed by
the fact that the primary's compose files are already registered on the
project. And `.env` is **three separate files**, not one hardlink:
`zuri-ai\apps\server\.env` (3866 B, 09-08), `zuri-ai-line-ack\apps\server\.env`
(3866 B, 09-10 01:18), `zuri-ai\.env` (3565 B, 09-10 02:34 — the root
leftover CLAUDE.md says compose cannot see, and it was edited *tonight*).
Which one is authoritative is now a question; `fsutil hardlink list` shows no
links.

**X2 — Three copies of the edge code, and the launcher that governs this machine lives in the checkout the monorepo replaced.**
`zuri-edge-device\src\rag\**` and `apps\edge\src\rag\**` are byte-identical;
`src/conversation/executor.ts` differs (monorepo adds `headlessProviderHome`);
`scripts/start-edge-stack.ps1` differs the *other* way — the **standalone**
copy is newer (`-NoComputeWorker`, `-WorkerRepoRoot`, comments dated
09-09/09-10) and is what the `ZuriEdgeStack` task runs. The third copy is the
packaged 0.3.2 bundle (`C:\Users\pc\ZuriEdgeDesktop\0.3.2`), newer than this
worktree's crate (0.3.1), with nothing recording its source revision
(`manifest.json` hashes files, not commits — unverified). ADR-041 D2 names a
path (`D:\workspace\zuri-edge-device`) that does not exist and does not
mention `apps/edge`.

**X3 — "One device, one claimant" holds by a flag in a scheduled-task action string.**
`start-edge-stack.ps1:185-189` says it plainly: two processes on the same
claim endpoint race, both healthy, whichever wins answers. The only guard is
`-NoComputeWorker` baked into the task's action; re-running `-Install` without
it, or restoring the *monorepo* copy of the script (which cannot express the
flag), silently re-arms the race. The Node lock is disabled under the
supervisor (`desktop-worker.ts:381`) and the two lock schemes use different
filenames (G2.8), so the race would not be detected by either process.

**X4 — Two systems both believe an answer succeeded; nobody owns answer quality.**
Device: model failure → rules fallback → `complete()` (`llm.ts:337-339`,
`executor.ts:90`, `worker.ts:31`). Server: `ANSWER_READY` +
`executionEvidence: EXTERNAL_CONTEXT_NOT_REPORTED` (`line-conversation-jobs.js:259`)
→ sent → `RECORDED` → CRM outbound `source: 'STACK'` (`:293`). With the
catalog root missing on the desktop path (G3.3), the fallback for a SKU
question is a confident "we don't have that code". The chain Ollama-cold →
12 s cap → rules → empty catalog → false answer → server "success" → CRM
"STACK" crosses four owners (edge answer, edge supervisor, Studio jobs, CRM)
and none of them can see it. [obs] not yet triggered in the 8 production
answers (0 contain either fallback copy), and the model is unloaded right now.

**X5 — The truthful signal exists and is rendered nowhere, twice.** The
worker's 40 s heartbeat carries `degraded`/reason to a process-local Map no
server page reads; the desktop GUI reads a config field only the manual shell
writes, so it shows "ยังไม่ได้ตรวจ" while a worker is running. FR-141's
"process-local, per-instance" cost was accepted for a *liveness pulse*; it is
now the only carrier of an *execution-quality* signal.

**X6 — Three clocks for one reply token.** LINE's `event.timestamp`, the
route's `ingressReceivedAt`, and admission's `now` (re-taken per retry). The
deadline uses the last one (`line-conversation-jobs.js:109`), the only one
that moves *later* under the new retry loop; the observed margins were 14–30 s
on a 7 s poll. G1.2.

**X7 — EDGE replies depend on an "optional" service.** The server worker is
`profiles: ["line-server"]` — documented as *optional* in `docker-compose.yml:73-77`
and ADR-061 — yet it is the **only** sender for EDGE-completed jobs, because
`runLineConversationWorker` picks any `READY` row (`:325`) regardless of
`executionMode`. Nothing states this; an "optimisation" that scopes the
worker to SERVER jobs, or a compose invocation without `--profile line-server`,
stops every EDGE reply while every health check stays green (the worker has
`healthcheck: disable: true`).

**X8 — Writes on the authentication path, driven by an untrusted caller's cadence.**
Every edge claim writes `lastUsedAt` (`edge-device-credential.js:191`) and
runs four `updateMany` sweeps (`maintenance`, `:132-142`); every `sdpk_`
bearer writes `lastUsedAt` (`sot-data-plane-auth.js:86-89`). Lease-expiry
policy therefore executes on the device's poll schedule, and a chatty (or
malicious, with a valid key) device is a write amplifier. G1.6/G1.7.

**X9 — One key family, two authorities.** ADR-067 D1 widened `SotDataPlaneKey`
(minted for the FR-100 SoT connector, ADR-047) to the knowledge reporter. [obs]
exactly one ACTIVE key exists. Whoever holds the SoT connector's key can now
write Stage 9–17 evidence for that Tenant. The owner chose reuse; the
consequence that *the existing key gained a second purpose retroactively* is
not written in ADR-067.

**X10 — The knowledge chain is merged in one repository out of four.**
zuri-ai `main` carries ADR-073 (which still calls itself "this unmerged
branch") and code that calls eight `msp_pipeline_*` tools; MSP `main`, GKS
`main` and GenesisBlock `main` have none of it — it lives on three
`codex/ki17-integration` branches with no open PRs. ADR-068 D1's "the wire is
the contract" is true only against branches. The audited Stage-12/temporal/
negation/identity defects live on the GKS branch and cannot be fixed on GKS
`main`, which has no Stage 10–14 at all.

**X11 — ngrok's inspector is not a forensic tool here.** Its 200-entry buffer
is filled by claim polls + heartbeats in ~20 min [obs: oldest 20:34Z, newest
20:53Z]; a LINE delivery is evicted within that window. The `isRedelivery`
evidence used tonight was available only because it was read quickly. The
web container's `line-webhook-*` `console.error` lines (24 h: one 401,
unattributed) and the `RawExternalRecord` table are the only durable record —
and the latter has no delivery-latency or redelivery field.

**X12 — The RCA/memory topology is stale in both directions.** The 09-08
funnel RCA records `LEGACY_EDGE` restored; today's task is `SERVER
-NoComputeWorker` and 8787 is closed. Project memory says "native server route
deployed but `LINE_SERVER_DISABLED`"; production has it enabled and has
answered 8 conversations through it. Two documents, opposite errors, same
week — the same "no external probe" prevention item the RCA itself proposed
is still absent.

**X13 — The legacy forwarding surface is still deployed with its env set.**
`/api/agent/line-webhook` and `/api/agent/line-delivery` exist and
`LINE_WEBHOOK_ENABLED`, `LINE_POC_ENABLED`, `LINE_DM_POC_ENABLED` are set in
the web container [obs env names]. They refuse server-enabled accounts
(`legacy-line-transport-ownership`), so this is dormant, not dangerous — but
`docker-compose.yml:10` still calls it "the LINE webhook seam".

## 7. Unverified (and what would settle it)

| # | Item | Settles it |
|---|---|---|
| U1 | Source of the single 401 `LINE_WEBHOOK_SIGNATURE_INVALID` in 24 h | keep a rolling copy of `4040/api/requests/http` (X11), or log the UA/`isRedelivery` on the 401 path |
| U2 | Whether the 12 `.worker-runtime-*` dirs today are crash cycles or manual restarts | supervisor/desktop logs; `get_worker_status` history |
| U3 | Source revision of the installed 0.3.2 worker bundle | read `C:\Users\pc\ZuriEdgeDesktop\0.3.2\manifest.json` for a commit field; or the packaging job log |
| U4 | Whether ngrok free-tier request metering applies to ~10 k polls/day | ngrok dashboard |
| U5 | Whether the `AUTH_FAILED → WORKER_EXITED` overwrite reproduces at runtime | run the packaged worker against a 401 stub |
| U6 | Whether the ACTIVE `SotDataPlaneKey` has ever been used (`lastUsedAt`) and by which system | one read-only query |
| U7 | Which of the three `.env` files the operator considers authoritative | ask; then hardlink per CLAUDE.md |
