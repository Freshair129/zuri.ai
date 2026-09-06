---
version: "0.1.0b"
created_at: "2026-09-06T11:51:02+07:00,RWANG,uncommitted"
last_update: "2026-09-06T11:51:02+07:00,RWANG"
status: "candidate"
superseded_by: null
attributes:
  domain: "edge"
  scope: "Zuri server and Edge monorepo documentation and migration design"
---

# Decision: the edge runtime owns the LINE reply

> Current transport decision: [Server-owned LINE and optional Edge](SERVER-LINE-OPTIONAL-EDGE.md)
> implements upstream ADR-061. New runtimes are compute-only; the transport behavior below
> applies only to explicitly selected `LEGACY_EDGE` installations during migration.

## Candidate central monorepo and execution contract

The owner requested complete migration documentation on 2026-09-06. In the central Freshair129/zuri.ai documentation branch, ZAI:ADR-062 proposes apps/edge in the monorepo with a separately installed/released runtime; ZAI:ADR-061 and ZAI:FR-148-P4 define the optional executor behavior. These qualified citations refer to the central repository, not this repository's local ADR/FR registry. They do not grant production activation or retire this runtime's existing reply-owner rule.

Target: Edge claims compatible jobs over outbound HTTPS, executes only allowed local capabilities, and returns bounded evidence/results under a current Business-scoped lease. Server owns migrated-account LINE credentials, send intents and provider calls. Edge receives no LINE reply token or Server database access; local-only jobs never silently use cloud inference. Device upgrade compatibility is checked against released protocol ranges, not assumed from a common checkout.

Migration first preserves current behavior while moving source; transport cutover follows separately per account. Existing Stack/local sending paths below remain legacy until the central cutover gate pauses/fences them. Do not remove current device configuration, copy .env/customer files into Git, delete the old repo/workspace, or reinstall device data merely because the source is moving. Root global documentation becomes authoritative after reviewed ID/path mapping; old local requirement IDs keep repository-qualified provenance.


Status: **accepted**, 2026-09-05. Supersedes BR-003. Owner decision, delegated to and drafted by
the agent; recorded here because it retires a business rule rather than adjusting a document.

## The conflict

Two repositories stated opposite rules about who sends to LINE, and both were enforced in code.

| | Rule | Where |
| --- | --- | --- |
| This repository | BR-003 — the agent never receives a LINE channel token and never calls the LINE Messaging API directly | `docs/PRD-SDD-v1.0.md`, `AGENTS.md`, `docs/appendices/E-risk-matrix.md` |
| zuri-ai | BR-011 — zuri-cli is the sole LINE reply owner when stack answering is enabled | `src/app/api/agent/line-webhook/route.js` |

zuri-ai's position is deliberate, not an omission:

- `FR-050` has the cloud return reply text to "the sole LINE transport owner" **without receiving or
  consuming the LINE replyToken**.
- `POST /api/agent/line-delivery` is `FR-093`, a receipt sink — "the transport owner reports what it
  actually sent". It records a send; it does not perform one.
- Grepping zuri-ai at `5393f99` for `api.line.me`, `pushMessage` and `replyMessage` returns one UI
  page and no send implementation. There is no route that talks to LINE.

So BR-003 described an arrangement that was never built on the other side, while the deployed system
implemented BR-011. Removing the channel token to satisfy BR-003 would not have promoted anything —
it would have left the OA receiving messages and unable to answer.

## Decision

**BR-003 is retired. This runtime is the LINE reply owner.** It holds a channel access token and
calls the LINE Messaging API directly.

Chosen over building the cloud send path BR-003 assumed, for three reasons:

1. It is the other side's stated design, not an accident to correct. Reversing it is a change to
   zuri-ai's charter, which this repository cannot decide.
2. The physical constraint agrees. A LINE reply token expires in about 30 seconds and arrives here.
   Routing the send back out through the cloud spends part of that budget on a hop that exists only
   to relocate a credential.
3. It is what runs today, and it works.

## What BR-003 was buying, and how each part is kept

The rule was not arbitrary — it bounded what a compromise of this machine could do. Retiring it
means carrying those properties explicitly rather than losing them with the rule.

