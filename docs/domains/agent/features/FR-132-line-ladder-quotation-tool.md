---
domain: agent
feature: FR-132
module: agent
source: v2-native
version: "0.1.0b"
status: "declared"
---

# FR-132 — Ladder quotation on the LINE surface

## Intent

A customer types "ขอใบเสนอราคา" or "คำนวณราคา TDD03-2 จำนวน 100 ชิ้น" into a
LINE conversation that already exists, and the reply carries a tiered
quotation instead of a promise that somebody will get back to them.

CR-005 asks for that behaviour and proposes to reach it with a new endpoint
(`/api/connectors/line-oa/[businessId]`), a new model
(`AgentConnectorConfig`), and a LINE channel secret and access token stored as
columns. The behaviour is right. All three mechanisms are refused, and the
replacement for two of them is **nothing** — they already exist.

## What CR-005 got right

1. **Quoting inside the conversation is the correct surface.** LINE is the
   primary intake surface for this product; a customer who has to be moved to
   a web form to get a number has been moved for the system's convenience.
2. **The two invariants in §4 are the right two.** Rounding up to the nearest
   10 THB, and a margin floor enforced before anything leaves. Both are kept —
   see (c) below, which changes only who may *see* the second one.
3. **Intent recognition is the hard part and CR-005 names it as such.** It is
   also the part with no declared id, and the blocker below.

## The endpoint — refused, and the converter with it

`src/app/api/agent/line-webhook/route.js` already exists. BR-009 and SDD-009
say every intake surface converges on one envelope, and the review that
refused CR-005's endpoint said the auto-quote behaviour is "reachable through
the existing webhook plus a converter."

**The converter is also already there.**
`normalizeLineWebhookEvent` in
`src/platform/integrations/providers/line/line-oa-webhook.js` has converted
LINE events onto the FR-081 ingestion envelope since that requirement landed,
and the live route calls it through `createLineOaEvidenceRecorder` on every
event in the batch — including the ones the turn will skip. So the intake path
is complete end to end:

```text
zuri.command-agent          signature verification, Reply API  (BR-011)
  → POST /api/agent/line-webhook                                (FR-028)
  → normalizeLineWebhookEvent → createIngestionEnvelope         (FR-081)
  → handleAgentTurn → ingestLineMessage                         (FR-023)
  → reply text returned, never sent                             (FR-050)
```

Nothing in that chain is missing. What is missing is a **tool** the turn can
call, and the registry for it exists too.

## What FR-132 actually adds: one descriptor

`src/modules/agent/tools.js` holds the Gate E read-only registry.
`createToolRegistry().register` rejects any descriptor whose `readOnly` is not
`true`, which is exactly why a quotation fits: it computes and writes nothing.
Today the registry pre-loads three — `answer_from_knowledge`,
`read_customer_profile`, `search_conversations`. FR-132 is the fourth, plus the
pure calculator it calls.

Authorization comes with the registry rather than being added: every handler
calls `requireToolAuthorization`, which resolves `{tenantId, businessId,
principalId}` from the turn's AuthContext and runs `authorizeScope`. A quote is
therefore priced from the asking Business's rate card and from no other,
without the tool deciding anything about scope.

## `AgentConnectorConfig` — refused, and no `secretRef` replaces it

The review said the plaintext `channelSecret` / `channelToken` columns should
become a `secretRef` the way `IntegrationCredential` holds one. That is the
right instinct applied to the wrong repository. **The columns are deleted, not
converted**, and a `secretRef` here would be a vault entry nothing ever reads.

Under BR-011 this repository is not the LINE edge. `zuri.command-agent` owns
signature verification and Reply API transport; the webhook here receives an
already-verified, already-normalized batch. `connection-health.js` says so in
its own comment — a CHANNEL connection does not require a channel secret,
"under BR-011 the LINE channel secret belongs to zuri-cli". There is no
operation left in this process for a LINE channel secret to perform.

What the webhook does authenticate is a different thing entirely, and it is
already built: a binding-scoped bearer, HMAC-SHA256'd with
`ZURI_LINE_BINDING_HASH_PEPPER` and matched against `credential_hash` and
`external_channel_id_hash` on an `ACTIVE`, in-date row of
`zuri_core.line_channel_binding` (FR-052, FR-097). A hash, never material.

