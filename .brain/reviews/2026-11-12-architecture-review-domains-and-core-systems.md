# Architecture review — domains and core systems (2026-11-12)

Scope: every domain charter against its module, schema, routes and tests, plus
three cross-cutting systems — data pipelines, the identifier system, and
login / session / authorization.

Method: seven read-only reviews by Codex (`gpt-6-luna`, max effort) at
`49b10eb3`, each required to cite `path:line` and to enumerate before claiming
absence. The lead (Claude) re-checked the findings marked ✔ against source.
Nothing was executed: no tests, builds, migrations or live systems. A finding
about production state is therefore a statement about the repository only.

Raw reviewer output is not in the repository; this file is the reconciled record.

The three documents the lead wrote were then given to Codex for an independent
factual review, one job each, with the instruction to try to prove them wrong.
All three first drafts were rejected:

| Document | Wrong | Imprecise | Confirmed |
|---|---|---|---|
| `docs/architecture/DATA-PIPELINE-ARCHITECTURE.md` | 12 | 4 | 261 of 270 inventory cells |
| `docs/architecture/IDENTIFIER-AND-CODE-SYSTEM.md` | 7 | 9 | 91 claim units |
| `docs/domains/identity/SYSTEM-DIAGRAM.md` | 15 | 13 | 68 claim units |

Every correction was checked against source by the lead and applied. About
half of the Identity diagram's errors predated this change (function names that
do not exist, viewer fields, the plugin token prefix, a LINE flow the code does
not follow). The corrected documents have not been reviewed a second time.

## 1. Verdict per domain

| Domain | Structure | Boundary discipline | Main gap |
|---|---|---|---|
| project-manager (+ `business`, `people`) | Layered (`application/`, `progress/`, `import/`) | Writes go through services with audit ✔ | Charter says satellites "write nothing"; `business` now writes capabilities and Office Design custody |
| identity | Flat, 60 files | Single owner of sessions, grants, credentials | Diagram was wrong on hash and session life ✔ (fixed); CSRF guard covers few routes ✔ |
| crm (+ `line-crm` UI) | Flat services | Clean ingest path; consent and retention separated | `line-crm` Members screen shows invented loyalty and "PDPA Granted" as live data ✔ |
| line-oa-studio | Layered | Admission before acknowledgement; fenced leases | Charter still calls shipped schema fields "not yet in schema" ✔ |
| agent | Flat, 67 files | Read tools vs gated write actions; MSP behind a port | Charter says Context Composer is not built; it is |
| knowledge | Flat + `application/` | Four-tier boundary holds: no direct GenesisBlockDB client | Stage 9 outbox stores source text; AGENTS.md §22 says "counts only" |
| inventory | Layered | Append-only ledger behind one writer with a fence | Cost shown is an all-time receipt average, not the ADR-074 moving average ✔ |
| procurement | Layered | Receipts post stock through the Inventory writer | Writes `ProductLot.expiresAt` directly — an Inventory-owned model |
| commerce | Layered | Payment verification separate from order writes | Charter is silent on whether fulfilment needs a verified payment |
| asset-management | Layered | Intake and registration are separate audited transactions | Charter still claims retired Edge extraction routes |
| marketing | Layered | Business-scoped; dispatch deliberately unavailable | None material |
| market-intelligence | Layered + extracted service | One owned model; raw evidence stays with Integration | Which executor is deployed is not recorded |
| integration | `adapters/` + `application/` | Secrets by reference; vault dispatch fails closed | Charter says credential entry is "not built"; it is. FlowAccount is declared only |
| platform-control | Flat + `application/` | Separate shell; operator check per request | Charter calls one write path "the only" one; there are three |
| file-management | Separate service (`services/file-management/`) | Six-operation FilePort v1 | No service document; protected calls unavailable until the authority provider exists |

No module root is unclaimed: `business` and `people` belong to project-manager,
`line-crm` to crm.

## 2. Findings that need code

Ordered by what they cost if left alone.

