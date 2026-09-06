# Server-owned LINE and optional Edge computation

Status: implemented for review, 2026-09-06. Activation is separate.

Containment implemented (2026-09-06): stateless Codex MCP configuration isolation failed an
isolated CLI reproduction. See the [RCA](../.brain/rca/2026-09-06-codex-stateless-mcp-isolation.md)
and [approved containment specification](CODEX-STATELESS-ISOLATION-PROPOSAL.md).
Stateless Codex jobs now fail before answer execution or process creation with `LOCAL_POLICY_UNAVAILABLE`, without provider fallback. Re-enablement requires verified config isolation; legacy execution retains its existing contract.

Canonical decision: [zuri.ai ADR-061](https://github.com/Freshair129/zuri.ai/blob/main/docs/decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md).
Canonical wire contract: [conversation execution v1](https://github.com/Freshair129/zuri.ai/blob/main/contracts/line-conversation-execution.schema.json).
This implements the Edge half of upstream FR-150; it does not fork that requirement.

## Ownership

Zuri Server owns native LINE ingress, signature/destination validation, account-scoped CRM,
admission policy, durable jobs, final LINE delivery and outbound recording. A cloud-only account
does not need an Edge Device. An account explicitly selecting EDGE computation waits for its
registered Business device; an offline device never silently changes the model or privacy policy.

This runtime performs optional local computation and evidence extraction. It pulls jobs over
HTTPS using its registered `edgk_` credential. It does not need LINE channel credentials, a public
tunnel, an inbound port, a LINE user identifier, or a direct connection to the CRM database.
Model/CLI settings stay local operator configuration; a job cannot name an executable, URL,
query, recipient, filesystem location or business scope.

## Run compute-only

Build with `npm ci` and `npm run build`. Set `ZURI_CLOUD_BASE_URL` to the deployment origin and
install `ZURI_EDGE_DEVICE_KEY` through the existing device-secret mechanism. HTTPS is required
except for explicit loopback development. URL userinfo, query strings and redirects are refused.

```bash
node dist/cli/index.js conversation once
node dist/cli/index.js conversation serve
# npm start and the Docker image also start conversation serve.
```

`once` claims at most one job and prints only outcome and internal job ID. An empty queue is
`idle`, not a successful model execution. `serve` polls one job at a time, reports heartbeat
using the device credential, and finishes its current bounded operation before shutdown.
The heartbeat probes the local RAG service; it is not a claim that a particular model answered.
The PowerShell launcher defaults to SERVER transport and starts this worker after local RAG.
It reports process start separately from health; verify actual claim/heartbeat in the console.

Extraction remains separately available as `extraction once|serve`. Run only the capabilities
needed on the device; coordinate GPU capacity before running two model workers together.

## Claim and completion

1. POST `{}` to `/api/edge/conversation-jobs/claim` with the device bearer.
2. Accept HTTP 204 or the strict version-1 envelope. Extra fields are rejected, including raw
   LINE identity, reply token, client-selected tenant and elevated roles.
3. Honor the server lease, version, conversation key and immutable policy. Answer with the
   existing sales-only local tools. Hash the opaque conversation key before it reaches a path.
4. POST `{version,text}` to `/{id}/complete`, or `{version,code}` to `/{id}/fail`.
   Output is non-empty text of at most 5,000 characters. Failure codes are bounded and never
   include a question, provider response, raw exception or credential.
5. The server validates the current credential and lease again and owns delivery. Completion
   does not mean LINE acceptance, customer delivery or read.

Lease expiry before/during computation drops the stale result. A completion request whose
response is lost is never followed by a failure write or a duplicate local computation in the
same claim. The server decides whether a later lease may retry. HTTP 409 is a stale claim;
401/403/404 stop the loop. Other failures back off to at most 30 seconds. Restart requires no
local queue recovery and no LINE resend.

## Model access and retention

`LOCAL_ONLY` permits deterministic rules or an explicitly configured loopback model endpoint.
It refuses all headless coding agents, remote model URLs, and implicit hosted fallbacks.
The local RAG endpoint is also loopback-only; model and RAG HTTP redirects are disabled.
A loopback URL is an address check, not proof about the daemon's own forwarding behavior:
the operator must configure a model daemon that actually processes locally.

`EXTERNAL_MODEL_ALLOWED` additionally permits the configured external model/CLI. This is
permission to phrase the requested answer, not permission to change CRM, execute arbitrary
shell commands, search the web or author files. Local Codex execution can still use an external
model provider. No provider/model is selected by the question text.

Version 1 fixes `role=sales` and `retainHistory=false`. No Edge transcript is replayed or
written. Owned temporary paths are removed after each turn. Headless execution disables session
persistence (`--ephemeral` for Codex, `--no-session-persistence` for Claude); Codex uses read-only
sandbox and disabled shell tools. Unsupported CLI flags fail the executor instead of weakening
its controls. Provider-side retention remains governed by the selected provider, independently
of these local persistence settings.

Flag references: [Codex CLI](https://developers.openai.com/codex/cli/reference/),
[Codex configuration](https://developers.openai.com/codex/config-reference/),
[Claude CLI](https://code.claude.com/docs/en/cli-reference).

## Explicit legacy cutover

`ZURI_LINE_TRANSPORT_OWNER` defaults to `SERVER`. Legacy webhook and POC CLI entry points fail
closed unless the operator explicitly sets `LEGACY_EDGE`. The webhook library also requires
an explicit legacy owner. Legacy stack reply configuration under SERVER is rejected, and the
conversation worker cannot run under LEGACY_EDGE. The old transport remains available only
for migration, with its signature, operator-key and local outbox protections intact.

1. Upgrade and build both repositories. Keep the server account disabled until cutover.
2. For an existing Edge-owned OA, explicitly select LEGACY_EDGE while preparing migration.
3. Pause inbound legacy processing, settle any in-flight send and drain/reconcile its local outbox.
4. Provision the account's channel secret/token in the server secret store and select execution
   mode. Pair an Edge device only if EDGE computation is needed.
5. Activate the server owner and replace the LINE provider webhook with the account's server
   webhook URL. The launcher does not perform these operations or kill old processes.
6. Stop the legacy process/tunnel and run the compute worker in SERVER mode if needed. Remove
   the unused local LINE credentials through the operator's secret-management process.
7. Send one authorized canary and trace server inbound → job → answer → LINE acceptance → CRM
   outbound. Test Edge offline without switching providers. Inspect UNKNOWN delivery states;
   never blindly replay them.

Rollback is also a quiescent ownership transfer: pause server admission/delivery, reconcile
in-flight sends, disable server ownership, then restore the legacy webhook. Never overlap two
transport owners for an account.

## Verification evidence

Baseline at upstream `96706d91`: 837 tests, 832 passed, 5 optional native-store tests skipped.
Implementation adds strict contract, ownership, local-policy, no-retention, credential rejection,
lease-expiry and ambiguous-completion tests. These are automated contract/runtime checks with
stubbed providers; no live OA message, provider model call or device deployment was performed.
See the change devlog for final command results and limitations.