The rest of `AgentConnectorConfig` is `IntegrationConnection`:

| CR-005 field | What already holds it |
|---|---|
| `businessId` | `IntegrationConnection.businessId` (with `tenantId` beside it) |
| `connectorType` | `IntegrationProvider.code` — `LINE_OA` is `LINE_OA_PROVIDER_CODE` |
| `status` | `IntegrationConnection.status` |
| `webhookUrl` | `IntegrationConnection.metadataJson` |
| `channelSecret`, `channelToken` | nothing here — `line_channel_binding.credential_hash`, owned by the transport |

So the connector half of CR-005 declares **no model, no column and no
migration**, which is the same outcome FR-129 reached from CR-003 and for the
same reason: the thing being proposed was already built.

## (c) The two invariants, split by who may see them

**Rounding** — up to the nearest 10 THB — is part of the quoted number and
belongs in the reply.

**The margin floor** is not. It is a cost-side test applied before the number
is returned, and it must not travel with the payload: FR-047 excludes cost and
margin from what this surface may read, and a quotation that displayed its own
floor would breach that exclusion in the one place a customer is reading. The
floor decides whether a quote is returned at all; what comes back is a price.

## The reply is returned, not sent

FR-050 gives this repository at most one reply text per event and no
`replyToken`; BR-011 gives the Reply API to the transport. The interactive
Flex Message CR-005 §3.B.2 wants is therefore the transport's rendering of the
answer this repository returns — the same boundary FR-128 already keeps for
the Daily Sales Brief ("BR-011 stands and this feature adds no second LINE
writer").

## The MCP tool — a different surface, and it can be declared here

CR-005 §3.B.3 proposes `smartgift_calculate_ladder_quote` as an MCP tool "for
conversational agents in Zuri-AI". Two corrections, and the first is the
useful one:

**This repository is already an MCP server**, so such a tool is not somebody
else's contract to review. `src/app/api/mcp/route.js` and
`src/modules/project-manager/mcp/transport.js` serve nine tools today
(`project_manager.*`, `data_pipeline.*`), three of whose descriptions name
SmartGift. This is unlike `msp_vault_resolve`, which this repository *calls*
on MSP and therefore cannot declare.

**But it is not the surface the CR describes.** The MCP transport is
viewer-authenticated back-office access (`resolveRequestViewer`, JSON-RPC,
sessions); the registry a LINE turn binds is the in-process Gate E one in
`tools.js`. They share no code. "An agent quoting during a buyer discussion"
is the second, which is what FR-132 declares. An MCP tool is a separate,
reasonable want and needs its own id — and if it is taken, its name should be
`shipping.ladder_quote` and not `smartgift_*`: every existing tool is
`namespace.verb`, and putting one Business's name in a multi-tenant tool
contract makes the contract wrong for the second Business that uses it.

## What is still missing, stated plainly

- **FR-131.** There is nothing to price against until the rate card exists.
- **Intent recognition is undeclared.** `docs/domains/agent/intent-pipeline.md`
  is `Status: Draft — not implemented (TASK-V2-LINE-INTENT)`. Nothing today
  turns "ขอใบเสนอราคา" into a tool call, and whether that should be a
  model-selected tool or a deterministic matcher is an unmade decision, not an
  unwritten function. A model-selected tool inherits the model's failure modes
  on a surface that quotes prices; a matcher does not, and answers fewer
  phrasings. Nobody has chosen.
- **No calculator exists.** The ladder itself — density switch, tier
  qualification, rounding, floor — is pure and testable and is not written.

## One thing worth noticing about the LINE edge

`createLineOaWebhookConnector`, in the same file as the converter, is the only
LINE **webhook signature** verifier in this repository (`signaturesMatch`,
`readVerifiedBody`, `LINE_WEBHOOK_SIGNATURE_INVALID`) — the other three
`createHmac` callers hash bearers and auth tokens, they do not verify a payload
signature. No production route constructs it: it is referenced only from
`tests/unit/platform/line-oa-webhook.test.js` and
`tests/integration/platform/integration-persistence.test.js`.

That is correct under BR-011, and it is also the shape a future reader is most
likely to misread as an unfinished endpoint waiting to be wired up — the exact
misreading that would make CR-005's `/api/connectors/line-oa/[businessId]` look
like the obvious next step. It is not. It is the edge this repository decided
not to be.