| # | Finding | Evidence | Kind |
|---|---|---|---|
| C1 | `line-crm` Members shows "Live DB" with defaulted points (100), lifecycle stage as a loyalty tier, and a hard-coded "ยินยอมแล้ว (Granted)" consent while new Customers default to `PENDING` ✔ | `apps/server/src/modules/line-crm/LineCrmMembers.jsx:54-75,107,280` | Data integrity — a consent claim nobody recorded |
| C2 | Chat-archive expiry has no trigger: the service says it is not wired to a route or worker ✔ | `apps/server/src/modules/crm/chat-evidence-archive-expiry-service.js:1-8` | Security / retention |
| C3 | No age-based sweep for raw LINE payloads or agent trace payloads; ADR-091 gives both 90 days ✔ | `ADR-091` D2; `apps/server/src/modules/crm/retention-sweep-service.js:9-15` | Retention |
| C4 | Unit cost is `Σ(qty×cost)/Σ(qty)` over all receipts ever; issues never reduce the basis. ADR-074 specifies a moving weighted average. `movingWeightedAverageSatang` exists and nothing calls it ✔ | `apps/server/src/modules/inventory/domain/inventory-costing.js:114-144`; `inventory-catalog-service.js:352-356` | Data integrity — wrong cost after stock turns over |
| C5 | CSRF/Origin guard is called from about ten places; 24 Identity session write routes rely on `SameSite=Lax` alone; sign-in and signup accept form posts with no Origin check ✔ | `apps/server/src/modules/identity/api-write-csrf.js`; `api/auth/login/route.js:15-25` | Security — coverage |
| C6 | Passkey sign-in has no rate limit and keeps challenges in one process's memory ✔ | `apps/server/src/modules/identity/webauthn-challenge.js:11-13` | Security / multi-instance |
| C7 | Live Chat buttons report an AI summary, a tag, points and a follow-up task; the handlers only set a notification string | `apps/server/src/modules/line-crm/LineCrmLiveChat.jsx:120-131` | UI claims work that did not happen |
| C8 | Procurement updates `ProductLot.expiresAt` directly and does not bump the lot version | `apps/server/src/modules/procurement/application/goods-receipt-service.js:157` | Boundary |
| C9 | Human codes are allocated check-then-insert with no retry ✔ | `apps/server/src/lib/ids.js:35-44`; `purchase-order-service.js:114-123` | Concurrency — a create can fail on a duplicate |
| C10 | `NotionWebhookReceipt.eventId` is the provider's id used as primary key ✔ | `apps/server/prisma/schema.prisma` (`model NotionWebhookReceipt`) | Contradicts BR-002 |
| C11 | Plans below `schemaVersion` 1.2 have no replay key ✔ | `import/plan-schema.js:363-365`; `plan-import-service.js:490` | Idempotency |
| C12 | Credential routes read the whole body before checking the 16 KiB limit or the viewer | `apps/server/src/modules/integration/application/credential-route.js:20-41` | Security — unverified upstream cap |
| C13 | Ten-year archive expiry deletes files but leaves manifest rows, which the next chain check then fails on | `chat-evidence-archive-expiry-service.js:193-203`; ADR-093 known limit | Data integrity |
| C14 | Landed-cost components and locked FX are not enforced at receipt; `costSatang` can be supplied by the caller | `goods-receipt-service.js:141-151`; `inventory/domain/inventory.js:251` | Provenance |
| C15 | Tenant/Business `AccessInvite` has a service and no HTTP route (ADR-079 says so) | `apps/server/src/modules/identity/access-invite-service.js:88,191` | Missing surface |

## 3. Documents that disagreed with the code

Fixed in this change (see §5): the Identity diagram's password hash, session
lifetime and Edge flow.

