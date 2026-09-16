---
version: "1.0.0"
created_at: "2026-09-15T23:00:00+07:00,Claude Opus 5"
last_update: "2026-09-16T09:00:00+07:00,Claude Opus 5"
status: "accepted"
superseded_by: null
attributes:
  domain: "crm"
  doc_type: "architecture-decision"
  scope: "what happens to a LINE message body the FR-230 retention sweep removes from the database: kept as encrypted, integrity-chained dispute evidence in a local cold archive, with its own retention, erasure and access rules"
---

# ADR-093 — Swept chat content moves to an encrypted local cold archive kept as dispute evidence

**Status:** Accepted on the owner's instruction of 2026-09-16 ("ใช้ค่าที่เสนอทั้งหมด ทั้ง ADR-093 และ ADR-094"): every proposed default below is the decision. Phase 0 only — requirements declared, nothing built.

**Pending outside the owner's decision:** counsel's confirmation of the 10-year term (D5) and of the legal-hold basis (D6). The owner accepted both defaults without it; if counsel changes either, this ADR is amended, not silently re-read.

**Amends:** ADR-091 D2 for the `MESSAGE_BODY_AND_ATTACHMENTS` class only, and SEC-031 (D6 option B).

**Relates to:** FR-022, FR-093, FR-224, FR-229, FR-230, SEC-031, ADR-057, ADR-061, ADR-089, ADR-091.

## Context

On 2026-09-15 the owner asked that content the retention sweep removes be moved to local cold storage instead of destroyed, and kept as evidence for disputes: "ให้ย้ายมาเก็บบน local cold storge แทน เก็บไว้เป็นหลักฐานกรณีต้องใช้ในข้อพิพาท". The example given: a customer says two years later that the business once promised a discount of X baht, and the business needs to prove what was actually said.

What exists today:

- **The sweep destroys, it does not move.** FR-230's sweep (`retention-sweep-service.js`, deployed in `release-087f3025`) overwrites `Message.body` with a tombstone after 730 days and marks attachments `ERASED`. No copy is kept. ADR-091 records the 730 days as product policy, not law.
- **Nothing is at risk yet.** Production on 2026-09-15: one Tenant, 235 messages, the oldest from 2026-09-08 UTC, none older than 730 days, no Tenant override. The first message becomes eligible around 2028-09-08. The sweep has never run: `ZURI_RETENTION_SWEEP_TOKEN` is unset and the scheduled task is not registered.
- **PDPA erasure is separate.** FR-022's `erasePrincipal` tombstones the person's message bodies, raw payloads, job fields and trace inputs in one transaction, whatever their age.

Three evidence gaps matter more to the owner's example than where swept content is stored, because an archive can only keep what the record already holds:

1. **Replies typed by staff in LINE Official Account Manager are not in the record.** `Message` rows with `direction: 'OUTBOUND'` are written only for replies the stack itself sent (`REPLY_SOURCES` is `STACK` and `TRANSPORT_FALLBACK`). LINE does not deliver messages an admin types in the Official Account Manager chat to the webhook, so a discount a staff member offered there never reaches zuri-ai. Production on 2026-09-15 holds 205 inbound and 31 outbound messages.
2. **Media bytes are not fetched.** ADR-091 D5 records media as `MessageAttachment` without bytes. The 18 `MEDIA_REF` rows on production are references only, and LINE expires the content. A quotation sent as an image is not evidence zuri-ai holds.
3. **A discount that became an order is already recorded elsewhere.** `SalesOrder.discountSatang` and `SalesOrderLine.discountSatang` belong to no retention class and are never swept.

Two further facts shape the design:

- **Database backups already hold message bodies beyond any window.** `scripts/readonly-supabase-logical-backup.mjs` snapshots and Supabase's own backups are outside the sweep. This ADR does not decide their retention.
- **The production host has two physical disks.** `C:` holds the OS, Docker and the repository, with 78.6 GB free of 954 GB. `F:` is a separate physical SSD with 268 GB free.

## Decision

