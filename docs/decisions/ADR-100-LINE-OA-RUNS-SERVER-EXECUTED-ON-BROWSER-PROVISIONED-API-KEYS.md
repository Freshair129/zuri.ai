---
id: "ZAI:ADR-100"
title: "LINE OA runs server-executed on browser-provisioned API keys"
version: "0.2.0b"
status: approved
approval_scope: design-and-documentation
approved_on: "2026-09-21"
approved_by: "Owner instruction, 2026-09-21"
integration_status: pending
implementation_status: in-progress
created_at: "2026-09-21"
last_update: "2026-09-21"
author: Claude Opus 5
domain: line-oa-studio
attributes:
  doc_type: architecture-decision
  domain: line-oa-studio
  scope: "Retirement of EDGE execution from LINE OA Studio, withdrawal of the edge conversation-job surface, and browser provisioning of the model provider API key every server answer needs"
relations:
  # The amendment itself is stated in prose below and by a pointer in ADR-061;
  # the link vocabulary here only has relates_to / references / supersedes, and
  # this decision amends parts of ADR-061 rather than superseding the document.
  - type: relates_to
    target: "ZAI:ADR-061"
  - type: relates_to
    target: "ZAI:ADR-060"
  - type: relates_to
    target: "ZAI:ADR-089"
  - type: relates_to
    target: "ZAI:ADR-041"
  - type: relates_to
    target: "ZAI:ADR-059"
  - type: relates_to
    target: "ZAI:FR-265"
  - type: relates_to
    target: "ZAI:FR-266"
  - type: relates_to
    target: "ZAI:FEAT-045"
---

# ADR-100 — LINE OA runs server-executed, on browser-provisioned API keys

**Status:** Accepted on the owner's instruction of 2026-09-21 — *"แก้ไขระบบ LINE OA Studio
ยกเลิกระบบ edge device ใช้เป็นใส่ api key ทั้งหมด"*. The owner scoped the retirement to
LINE OA Studio and named two key families to be enterable from the browser: the model
provider key and the LINE channel key.

**Amends by pointer** (the amended text is not rewritten):

- **ADR-061 D2** — "Transport and execution are independent. New accounts default to CLOUD
  transport and SERVER execution regardless of paired devices. An explicitly selected EDGE
  execution mode uses a paired Business device for computation only." The independence
  claim stands as a description of what the code *was*; for LINE OA there is no longer a
  second option to be independent of. CLOUD transport and SERVER execution are the only
  values, and EDGE is not selectable.
- **ADR-061 D3** — "Edge compute-only is the new daemon default." The daemon keeps that
  default for the work it still has; it no longer has LINE conversation work.
- **ADR-061 D6** — "EDGE work waits for an authenticated device." No EDGE work is created,
  so nothing waits. The `LOCAL_POLICY_UNAVAILABLE` failure this sentence's consequences
  paragraph describes is no longer reachable through a new job.
- **ADR-060 D5** — the account's `transportMode` as a two-valued choice.
- **ADR-089 D1** — the `SecretStorePort` and its two writable stores are unchanged; this
  decision adds the second caller FR-242 already generalised the port for.

**Untouched:** ADR-041 device pairing and the edge credential boundary, and ADR-059
edge-executed asset evidence extraction, keep every route, credential and contract they
have. This decision removes LINE conversation work from the device, not the device.

## Context

Three facts force the decision, each verified in the tree at `5cb31212`:

- **`modelAccess: 'LOCAL_ONLY'` did not mean "a local model answers".** In
  `server-line-answer.js` that branch builds `createDeterministicBusinessModel()` — a
  canned, non-inference answerer — and returns it as `model`. An account configured
  LOCAL_ONLY on SERVER execution therefore replied to real customers with no model call at
  all. The name described an intent the server side never implemented; only the EDGE
  executor ever ran a real local model.
- **EDGE execution's honest failure mode is silence.** ADR-061's own consequences
  paragraph records it: of the first 12 production jobs, 4 ended `FAILED` with
  `LOCAL_POLICY_UNAVAILABLE`. A third of real customer conversations ended in nothing a
  screen could show, which is why the terminal-failure counter exists. Removing the mode
  removes that class of outcome rather than reporting it better.
- **The API-key path is built but has no door.** ADR-089 shipped a browser write-only
  vault for the LINE channel secret (FR-223..228), and FR-242 generalised the
  `SecretStorePort` to `MODEL_PROVIDER_KEY` with the same lifecycle. But the model key a
  server answer actually uses is still resolved by the Phase-1 `zuri_core` resolver, which
  only an operator with shell access can provision. A Business owner can connect their
  LINE OA from the browser and still cannot make it answer.