Corrected in the charters by the follow-up patch, where the fact was not in
doubt: agent (Context Composer status; two absent routes), asset-management
(Edge extraction), crm and line-oa-studio ("not yet in schema" sections),
integration ("not built" credential entry; Edge), platform-control ("only write
path"; Knowledge Studio; harness), procurement (landed-cost owner),
project-manager (satellite writes; calculator clock), identity (Edge and
harness sections).

Left alone because the answer is the owner's:

- `Person` is listed under crm's `owns_models`; `docs/ARCHITECTURE.md` gives it
  to Identity, and Identity's resolver creates it.
- ADR-102 and ADR-103 still read as candidate/design-only while FR-272 says
  implemented locally.
- AGENTS.md §22 "counts only, never payload" versus the Stage 9 retry outbox
  that stores source text.
- Whether a non-POS order may be completed and stock issued before payment is
  verified.

## 4. Core systems

**Data pipelines.** Twenty-eight flows inventoried. The intake family (plans
and deltas, catalogue, cost sheets, assets) follows validate → preview → one
transaction → audit. Seven implemented flows are missing from the map registry:
supplier cost sheets, the Notion receipt, snapshot restore, managed-blob
transfer, the CRM retention sweep, MSP memory retention and SmartGift document
staging. The SmartGift customer migration applies SQL directly; the
business-knowledge tool generates SQL for an operator. There is no shared
quarantine; a pipeline refuses, holds, blocks or leaves, and `DeadLetterRecord`
is a model nothing uses.

The pipeline page was independently reviewed by Codex after it was written.
That review rejected the first draft with 16 corrections (12 wrong, 4
imprecise) and confirmed 261 of 270 inventory cells; every correction was
checked against source and applied.

**Identifiers.** 221 models; 206 use a random UUID key. Fifteen do not — one is
a provider id (C10), eleven are deterministic or sentinel keys that no document
recorded. 53 models carry a code: 24 unique across the installation, 29 scoped.
Six different tables map external identifiers, each with its own scope;
`ExternalRef` is installation-wide.

**Login.** Password (salted scrypt), passkey and TOTP step-up; a signed token
checked against a live `Session` row on every request; seven-day ceiling with no
refresh, rotation or idle timeout; owner-assisted reset that revokes all
sessions. No middleware — each route resolves its own viewer. Isolation is
enforced in the application everywhere and by RLS on the cloud target only, as
far as the repository shows.

## 4a. Visual Office

Reviewed second, on both sides: the receiver in `apps/server` and the client in
`Freshair129/visual-office` at `1dff013d` (read-only).

The one integration that exists is a design handoff. Visual Office is a static
browser application with local storage only and no Zuri credential. A person
opens a Zuri popup (`/office-handoff`), both sides check origin, window and
nonce, and the popup submits the ZIP same-origin under the person's session with
CSRF, `If-Match` and `Idempotency-Key`. zuri.ai verifies the archive in a bounded
worker with a pinned verifier and commits design custody in one audited
transaction. It creates no agent, asset, membership or approval ✔.

| # | Finding | Kind |
|---|---|---|
| V1 | `AGENTS.md` called ADR-116 "candidate"; the ADR is accepted (2026-11-07) ✔ | Document — fixed |
| V2 | No document described the handoff end to end across both sides | Document — added as §12 of the client design |
| V3 | The verifier pin names revision `b4e2d8ed…` of the archived `zuri-visual-office`; in the current checkout it is reachable only from the `archive` remote ✔ | Provenance |
| V4 | 28 of 31 pinned producer files are unchanged at Visual Office `1dff013d`; three changed (`office-characters.js`, `tycoon-models.js`, `tycoon-state.js`). Nothing tests a current export against the pinned verifier ✔ | Test gap |
| V5 | Generic backup and restore refuse while any Office Design registry exists; no portable recovery ✔ | Code gap |
| V6 | A later design revision never retires an identity it omits; the rule is undecided | Owner decision |
| V7 | Visual Office's own `ZURI-PLATFORM-INTEGRATION-BOUNDARY.md` and `ARCHITECTURE.md` still present the registered separate client as the approved direction; its roadmap and release docs say same-origin first | Document — in the other repository, not changed here |
| V8 | The verifier runs in a worker thread: heap limits and a timeout, no bound on process memory | Security, low |

## 5. What this change added

| File | Change |
|---|---|
| `docs/architecture/IDENTIFIER-AND-CODE-SYSTEM.md` | New. Keys, codes and their scopes, mapping tables, URL identity, exceptions, gaps |
| `docs/architecture/DATA-PIPELINE-ARCHITECTURE.md` | New. Control properties of all 28 flows, failure behaviours, departures from BR-009, flows missing from the map |
| `docs/domains/identity/SYSTEM-DIAGRAM.md` | Corrected and extended: sections 5–9 for signup, passkey/step-up, reset, sign-out, invitation, session contract, write protection, rate limits, app vs database isolation |
| `docs/DOMAIN-MODEL.md`, `docs/DATA-PIPELINE-MAP.md` | One pointer each to the new pages |
| Domain charters | Status corrections listed in §3 |
| `docs/architecture/2026-10-22-visual-office-zuri-client-design.md` | New §12: the FR-294/FR-295 handoff as built, the verifier pin, what is not built |
| `AGENTS.md` | §19: ADR-116 stated as accepted, with a pointer to §12 |

Not added, on purpose: the six missing map-registry nodes (each needs
requirement ids the readiness snapshot knows), a `docs/services/file-management/`
pair (the service index says onboarding waits for real jobs and consumer
evidence), and any code.

## 6. Questions for the owner

1. Should `Person` move from crm's `owns_models` to Identity's?
2. Do the deterministic Knowledge / GenesisRAG17 keys stay as approved exceptions to the UUID rule?
3. When is a human code installation-wide, and when Tenant-scoped? `Customer` is Tenant data with an installation-wide code.
4. Must self-hosted PostgreSQL production carry the same forced-RLS contract as Supabase?
5. Is a fixed seven-day session with no idle timeout the intended policy?
6. May a non-POS order issue stock before its payment is verified?
7. Are the two SmartGift direct-SQL migrations an accepted exception to "every write goes through a service"?
8. Does "counts only, never payload" forbid the Stage 9 retry outbox from holding source text?
9. What should `line-crm` show for loyalty and consent until a real source exists?
