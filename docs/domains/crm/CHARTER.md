---
domain: crm
module: src/modules/crm
owns_models:
  - Person
  - Customer
  - CustomerImportBatch
  - CustomerImportProvenance
  - CustomerImportReviewCase
  - CustomerImportReviewDecision
  - Conversation
  - Message
---

# Domain charter — crm

Who the business talks to, and what was said: the global Person, the
tenant-scoped Customer, and the Conversation/Message ingest that every LINE
turn flows through before any agent work happens.

## Boundaries

- The LINE ingest seam (`line-ingest-service`) is the only place inbound
  messages become rows — the agent domain consumes conversations, it does not
  create them.
- Tenant-scoped: the same LINE user in another tenant is a different Customer
  (FR-023); nothing here may collapse that.
- Does not decide identity or permissions — it asks identity to resolve who a
  lineUserId is (see identity's charter) and stores the result.

## Public contract

- `ingestLineMessage` — the ingest seam (FR-023): first contact creates
  Person + Customer + Conversation + Message atomically.
- FR-078 owns the historical Customer Profile backfill contract. It defines
  source identity, entity resolution, PII boundaries and rollback gates; it
  does not authorize a write until its approvals and target-schema gate pass.
- The FR-078 duplicate review queue stores only deterministic IDs, hashes,
  counts and boolean evidence flags. A Business-scoped Customer Data Reviewer
  may append a decision, but the queue never publishes a Customer or replays
  historical data through LINE.

## Known shared-write exceptions (debt, visible on purpose)

- `Person` is also written by identity's linking/erasure flows
  (`link-line-identity`, `erase-principal`) — PDPA erasure must redact the
  global Person. Target state per the architecture spec is a contract call
  into crm; today it is a direct write, recorded here so the gap stays visible.