## Decisions

### D1 — LINE OA conversation execution is server-only

`EDGE` leaves the LINE OA account's vocabulary. `transportMode` admits `CLOUD` alone,
`executionMode` is always `SERVER`, and `SWITCH_TRANSPORT_MODE` is withdrawn as an action.
`CONFIGURE_EXECUTION` survives under its existing name and audit action, narrowed to the
one field that is still a real choice, `allowDelayedPush` — the name is kept rather than
improved because an audit action string is a key, and renaming it would orphan the history
it already wrote (AGENTS.md §18 read one level down).

### D2 — The edge conversation-job surface is withdrawn

`POST /api/edge/conversation-jobs/claim` and the per-job `context`, `tools`, `complete` and
`fail` routes are removed, together with `GET /api/edge/model-residency`, whose only
consumer was the LINE executor deciding whether to hold a local model in VRAM.
`/api/edge/extraction-jobs/**` and `/api/edge/pairing/**` stay exactly as they are.

A device that still calls a withdrawn route gets a 404 from a route that does not exist,
which is the same answer it already gets for a revoked credential's scope and therefore
needs no new vocabulary.

### D3 — `modelAccess` retires, and every server answer calls a real model

The `LOCAL_ONLY` branch and the `EXTERNAL_MODEL_ALLOWED` name both go. There is one path:
resolve the Business's model credential and call the provider. `createDeterministicBusinessModel()`
remains in the codebase as the test double it always effectively was, and is no longer
reachable from a production answer.

This is the decision with a real consequence for money and privacy, and it is stated
plainly rather than buried: before this change an account could be configured so that no
external provider ever saw a customer's message. After it, every answered LINE message on
a server-enabled account is sent to the configured provider under the Business's own API
key. The owner asked for exactly this. The Business-hours shedding of FR-244 and the
out-of-hours canned reply are the remaining ways an account answers without inference, and
both are unchanged.

### D4 — The model provider key is entered in the browser, write-only

A Business owner posts a provider code and an `apiKey` to the Integration lane. The lane
proves the key live against that provider *before* anything is stored, then writes it
through the `SecretStorePort` as a `MODEL_PROVIDER_KEY` credential on a Business-scoped
`IntegrationConnection` with `purpose = 'MODEL_PROVIDER'`. Rotate, revoke and re-validate
reuse the FR-223 lifecycle and the FR-224 write gate — AAL2 step-up and rate limit —
without a second implementation.

No new table. `IntegrationConnection`, `IntegrationCredential` and
`IntegrationCredentialVersion` already carry every column this needs, including
`secretKind`, and FR-242 already taught both stores to refuse a write that would change a
connection's kind underneath a live credential.

The key has no non-secret identifier — unlike a LINE channel ID or an OAuth client ID — so
its display hint is null, never four characters of the key itself. SEC-030 and SEC-033 are
restated by reference, not re-derived.

### D5 — Resolution order, and why the Phase-1 resolver is not deleted in this change

> **Correction, 2026-09-21 (same day, after deployment).** The paragraph below claimed the
> Phase-1 resolver "is the live path production resolves its Anthropic key through today".
> **That was wrong, and it was never checked before it was written.** A read-only probe of
> production taken immediately before the deploy found `zuri_core.integration_connection`
> **empty**, `ZURI_MODEL_PROVIDER` and `ZURI_MODEL_NAME` set to the literal placeholders
> `SET_PROVIDER` / `SET_MODEL_NAME`, and `ZURI_LINE_BUSINESS_AGENT_ENABLED=false`, so the
> fallback raises `PHASE1_CONNECTION_NOT_FOUND` rather than resolving anything.
>
> The *design* below is unchanged and still correct: vault first, fall back only on absence,
> fail closed on a broken key. What was wrong was the factual premise about this
> installation — and with it the Consequences claim that the change "is deployable before
> any Business has used the new form" without answers stopping. It is not: until an owner
> enters a key at `/line-oa`, this installation cannot answer.
>
> That was survivable here only because the account was **already** failing — every job
> since 2026-09-15 expired `FAILED / EXECUTION_EXPIRED` with no device claiming it — so the
> deploy took nothing working away. On an installation whose Phase-1 resolver really is
> provisioned, the original sentence would have been a correct reading; the error was
> asserting it of this one without looking.

`resolveModel` reads the Business's `MODEL_PROVIDER` connection first and resolves its key
through the port. Only when **no such connection exists** does it fall back to the Phase-1
`zuri_core` resolver.