### D1 — Only the CRM business record is archived

Only `MESSAGE_BODY_AND_ATTACHMENTS` moves to the archive, because ADR-091 D1 makes CRM `Message` the business and legal record of a conversation. `RAW_LINE_PAYLOAD`, `AGENT_TRACE_EVENT` and `MSP_SESSION_CONTENT` are copies, and they keep their delete-only 90-day windows.

### D2 — Archive before tombstone, and fail closed

For each Tenant, the sweep selects its candidates exactly as FR-230 does today, then:

1. writes the batch to a new archive file, flushes it to disk, reads it back and verifies its hash;
2. inserts an archive manifest row;
3. tombstones exactly the archived message ids in the same database transaction that marks the manifest committed.

If any step before the transaction fails, nothing is tombstoned for that Tenant. The run's audit event reports the failure with a count, and the content stays in the database until a later run archives it. An archive failure never destroys content.

### D3 — A local, write-once directory on a disk separate from the database host disk

Proposed location: `F:\zuri-cold-archive\<tenantId>\<yyyy>\`, bind-mounted into the `web` container at `/archive` through a new compose overlay, `docker-compose.cold-archive.yml`. The overlay must be named in `apps/server/.env`'s `COMPOSE_FILE`, the lesson of the 2026-09-11 LINE overlay outage. Each run writes a new file and never rewrites an existing one.

### D4 — Encrypted, per-Customer keys, and an integrity chain

- **Content.** One JSON line per message: message, conversation, Customer, Business and Tenant ids, direction, content kind, body, reply source, created time and attachment metadata. The lines are gzipped.
- **Encryption.** AES-256-GCM, the construction ADR-089's envelope store already uses. Each Customer's lines are sealed under that Customer's own data key, and the data keys are wrapped under a separate archive key, `ZURI_ARCHIVE_KEK`, never under `ZURI_SECRET_KEK`. Destroying one Customer's data key makes their archived lines unreadable in every file and every copy of every file.
- **Integrity.** The manifest row stores the file path, the SHA-256 of the file, the message count, a hash of the archived message id list and the previous manifest's hash, forming a chain per Tenant. The run's `RETENTION_SWEEP_COMPLETED` audit event carries the manifest hash.

In a dispute the evidence is the decrypted lines, a file hash matching its manifest row, an unbroken manifest chain and the audit event that recorded the manifest when the sweep ran.

### D5 — The archive has its own retention

An archived message is kept until it is N years old, counted from its original created time, then destroyed. A Customer's data key is destroyed when their last archived line expires, and a file is deleted when every line in it has expired. Proposed N: 10 years, the general limitation period of the Civil and Commercial Code, s.193/30. Counsel must confirm N before acceptance. The alternative is 5 years.

### D6 — Erasure

- **Option A.** A PDPA erasure also destroys the Customer's archive data key. It is simple, and SEC-031 holds as written.
- **Option B, recommended.** A PDPA erasure destroys the Customer's archive data key unless an OWNER has recorded a legal hold on that Customer: an open dispute, its reason and an end date. The hold relies on PDPA's exception for establishing, exercising or defending legal claims, which counsel must confirm. The erasure status shows the hold, and the key is destroyed when the hold ends. SEC-031 must be reworded to name the hold.

### D7 — No browsing: retrieval is per Customer, at AAL2, with a case reference

Nobody browses the archive. An OWNER at AAL2, through the FR-224 step-up gate, retrieves one Customer's archived messages for a date range and must give a case reference. The export carries the file and manifest hashes. Every retrieval writes an `ARCHIVE_RETRIEVED` audit event naming the Customer, the range and the case reference. No agent, model, GKS corpus, MSP memory or Context Composer ever reads the archive.

### D8 — A second copy

One local disk is a single point of failure for evidence. Proposed: once a month, new archive files are copied to an external drive the owner keeps offline, and the copy is verified against the manifest hashes. The archive key needs its own offline backup, because losing `ZURI_ARCHIVE_KEK` makes the whole archive unreadable.

## Owner decisions (2026-09-16)

The owner accepted every proposed default.

| Decision | Chosen | Not chosen |
|---|---|---|
| D3 where the archive lives | `F:\zuri-cold-archive` on the second physical SSD | another local disk or a NAS |
| D5 how long the archive keeps a message | 10 years from the message date, confirmed by counsel | 5 years |
| D6 what a PDPA erasure does to the archive | option B, legal hold only when a dispute is recorded | option A, always destroy |
| D7 who may retrieve | OWNER at AAL2 with a case reference | installation operator on the owner's written instruction |
| D8 second copy | monthly copy to an offline external drive | none, or cloud storage with object lock |
| Evidence gaps first | record staff replies before building the archive (FR-246) | archive first |

## Consequences

- **Content leaves the database but not the company.** The archive becomes a new PII surface. SEC-031's rule that every copy has a retention window and an erasure path holds through D5 and D6.
- **The inbox is unchanged.** The database window stays 730 days, and the sweep's tombstone and preview behaviour stay as FR-230 states.
- **New moving parts.** One crm model for the manifest, and a legal-hold record if D6 option B is chosen. One secret, one compose overlay, one retrieval route and a monthly copy routine.
- **The archive proves only what was recorded.** Until staff replies and media bytes reach the record, the archive cannot answer the owner's example when the promise was made in LINE Official Account Manager or in an image.

## Requirements

Declared on acceptance: **FR-245** archive before tombstone, retention, retrieval and the offline copy; **FR-246** staff replies recorded, the evidence gap the owner chose to close first; **SEC-034** archive encryption, integrity chain, access and key destruction with the legal hold; **SDD-103** file format, write-verify order and overlay. **SEC-031** is re-worded to name the archive and the legal hold. **FEAT-041** bundles FR-245 and FR-246.

## Delivery phases

| Phase | Scope | Gate |
|---|---|---|
| 0 | Owner answers the open decisions, the ADR is accepted and the requirements are declared (done 2026-09-16); counsel confirms D5 and D6 | owner |
| 0b | Staff replies from the inbox recorded as `OUTBOUND` with source `STAFF` (FR-246), before any archive code | a staff reply appears in the record and its session |
| 1 | Manifest model and migration, archive writer with per-Customer keys, sweep integration failing closed | tests prove no tombstone without a verified archive |
| 2 | OWNER retrieval at AAL2 with case reference and hashed export | audit event per retrieval |
| 3 | Erasure destroys archive keys, and the legal hold if D6 option B is chosen | SEC-031 reworded if B |
| 4 | Overlay, `ZURI_ARCHIVE_KEK` and its offline backup, migration applied under ADR-057, token and scheduled task, first run | first manifest recorded |
| 5 | Monthly offline copy with hash verification | first verified copy |

No message is eligible before 2028-09-08, so these phases can follow the evidence-gap work without losing anything.

## Alternatives considered

- **Lengthen the database window instead.** The owner may raise the installation default, for example to 10 years, which ADR-091 D2 already allows. It is the simplest change. It keeps the content readable to everyone with inbox access and inside every database backup, and it gives no integrity chain. It stays viable if the owner prefers simplicity over access control.
- **Cloud object storage with object lock.** It would be more durable and truly write-once. It is not chosen because the owner asked for local storage. It remains the D8 alternative.
- **Plaintext archive files.** Rejected, because they would put customer conversations unencrypted on a desktop disk.
- **Archive the raw LINE payload too.** Rejected, because it is a copy of the record. D1 keeps it delete-only.

## CHANGELOG

| Version | Date | Status | Change |
|---|---|---|---|
| 1.0.0 | 2026-09-16 | accepted | Owner accepted every proposed default; FR-245, FR-246, SEC-034, SDD-103 and FEAT-041 declared, SEC-031 re-worded; counsel confirmation of D5 and D6 recorded as pending |
| 0.1.0 | 2026-09-15 | proposed | First draft at the owner's request, with production facts, the three evidence gaps, eight proposed decisions and the open decisions table |
