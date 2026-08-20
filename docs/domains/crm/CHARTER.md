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
- `reply-record-service` is the only place OUTBOUND messages become rows
  (FR-092). It is deliberately a second, narrower writer rather than a
  `direction: 'OUTBOUND'` call into the ingest seam: that seam creates a Person,
  Customer and Conversation when absent, and a receipt naming a conversation
  that does not exist is an error to report, never a reason to invent one.
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
- `recordLineReply` — the outbound writer (FR-092). Resolves the inbound
  `Message` the reply answers and derives the conversation from that row, so the
  conversation is never taken from the request and a cross-tenant attachment is
  unsayable rather than merely refused. Idempotent per inbound message.
- `getConversationInbox` / `getConversationThread` — the read side (FR-091).
  Read-only by construction: the module exports no writer, so the reader cannot
  become a second write path into the models the ingest seam owns. It answers
  within the Tenant of a Business the viewer can see (BR-001) and never replies
  — the reply belongs to the edge runtime (BR-011).
- The FR-078 duplicate review queue stores only deterministic IDs, hashes,
  counts and boolean evidence flags. A Business-scoped Customer Data Reviewer
  may append a decision, but the queue never publishes a Customer or replays
  historical data through LINE.

## Known shared-write exceptions (debt, visible on purpose)

- `Person` is also written by identity's linking/erasure flows
  (`link-line-identity`, `erase-principal`) — PDPA erasure must redact the
  global Person. Target state per the architecture spec is a contract call
  into crm; today it is a direct write, recorded here so the gap stays visible.