The fallback is a declared transition state with an owner, not a permanent second path. It
exists so that an installation which *has* provisioned Phase-1 is not silenced by deploying
D4, and because retiring that resolver — the roadmap's own note on TASK-ZAI-103 says it
"could not be proven safe within this task without a live/staging smoke test" — is still a
separate step, gated on every live Business holding a vault-backed key.

Neither path falls back to the other on a resolution *failure*. A present-but-broken
credential fails closed. A silent downgrade to a different key is the same class of
ambiguity ADR-061 D6 refuses for an ambiguous send, and it is refused here for the same
reason: the operator must be able to tell "not configured" from "configured and wrong".

### D6 — Existing rows are normalised by a migration nobody applies in this change

One incremental migration sets every `LineOaAccount` still on `transportMode = 'EDGE'` to
`CLOUD`, every `executionMode = 'EDGE'` to `SERVER`, and comments both columns with their
retirement. `LineConversationJob.executionMode` is **not** rewritten: its `EDGE` rows are
evidence of what actually ran, and rewriting history to match a current vocabulary is the
one thing an evidence ledger must not do.

Applying the migration is an owner-instructed operator step (ADR-057). This decision
authorizes the file, not the operation.

## Consequences

An installation that has provisioned Phase-1 keeps answering through that resolver until a
Business enters its own key, and stops depending on an operator the moment one does.

An installation that has **not** provisioned Phase-1 cannot answer at all until an owner
enters a key at `/line-oa`. This one had not — see the correction in D5 — so the deploy of
2026-09-21 left LINE answering blocked on that single owner action. It was deployed anyway,
on owner instruction, because the account had already been failing every job since
2026-09-15: the change did not remove a working path, it replaced a dead one with a path the
owner can complete without an operator.

The lesson recorded here is narrower than "check production first": it is that a decision
record may state a design freely, but a sentence asserting what a *particular* installation
currently does is a claim about the world and needs a reading before it is written down.

A customer running the edge daemon for LINE conversation work loses that capability on the
deploy that removes the routes, not on the merge. Their extraction work is unaffected. The
device continues to pair, hold credentials and claim extraction jobs.

**A job already QUEUED with EDGE at the moment of that deploy is never claimed again.** The
server's claim query filters on `executionMode: 'SERVER'` deliberately: quietly taking over
work that was issued to a device would answer a customer from a place the job never
authorized. Such a job instead reaches its TTL and ends `FAILED` with `EXECUTION_EXPIRED`,
which the Studio's terminal-failure counter already shows for the selected Business. That is
a visible loss rather than a hidden one, and it is bounded — the deploy should follow a
quiescent window, and the count says exactly how many turns fell in it if one does not.

**The new connection does not appear on the operator's integrations page, and that is a
known gap rather than a decision.** `listIntegrationConnections` filters to exactly two
kinds — `purpose = 'PHASE1_LINE_LLM'` and the LINE OA provider — because its health
computation is written for those two and a row it cannot compute health for reads as
permanently unhealthy. A `MODEL_PROVIDER` connection is a third kind and needs its own
health rule (a credential's `status` and `lastValidatedAt`, not ingress evidence). The
Business owner sees it on `/line-oa`, which is where they provision it; an operator sees it
only in the database until that page learns the third kind. Recorded here so the next person
finds a gap with a reason instead of an omission.

`transportMode` and `executionMode` remain as columns. Narrowing an enum to one value and
dropping the column are different changes with different risk, and the second buys nothing
here: the columns are cheap, the history in them is readable, and a future decision that
wants a second execution placement finds the seam still cut.

## Required proof

- An account cannot be created, switched or configured into EDGE transport or EDGE execution.
- The withdrawn edge conversation routes are gone, and `/api/edge/extraction-jobs/**` and
  `/api/edge/pairing/**` still answer for a valid device credential.
- A server answer with no model credential of either kind fails closed with a code an
  operator can act on, and never with a canned answer presented as an inference.
- A model key written from the browser validates live before storage, never appears in a
  response, log, audit payload or Prisma value, and refuses a connection holding another kind.
- `resolveModel` prefers the vault-backed connection, falls back only on *absence*, and
  fails closed on a broken credential in either path.
- A rotation keeps answering; a revocation stops it with a distinguishable code.

## Not decided here

Whether to delete the `apps/edge` application, whether to retire ADR-059 extraction, and
when to retire the Phase-1 resolver. The first two were explicitly excluded by the owner's
scoping of 2026-09-21; the third is TASK-ZAI-103's open exit criterion and needs live
evidence this decision does not provide.
