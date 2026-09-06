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

# Zuri Edge Device — optional compute worker

## Candidate central monorepo and execution contract

The owner requested complete migration documentation on 2026-09-06. In the central Freshair129/zuri.ai documentation branch, ZAI:ADR-062 proposes apps/edge in the monorepo with a separately installed/released runtime; ZAI:ADR-061 and ZAI:FR-148-P4 define the optional executor behavior. These qualified citations refer to the central repository, not this repository's local ADR/FR registry. They do not grant production activation or retire this runtime's existing reply-owner rule.

Target: Edge claims compatible jobs over outbound HTTPS, executes only allowed local capabilities, and returns bounded evidence/results under a current Business-scoped lease. Server owns migrated-account LINE credentials, send intents and provider calls. Edge receives no LINE reply token or Server database access; local-only jobs never silently use cloud inference. Device upgrade compatibility is checked against released protocol ranges, not assumed from a common checkout.

Migration first preserves current behavior while moving source; transport cutover follows separately per account. Existing Stack/local sending paths below remain legacy until the central cutover gate pauses/fences them. Do not remove current device configuration, copy .env/customer files into Git, delete the old repo/workspace, or reinstall device data merely because the source is moving. Root global documentation becomes authoritative after reviewed ID/path mapping; old local requirement IDs keep repository-qualified provenance.


Standalone local runtime for the Zuri Command Agent. It is a consumer of Zuri's governed command
API, not a replacement for the Zuri control plane.

## Server-owned LINE and optional Edge

The default runtime now pulls server conversation jobs with `npm start` (or
`node dist/cli/index.js conversation once` for a single claim). LINE + CRM + Cloud AI accounts
need no Edge installation. This worker uses a paired Business device credential and opens no
LINE webhook or public port. See [setup, privacy policy and cutover](docs/SERVER-LINE-OPTIONAL-EDGE.md).
Legacy transport requires explicit `ZURI_LINE_TRANSPORT_OWNER=LEGACY_EDGE`; activating two
transport owners at once is unsupported. Existing extraction remains an independent command.

## Ownership

- **Zuri owns:** tenant/RBAC, command state, policy snapshot, audit, LINE OA credentials, Flex
  validation, delivery outbox, and the canonical API contract.
- **Zuri Command Agent owns:** registered local bridge lifecycle, approved operator adapters,
  read-only DuckDB query execution, evidence shaping, and local diagnostics.
- **GoVibe governs:** mission/CR lifecycle, approval, policy/template/query promotion, budget,
  and evidence links. It is not the message hot path or durable command state store.

Read `AGENTS.md`, `docs/COMMAND-AGENT-SPEC.md`, and `docs/AGENT-RUNTIME-SPEC.md` before
implementation. The canonical integration contract is
`G:\zuri\docs\contracts\zuri-command-agent-api-v1.md`; this repository must not fork or alter
that contract unilaterally.

For the temporary, deliberately bounded local Flex demonstration, read
[`docs/POC-LINE-DELIVERY.md`](docs/POC-LINE-DELIVERY.md). It is not the production delivery
architecture and it reports LINE acceptance rather than a fabricated delivery receipt.

## Edge-executed evidence extraction

This device can pull asset-evidence extraction jobs from Zuri Cloud, read each document with
the model running locally, and post a candidate back — the device half of the cloud's FR-143
and FR-144. An operator pastes a credential, points at the cloud, and runs one command:

```bash
export ZURI_CLOUD_BASE_URL="https://<your-cloud-host>"
export ZURI_EDGE_DEVICE_KEY="edgk_..."          # minted once at /platform/integrations → Edge
node dist/cli/index.js extraction once          # claim at most one job — the smoke test
node dist/cli/index.js extraction serve         # the worker loop
```

**Be clear about what it reads today:** the local models this runtime ships against are
text-only, so with no vision model configured every job is *failed with an honest reason*
rather than answered with invented fields. PDFs are always failed — there is no rasteriser
here. Read [`docs/EDGE-EXTRACTION-RUNTIME.md`](docs/EDGE-EXTRACTION-RUNTIME.md) before
activating it: it covers the vision-model setting, why confidence is a fixed low number,
and what each failure mode looks like to an operator.

Version diff unversioned → 0.1.0b (2026-09-06, RWANG): documented central monorepo candidate and optional executor target; runtime behavior unchanged.