| Property BR-003 bought | How it is kept now | Where |
| --- | --- | --- |
| The token is not reachable by whoever can reach the port | The settings page and the command console require the operator key (BR-009); the public tunnel carries `/webhook/line` alone. This replaced an earlier and worse rule that forbade the token from `.env` at all — which forbade the only surface an operator has, and was not a control but an unusable product | `src/history/admin-auth.ts` |
| A send cannot be issued twice | Outbox claim is lease-based with an idempotency key; a lost claim quarantines rather than resends | `src/delivery/outbox.ts` |
| A send cannot reach an unintended recipient | A console-initiated push resolves against configured aliases: a user by an id that arrived on a signed event, a group only if the owner configured it. Was false as first written — the code cast past `private` to reach the group path with whatever the request body said | `src/line-poc/targets.ts` |
| Model output cannot invent commercial facts | Any figure ≥100 must trace to a recorded tool result or the customer's own words, or the reply is discarded; a reply that offers products no lookup returned is refused | `src/answer/llm.ts` |
| Every send is recorded centrally | **Still not kept.** The worker now reports a receipt, but a receipt needs a cloud binding this device does not have — see below | `src/delivery/worker.ts` |

## Open obligation: the live path reports nothing

`POST /api/agent/line-delivery` exists and this repository can call it (`stack-client.ts`
`reportDelivery`, invoked from `webhook-server.ts`), but only on the stack reply path, which is off
here — no `ZURI_STACK_*` is configured. The path that actually answers customers is the outbox
worker, and `src/delivery/` contains no reference to `reportDelivery`, `line-delivery` or the stack
client at all.

So every reply this device sends is presently unrecorded by the cloud: precisely the silent loss
FR-093 was written to end. This is the one control retiring BR-003 does not preserve, and it is
recorded as an obligation rather than glossed as acceptable.

Closing it needed two things. **The second is now done** (`src/delivery/worker.ts`): the worker
reports a receipt after a successful push, quoting the inbound row id the cloud named for that
event. Getting that id also required not throwing away the forward's response, which was where it
had always arrived and been discarded.

**The first is still outstanding, and it is not code here.** A receipt is addressed by the cloud's
own `Message.id`, which only exists once the inbound event has been forwarded — and forwarding
needs a server-owned LINE binding, a `bindingId` and a binding bearer, provisioned in zuri-ai
(`scripts/manage-line-binding.mjs`, ADR-020). No `ZURI_STACK_*` is configured on this device, so
nothing is forwarded, no row id exists, and the worker records that a delivery could not be
attributed rather than inventing an id.

Note what this means for the shape of the gap: it is not that the outbound half is unreported while
the inbound half is recorded. With no binding, **the cloud has no record of the conversation at
all** — the local archive under `state/line-history/` is the only account of it in either
direction.

Until a binding exists, the audit trail is the local JSONL archive under `state/line-history/` and
nothing in the cloud. Do not describe this system as having centrally audited delivery.

## Which receipt path a send uses

Two upstream lanes exist, and the split is by **who initiated the send**, not by transport:

| The send | Reported through |
| --- | --- |
| Anything sent in the course of a conversation turn — the reply to an inbound event, and a push made while handling that turn | `POST /api/agent/line-delivery` (FR-093). This is the reply-owner path, synchronous to the inbound event. **A reply is never queued as a job.** |
| Studio-initiated work with no inbound event behind it — rich menu, LIFF, console dispatches, Insight pulls | The job's own `COMPLETED` / `FAILED` result, once `LineOaTransportJob` ships. **Never also through the delivery route**, or the Inbox double-records the same send. |

"One receipt shape" in ADR-060 D5 refers to the job result being identical across `EDGE` and `CLOUD`
claimants. It does not replace FR-093.

Everything this repository sends today is the first kind, so `src/delivery/worker.ts` is on the
correct path and nothing needs migrating. The job lane does not exist on `main` yet — no routes, no
models, and `contracts/line-oa-transport-job.schema.json` is unpublished. Per ADR-059 D6 the
contract ships in zuri-ai first and is coded against here afterwards.

Source: confirmed directly by the session that owns ADR-060, and being written up as ADR-060
v0.3.1 / SRS clause `LOS-RQ-087` in zuri.ai PR #228. **That PR was still open when this was
written** — check whether it merged before relying on the clause number.

## Consequences

- `AGENTS.md`, `docs/PRD-SDD-v1.0.md` and `docs/appendices/E-risk-matrix.md` are updated to match.
  The capability moves from "denied by default with a POC exception" to "allowed conditionally",
  because a permanent architecture described as a temporary exception is a rule nobody can apply.
- `docs/POC-LINE-DELIVERY.md` keeps its operational content, but its promotion exit gate is void:
  it waits for Zuri to own the send, which Zuri has decided not to do.
- The residual risk is real and now stated plainly: this machine can send to customers as the OA,
  and its compromise is no longer bounded by the absence of a credential. The controls above are
  what stand in its place, and the missing one is named.

Version diff unversioned → 0.1.0b (2026-09-06, RWANG): documented central monorepo candidate and optional executor target; runtime behavior unchanged.
