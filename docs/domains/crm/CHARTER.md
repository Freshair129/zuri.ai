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
  - ConversationAnalysis
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
  (FR-093). It is deliberately a second, narrower writer rather than a
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
- `recordLineReply` — the outbound writer (FR-093). Resolves the inbound
  `Message` the reply answers and derives the conversation from that row, so the
  conversation is never taken from the request and a cross-tenant attachment is
  unsayable rather than merely refused. Idempotent per inbound message.
- `getConversationInbox` / `getConversationThread` — the read side (FR-091).
  Read-only by construction: the module exports no writer, so the reader cannot
  become a second write path into the models the ingest seam owns. It answers
  within the Tenant of a Business the viewer can see (BR-001) and never replies
  — the reply belongs to the edge runtime (BR-011). It also reads (never sets)
  the FR-103 consent fields below, so the console can show current status
  without a second request.
- `recordCustomerConsent` — SEC-005's PDPA consent attestation (FR-103). A third
  narrow writer alongside the ingest seam and `recordLineReply`: it only ever
  touches Customer's `consent*` fields, requires per-Business OWNER authority
  (never a Member grant), and resolves the Customer through the caller's owned
  Business's tenant — the same BR-001 scope `getConversationInbox` reads
  through — so a Customer id alone can never widen the write past it.
- `redactConversationContentForCustomers` — the PDPA erasure writer (FR-022). A
  fourth narrow writer, and the only one that is called by another domain: erasure
  belongs to identity ("the only flow allowed to do so", identity's charter), but
  `Message` is owned here, so identity asks through this export inside its own
  transaction rather than writing the table directly. That is the target state both
  charters already name for the `Person` redaction debt below — this surface starts
  on the right side of it instead of adding a second exception. It replaces `body`
  with a fixed tombstone and touches nothing else: ids, direction and timestamps
  survive, because a thread that silently lost its messages would read as data loss
  rather than as an honoured erasure. Tenant-scoped like every writer here, and
  idempotent — a message already tombstoned is neither counted nor rewritten. If a
  denormalised preview/snippet column is ever added to `Conversation`, it must be
  redacted in this same call.
- `recordConversationAnalysis` / `getConversationAnalyses` — the FR-127 derived
  CRM record boundary. A run is keyed by an internal `Conversation.id` and its
  generated analysis id; writes require ownership of the exact bound Business
  (or any owned Business in the same tenant for a tenant-shared conversation),
  while reads require the existing Business visibility scope and current
  Customer consent `GRANTED`. The model output is retained for recomputation but
  is absent from the projected read DTO and audit payload. This increment has no
  worker, provider, public route or UI.
- The FR-078 duplicate review queue stores only deterministic IDs, hashes,
  counts and boolean evidence flags. A Business-scoped Customer Data Reviewer
  may append a decision, but the queue never publishes a Customer or replays
  historical data through LINE.

## Known shared-write exceptions (debt, visible on purpose)

- `Person` is also written by identity's linking/erasure and FR-066 profile
  flows (`link-line-identity`, `erase-principal`, `onboarding-service`) —
  PDPA erasure must redact the
  global Person. Target state per the architecture spec is a contract call
  into crm; today it is a direct write, recorded here so the gap stays visible.

## Declared, not yet in schema (FEAT-014, ADR-054)

`CustomerProfile` and `DailyBrief` (FR-126/128) remain declared to land under
this charter — derived, recomputable intelligence over the models above, with
shapes borrowed from the legacy ERD as prior art and rebinding rules in
ADR-054. They are deliberately **not** in `owns_models` yet: that list mirrors
`prisma/schema.prisma`, and each implementation lane adds a model there in the
same change that adds it. Until then this paragraph is the claim, so no other
lane designs these tables elsewhere.
