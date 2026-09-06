---
id: "ZURI-CONVERSATIONAL-ROADMAP"
version: "0.1.0b"
status: "draft"
owner: "zuri-command-agent"
scope: "what remains between today's answering agent and one the team can rely on"
created_at: "2026-08-11T14:00:00+07:00, ATHER"
last_update: "2026-08-11T14:00:00+07:00, ATHER"
---

# Roadmap — the conversational agent

Written to be read before any of it is built. Nothing here is started.

## Where it stands today

Three ways to answer a message exist, and the agent falls back down the list on any failure:

| Layer | State | Reaches LINE? |
|---|---|---|
| Pattern reader (`answer/parse.ts`) | Working, in production | Yes |
| API layer (`answer/llm.ts`) | Working, off — needs `ANTHROPIC_API_KEY` | Yes, fits a reply token |
| Headless layer (`answer/headless.ts`) | Working, off — verified from the CLI only | **No** — see Step 1 |

Verified live on the real 1,088-SKU catalog: a priced answer through the MCP server, a follow-up
that continued the conversation, and a sales-role question about cost correctly refused.

## Step 1 — done, 2026-08-11

Built as described below. Measured end to end with LINE stubbed: the webhook returns `200` in
**27 ms** where it previously held the request open for as long as answering took, the reply token
carries an acknowledgement, and the answer arrives by push afterwards. The record settles to
`DELIVERED` and the raw LINE id is gone from disk — checked by reading the file back, not by
trusting the object.

`config check` now refuses the one combination that looks configured and cannot work: the headless
layer serving a webhook with no queue behind it.

What remains open from this step: nothing in the mechanism, but see *Known limits* in
`CONVERSATIONAL-ANSWER-SPEC.md` for the acknowledgement's cost — a fast pattern answer now costs
two messages where it used to cost one.

**Step 1 — deliver by push instead of by reply token.**

Measured, not estimated: 8.6 seconds for a trivial question with no tools, 20–40 with them. A LINE
reply token lives about 30 seconds and is single-use. So the headless layer cannot answer a webhook
event today, and every capability below inherits that.

The shape:

1. The webhook returns `200` as soon as the event is archived and the sender is resolved. It stops
   waiting for an answer.
2. Answering moves to a worker, keyed by the sender's hash. One in flight per person.
3. The reply goes out with `pushText` (already built), not `replyText`.
4. Because a push is not a reply, an unanswered message is now possible in a way it was not before:
   the worker needs a visible failure path, not a silent one.

Two things become necessary at the same time, and are the reason this is not a small change:

- **The person needs to know something is happening.** Thirty seconds of nothing looks broken. A
  short acknowledgement on the reply token, then the real answer by push, is the honest shape.
- **A crash must not lose the message.** Today a failed reply leaves the event id out of the seen
  set so LINE's retry re-delivers it. Once the `200` goes out first, that safety net is gone.

### Prior art, and the decision about it

There is already an outbox on the SmartGift repo's `feat/dashboard-v2-sidebar` branch:
`line-copilot-runtime/src/outbox.mjs` and `sqlite-outbox.mjs` (~420 lines with a full test suite),
built for SPEC-CR-012's governed group copilot.

**Decision (2026-08-11): adopt its state machine, not its code.** The semantics are exactly what
Step 1 needs and are proven by tests — content-hash idempotency keys, revision-based optimistic
claims (`PENDING → DISPATCHING → …`, `REVISION_CONFLICT` instead of double-send), admission checked
at dispatch time, quarantine as a first-class terminal state. But the record shape is Zuri's, not
this agent's: keys are `tenantRef/workflowId/nodeId` where this path has a conversation hash and a
LINE event id, and every row carries governance fields (`policySnapshotRef`, `piiScanRef`,
`configSnapshotRef`) that have no producer here. Adapting the schema costs about what writing the
small version costs, and importing it would couple this repo to a branch that has no PR. Write the
~150-line version here, mirror the state names exactly, and note the provenance — so when the
CR-012 runtime ships for real, the two speak the same vocabulary and merging them is renaming, not
reconciling.

## After that, in order

**Step 2 — turn on web search.** Already wired (`ZURI_HEADLESS_WEB_SEARCH`). One switch, no code.
Worth doing on its own so its effect on answer quality and on quota is visible before anything else
changes. An outward call from a chat message is also the first place a crafted message could send
traffic somewhere — worth watching the first week's searches rather than assuming.

**Step 3 — documents built from real data.** The ask was a quotation or a comparison sheet that
does not exist in the SoT but can be built from it. The pieces: `ZURI_HEADLESS_FILES` (wired), the
`out/` directory (exists), and two that do not exist yet —

- delivery: LINE will not accept a local path. A file needs a URL, which means somewhere to host it
  and a link that expires. This is the real work of Step 3, not the authoring.
- provenance: a generated quotation has to carry the same `as_of` and source line the chat answers
  carry, or the project's first rule stops holding the moment a number leaves in a file.

**Step 4 — a stable address.** The webhook still runs behind an ephemeral Cloudflare Quick Tunnel;
the URL changes whenever it restarts and has to be re-entered in the LINE console by hand. Either a
named tunnel or a hosted endpoint. Independent of Steps 1–3 and could be done at any time.

## What has to be decided, not built

- **The permission matrix in `AGENTS.md` has no row for this.** It says model and provider changes
  need approval; there is now a path that calls an external model and, on the headless layer, one
  that spawns a coding agent. The row should exist before this leaves candidate status, and it is
  the owner's wording, not mine.
- **Quota.** Roughly 18,000 tokens of Claude Code's own prompt ride on every headless message
  before the question is even read. On a subscription that is quota rather than money, but it sets
  a ceiling on how chatty the agent can be. Worth knowing what the ceiling is before opening it to
  the whole team.
- **Who gets the headless layer.** It could be owner-only at first, with the sales team on the
  cheaper API layer. Nothing in the code assumes one answer.

## What is deliberately not planned

- Writing to the SoT from chat. Every path here is read-only, and the moment chat can write, the
  audit trail that makes the numbers trustworthy stops being complete.
- Giving the sandboxed agent a shell. It is denied twice over today, and the value it would add is
  smaller than the boundary it would remove.
