---
id: ZAI:PM-PHASE-B-RECOVERY-ERASURE-DECISION
title: Phase B recovery and reviewed text erasure decision
version: "0.3.25b"
status: beta
created_at: "2026-09-17T04:15:00+07:00,RWANG,bd99651f"
last_update: "2026-10-24,Codex Root, composed Pipeline C1 and FR-235 recovery binding"
attributes:
  domain: project-manager
  doc_type: architecture-decision
  complexity: C-3
  risk: HIGH
relations:
  - type: references
    target: ZAI:ADR-097
  - type: references
    target: ZAI:FR-252-P1
  - type: references
    target: ZAI:FR-075
  - type: references
    target: ZAI:FR-022
  - type: references
    target: ZAI:PM-PHASE-B-W1-RLS-POLICY
---

# Phase B: approved protected recovery and text erasure

**Owner approved both decisions on 2026-09-17.** The approved v0.2.1b packet
has SHA-256 `DD666532E88B6D3C59A1D999ADB9621FC0669A4CF071209407DD6E0513407865`;
independent Luna Max review passed before owner selection. Version 0.3.0b
records approval without changing either selected behavior. W2 local
implementation and isolated verification may proceed. The original packet
requires complete protected recovery and audited erasure, but does not define
a maintenance execution capability or how shared Feature text relates to a
data subject. W1 schema and P2 Identity work remain independently authorized.
This decision changes neither the six-record identity nor the 14 Feature/CSRF
operations. Production credentials and live recovery remain outside this approval.

## Evidence

The current `backup-service.js` restores by deleting and reinserting every
snapshot family through the application client. The accepted database policy
allows only SELECT/INSERT on GovernanceSnapshot and mutation receipts. The
operator viewer check grants no additional database privilege. Generic export
also has no Phase B scope binding, so RLS-hidden rows could look like empty
families. An empty response is not evidence that no protected rows exist.

Feature title/problem/outcome and contribution responsibility have no subject
mapping. A receipt actor or last editor may write information about someone
else. Adding author columns would not identify the person whose data must be
erased. Existing Identity orchestration remains the owner of erasure.

## Approved decision A: separate recovery from normal runtime

1. Keep ordinary runtime append-only privileges exactly as policy25 specifies.
   Do not add DELETE, maintenance credentials or role switching to web/worker.
2. Extend protected-family export/preview validation for all six Phase B
   records. Require evidence that export saw the complete family. An unbound
   RLS query cannot supply a zero-row proof; return an explicit unavailable
   result before publishing a snapshot if completeness cannot be established.
3. Confirmed web restore refuses before any delete when existing or incoming
   Phase B evidence needs protected recovery. The existing restore-result
   envelope carries `restored: false`, `valid: false` and
   `errorCode: PHASE_B_RECOVERY_MAINTENANCE_REQUIRED`; protected and unrelated
   rows stay unchanged and no successful restore audit is written.
4. Implement a separately invoked, operator-controlled offline recovery command
   for a **verified empty target database**. It validates the exact input digest,
   complete families and parent chains, inserts in dependency order in one
   transaction, and verifies IDs/versions/hashes/counts. It performs no DELETE,
   TRUNCATE or in-place replacement. A nonempty or unverifiable target refuses.
5. Maintenance database access is supplied to that invocation only, through an
   operator-controlled secret input; it is never accepted over HTTP, stored in
   a snapshot or made available to ordinary runtime. The command identifies its
   maintenance context separately from non-bypass runtime isolation evidence.
   Code and isolated tests do not authorize running it on a live database.
6. Existing archive/rollup recovery semantics are preserved. The Phase B guard
   applies to this new family; it does not impose new authority on unrelated
   already-approved recovery. Reconcile the concurrent CustomerLegalHold release
   before composing any deployable backup change.

This selects clean-target recovery for Phase B instead of extending the web
importer's in-place replacement power. An in-place protected recovery would
need a separate reviewed maintenance capability and is not included.

## Approved decision B: reviewed field targets for PM text erasure

1. Do not infer a subject from authorship, receipt actors, names or text search.
   Add no author columns or seventh Phase B model.
2. Identity receives a server-reviewed manifest within the existing erasure
   authority. Each entry names the Project, record type/id, field and expected
   version. The allowlist is ProjectFeature.title/problem/outcome and
   FeatureContribution.responsibility. Review explicitly confirms that clearing
   the named whole field is appropriate, including effects on shared text.
3. The trusted manifest also binds tenant, Business, subject Person, reviewer,
   reason reference and request identity. Existing Identity erasure authority
   must cover every target. An HTTP client cannot grant itself review status or
   select a privileged database client by submitting those fields.
4. A PM-owned transaction port applies only those reviewed targets, using the
   server's fixed `[erased]` value. It rechecks full hierarchy and exact version,
   locks affected Projects in deterministic ID order, increments each changed
   row's version, and preserves identity, lifecycle and deletion cohorts.
   Mutable scope rebinding in a multi-Project Identity transaction must have a
   separately tested adapter boundary; one request's proof is never reused.
5. Missing subject-to-field mapping is `UNMAPPED`, pending review is `PENDING`,
   and stale/foreign targets refuse atomically. These outcomes never claim
   complete PM erasure. Unrelated fields and immutable snapshots/receipts/audit
   evidence remain unchanged.
6. Reuse the existing immutable erasure AuditEvent for the manifest digest,
   reviewed target identities/fields, reviewer and resulting counts. Do not
   persist original text, replacement content or secret material in that audit.
   A repeated request is compared to its reviewed manifest before any effect;
   a changed manifest cannot masquerade as a successful replay.
7. Identity remains transaction orchestrator. A failed PM application rolls back
   the composed change and creates no success audit. Preserve current CRM legal
   hold and external pending-erasure semantics independently.

The reviewed manifest is an internal authority boundary. Existing public erase
requests cannot become arbitrary Feature-edit endpoints. A dedicated review UI
or general retention-policy editor is outside this change.

## Concrete recovery contract

### Offline command and visibility proof

The command is `node apps/server/scripts/phase-b-clean-target-restore.mjs`.
It accepts `--snapshot <absolute-path>`, `--snapshot-sha256 <lowercase-hex-64>`,
`--confirm-empty-target PHASE_B_EMPTY_TARGET`, and optional `--report <absolute-path>`.
Without the confirmation it performs preflight only. The connection comes only
from `ZURI_PHASE_B_RECOVERY_DATABASE_URL` in the operator's process environment.
There is no fallback to the application's DATABASE_URL, HTTP entry point, role
creation, SET ROLE, credential logging or credential persistence.

Run these offline commands from the selected operator checkout with its complete
Server dependencies installed from the lockfile, including development tools.
The CLI bridge uses the explicitly pinned esbuild development dependency to
compose the existing backup service and its validation/redaction rules. It
injects the recovery transaction and replaces the ambient application database
import; it cannot silently connect through the application's database client.
The ordinary web/runtime does not import this operator script. A production
image installed with development dependencies omitted is not the recovery
toolkit. Help remains usable without a recovery connection; an unavailable
composition or validation boundary refuses recovery.

The SHA-256 is over the exact file bytes before JSON parsing, not reserialized
JSON. A mismatch refuses before any database write. The importer retains the
bytes read for the whole run and never rereads a changed file after validation.

The target must have the already-migrated selected schema. The reviewed table
inventory includes **all application models**, including snapshot exclusions;
every family must be empty. The PostgreSQL catalog is reconciled with that
inventory, including mapped table names. Missing or unexpected application
tables refuse; only the schema's explicitly enumerated migration bookkeeping
tables are outside the emptiness claim. This inventory is frozen with W1's
schema hash before implementation. Peer CustomerLegalHold reconciliation updates
the inventory before any deployable recovery artifact is accepted.

`targetSchemaSha256` is lower-case SHA-256 of UTF-8 JSON with exactly these
top-level keys in order: `schemaSha256`, `applicationTables`. `schemaSha256`
binds the exact bytes of the frozen canonical Prisma schema. The historical W1
binding is `e5d6fb4d1f915d5ea78b10a0c6a14ff22f39f995d4e4d7d99790c7eb1056b2db`.
`applicationTables` contains every application model, sorted by modelName,
schemaName and tableName using ordinal comparison. Each object has those three
keys in that order, with no whitespace in the serialized JSON. The current
W1 isolated schema had 174 models; this is not a production inventory claim.
Inventory/schema changes require a new reviewed binding. A catalog or binding
mismatch is `TARGET_SCHEMA_UNVERIFIED` before insertion.

The historical W2 CRM composition at 052821a7 had 175 application models:
`schemaSha256` `9bc8c777e00f7716b94b99a6a771e1453b9d667d887bcb2ed0118779ca0ec2be`,
`targetSchemaSha256` `617b091c8b94ff306f9b98989676f631360b23f4a7faac0f1e57d16743999f5b`.
Its independent review and actual CLI proof remain evidence for that version.

The current composed schema adds `KnowledgeArtifactOperation` and
`KnowledgeArtifactStorage` to the previously pinned 177-model binding, giving
**179 application models** in [the frozen inventory](contracts/phase-b/target-schema.inventory.json).
The canonical LF schema has `schemaSha256`
`ad87b4bc9244f1fdbd055d138bd02c9bd315498d57c51c22efdf56084cdd089f`;
`targetSchemaSha256` is
`ee7a379237b5e8cbebd7607deb1d28cc400009e54076c60c87fb2dddb3873198`.
Independent Luna Max review recomputed both hashes, model mappings, ordinal
serialization and SQLite/PostgreSQL parity and passed on 2026-09-17.
The loader and all executable adapters enforce this exact binding.

The current composed schema then binds the FR-268 Business Key Result models at
186 application tables. The PM approval gateway adds `ProjectApprovalRequest`,
giving **187 application tables** in the frozen inventory. The canonical LF
schema has `schemaSha256`
`a265b10cc6366b3d586e9d6a3350fb0dce88add831008aa3f378128429102f33` and the
inventory binding has `targetSchemaSha256`
`fd36fe16bc94f66605164b131124d1b7a59916e4caff2fc6f964f5a628825c92`.
The 186-model, 179-model and earlier bindings remain historical and refuse
cross-schema recovery.
Historical 175-bound snapshots refuse; no automatic cross-schema artifact
rewrite is authorized by this decision. The composed actual CLI proof remains
a separate gate from static inventory review.

The stateless LINE OA worker checkpoint is an operational application model even
though it is excluded from snapshot contents. Its additive schema change therefore
rebinds the frozen inventory to **188 application tables**. The canonical LF
schema has `schemaSha256`
`9ca8618d758d29387a0eaf79877a370c2ee8f24aadf09a07b4c103e0fe7f974a` and the
inventory binding has `targetSchemaSha256`
`a669f032250b6d72fff5f99398a3fb9166fd5ee383bdd6d5c66c5a6df5831115`.
The 187-table binding remains historical and refuses cross-schema recovery.

The Notion integration adds `NotionOAuthState`,
`NotionWebhookVerificationToken` and `NotionWebhookReceipt`, rebinding the
frozen inventory to **191 application tables**. That binding's canonical LF
schema hash is `ca3e8247e50eb95980561e3ce8aa882ed7b11010d0b2167582e5f37b448132c8`;
the target inventory hash is
`c45dd4b70079decbd1d415a392221bf1a4a71970cd807140d832549ff5481d55`.
OAuth state and encrypted verification-token rows remain excluded from backup
contents; minimal webhook receipts are included. The former 188-table binding
remains historical and refuses cross-schema recovery. No production migration
or recovery operation is claimed.

Conversation Runtime (ADR-106 / SDD-110) adds `runtimeOwner` to the existing
`LineOaAccount` and `LineConversationJob` models. It adds no application model,
so the 191-entry table mapping is unchanged, but the schema bytes change. The
binding for the merged Notion + Conversation Runtime schema was
`schemaSha256`
`f17edcf1917e80825f6b1ec8e0e958fc9dae74b570195d5b3e0c6069eb7dd078` with
`targetSchemaSha256`
`a3b354485036ccb70f84980f0af2676ddeee554fff0089b33eb0afe29f43d4d1`, recomputed
with `computeTargetSchemaSha256` over the unchanged 191-table mapping. The
Notion-only binding above and the interim runtimeOwner-only 188-table binding
(`ffa2c121e08891b4de556480130d5a6e116979f151133a58fd0f23a98ba61f2d` /
`51b45ae26066775435adef2b983616835d6c09a940ec884f9de0e4cacf8d2899`) are both
historical and refused against this schema. Both models remain in snapshot
coverage: restore preserves `runtimeOwner`, disables a restored LINE account and
increments its transport epoch, and clears reply-token/claim-lease capabilities
while quarantining queued or uncertain jobs. This rebind changes neither the
table-empty proof nor the recovery/erasure algorithm; it accepts only this exact
schema and does not authorize automatic rewriting or recovery of artifacts bound
to older hashes.

PDPA erasure of one speaker in a shared LINE group or room thread (FR-022) adds
the nullable `authorChannelIdentityId` column (and its index) to the existing
`Message` model. It adds no application model, so the 191-entry table mapping is
unchanged; only the schema bytes change. This binding has `schemaSha256`
`26a67720bdc418d9e1de1b06849ccc685b111d0810d3d04dc03952bcb6d268f8` with
`targetSchemaSha256`
`53119b5c3d73c1acdaebdf16cc7c1d8b34d97bfb8877b36df2fc9cbfe0db751d`, recomputed
with `computeTargetSchemaSha256` over the unchanged mapping. The merged Notion +
Conversation Runtime binding above is historical and refused against this schema.
`Message` stays in snapshot coverage and a restore carries the column as data;
this rebind changes neither the table-empty proof nor the recovery/erasure
algorithm, and it does not authorize recovery of artifacts bound to older hashes.

FR-277 (ADR-090 Phase 3, TASK-ZAI-095) adds one application model,
`LineGroundingShadowComparison` — the diagnostic-only LINE grounding
shadow-compare row — on top of the Message rebind above, bringing the frozen
inventory to **192 application tables**. That binding had
`schemaSha256`
`94b6e5a55ff719afb82d9c8896ca47db6192cf48709d6976fd4cb38870d5231d` and
`targetSchemaSha256`
`372a2af5602a7af64aef2ea77904f039c7666f4e44007c27b0caf4a74fa50885`, computed
the same way as every binding above: `schemaSha256` over the raw
`prisma/schema.prisma` bytes (now carrying both the Message
`authorChannelIdentityId` column and the new model), `targetSchemaSha256` via
`computeTargetSchemaSha256` over the full, alphabetically sorted 192-model
mapping (every model gets `schemaName: 'public'`, `tableName` equal to its
`modelName`; none of this schema's models use `@@map`). Every binding above —
the Notion + Conversation Runtime merge, the interim runtimeOwner-only binding,
and the 191-table Message rebind — is historical and refuses cross-schema
recovery against this schema. The new model is included in `SNAPSHOT_MODELS`
(backup-service.js) with no declared relation, matching `AgentTraceEvent`'s own
convention in the same domain — it restores without ordering constraints.
This binding has now had the same independent hash/mapping check as the
rebinds above: `schemaSha256` was recomputed directly from the bytes of the
committed `apps/server/prisma/schema.prisma` (matches exactly) and
`targetSchemaSha256` was recomputed by calling the repo's own
`computeTargetSchemaSha256` against the committed inventory's 192-entry
`applicationTables` (matches exactly); both values above are therefore
independently confirmed, not merely asserted by the commit that introduced
them. This is a mechanical hash/count recheck, the same kind every prior
rebind above records — it does not re-review whether every model's family,
snapshot inclusion or RLS visibility assignment is itself correct beyond
noting that `LineGroundingShadowComparison` follows an existing precedent
(`AgentTraceEvent`'s no-declared-relation convention); a deeper design review
of the mapping, if wanted, is still a separate, undone step. The CLI proof
this paragraph's predecessor also deferred remains separately undone.

FR-022 "consent to retain = keep" (owner ruling 2026-09-27, ADR-093 1.2.0) adds
two application models on top of the FR-277 binding: `CustomerRetentionConsent`
(the retention consent a sales user collects in advance from a Customer — a
history with real foreign keys to Tenant, Customer and the recording Person) and
`LegalHoldArchiveKey` (the wrapped per-legal-hold data key re-sealed chat
evidence lives under — no `@relation`, same shape as `CustomerArchiveKey`),
bringing the frozen inventory to **194 application tables**. That binding had
`schemaSha256`
`1f7fa96247a7af651cca6ca1cb157ae0d9b07f37e36262084967a20d36cc1206` and
`targetSchemaSha256`
`3b0841c3771ae0fafb4147c9622e86b6d1827cbb656d070113f22bd7e94b8c79`, computed
the same way: `schemaSha256` over the raw `prisma/schema.prisma` bytes,
`targetSchemaSha256` via `computeTargetSchemaSha256` over the full,
alphabetically sorted 194-model mapping (`schemaName: 'public'`, `tableName`
equal to `modelName`, no `@@map`). The 192-table FR-277 binding and every
binding before it are historical and refuse cross-schema recovery against this
schema. Both new models are in `SNAPSHOT_MODELS` (backup-service.js):
`customerRetentionConsent` right after `customerLegalHold` (a Customer child row,
same reasoning), `legalHoldArchiveKey` right after `customerArchiveKey` (wrapped
ciphertext whose KEK is never in a snapshot, and a random data key with no
re-entry path). This rebind changes neither the table-empty proof nor the
recovery/erasure algorithm, and it does not authorize recovery of artifacts
bound to older hashes. The migrations are written, not applied to any database.

FR-022 MSP memory erasure (owner decision 2026-09-28, option A) adds the index
`AgentTraceEvent (kind, occurredAt, id)` for the erasure scanner's keyset page.
No model is added or renamed, so the 194-table mapping is unchanged; only the
schema bytes move. The historical 0.3.14b binding has `schemaSha256`
`32eb25fc477a50457014e2e8b106fd58a4d5eed0666b46a3e98e7bcba66330d4` and `targetSchemaSha256`
`9dfbf9b736a46b2191cc8c72b843b090563af0198359b7015b5654dd08506aa0`, computed the same way. The previous
194-table binding (`schemaSha256` `1f7fa96247a7af651cca6ca1cb157ae0d9b07f37e36262084967a20d36cc1206`) is historical and refuses
cross-schema recovery against this schema. This rebind changes neither the
table-empty proof nor the recovery/erasure algorithm. The index migration is
written, not applied to any database.

API-010 branch history (0.3.15b):
The schema also contains `MemoryProjectionReceipt`, the durable record for
acknowledged API-011 projections. The frozen application mapping therefore has
195 tables. Its historical branch binding has `schemaSha256`
`73bbbff14159ed2549b9555d8bcb8fb851fec6fcb4a4ceeebd35196cbd33fbf1` and
`targetSchemaSha256`
`9b68b9b1faeb7960576a0f0a85ad8c82d7e0a941d8ab9499d80e97f7860a73a9`. The
schema digest is computed over raw `prisma/schema.prisma` bytes; the target
digest is computed with `computeTargetSchemaSha256` over the full,
alphabetically sorted model-to-public-table mapping. The previous 194-table
binding and prior schema digests are historical and refuse recovery against
this schema. This rebind changes neither the table-empty proof nor the
recovery/erasure algorithm. The index migration is written, not applied to any
database.

The **historical main 0.3.15b binding** follows the owner's 2026-10-06 approval of
[the bounded Marketing rebind](../../change-requests/marketing/ZURI-GO-REPORT-PHASE-B-REBIND.md).
It adds only `MarketingReportPolicy`, `MarketingReportBinding` and
`MarketingExternalReport` to the exact prior 194 public mappings, giving 197.
`schemaSha256` is `45d7a7001daa7ede78fe911d1752bf237a7c42218a51372ec4bb89bdd704de06`
over the raw LF Prisma bytes required by `.gitattributes`;
`targetSchemaSha256` is `e9f5216b1e9368157dcfd5b926eb3798fac335f45d815615424324fe2909f65e`
via the unchanged `computeTargetSchemaSha256`. All previous bindings remain
historical and refuse cross-schema recovery, including 0.3.14b above.

The **historical 0.3.16b binding** composes the API-010 branch and main after the owner's 2026-10-10 approval to reconcile conflicts. It preserves every prior mapping and includes all 198 application tables. Raw LF Prisma bytes give `schemaSha256` `19bebd6e40dbaf43bfae5a99d54d29ebf33576add850b45525033f516d09405a`; `computeTargetSchemaSha256` gives `targetSchemaSha256` `40815083980a80c6d3c3237b1f9db5bf9c1c6c93682beb360a060a93996e50bb`. Both divergent 0.3.15b bindings above are historical and refuse cross-schema recovery. Memory and Marketing recovery guards remain in force.

The **historical 0.3.17b binding** extends 0.3.16b with exactly `BusinessKpi` and `BusinessKpiObservation` for FR-269, preserving the prior 198 mappings for 200 total application tables. Its schema digest is `64baeee00e5b9ab48f3ba35a37cc3be50321c27ab7b3b41b9496710717b809ca` and its target digest is `27aeaa988c2b203c20d0e9403ddca03c91cc6618de41e36dc2a1a913d89e2302`.

The **historical 0.3.18b binding** extends 0.3.17b with exactly the four FR-270 tables `BusinessLeadMeasure`, `BusinessLeadMeasureValue`, `BusinessWeeklyCommitment` and `BusinessWigSession`, preserving all prior mappings for 204 total application tables. Exact raw `prisma/schema.prisma` bytes give `schemaSha256` `1bf50bdc16737c19116801eee4dd83cc8c0326e6c7b79d440b62caff29744175`; the unchanged `computeTargetSchemaSha256` gives `targetSchemaSha256` `75f208f0ed5b13353193ff74e1ff2e86222430c08d03e11148e332fc3f93edae`. The 200-table binding remains historical and refuses cross-schema recovery. Tests verify the inventory contains every declared Prisma model, preserves the prior 194 mappings, and rejects historical candidates at the loader and adapter boundaries. This static binding does not authorize or prove a live migration, backup, recovery, activation, deployment or production readiness; real-role and executable recovery gates remain separate.

These three retained-custody models remain explicitly excluded from legacy JSON
snapshots, recovery-family delegates and insertion/deletion order. They join the
complete catalog, privilege, census and restore-lock checks. Protected export
refuses any nonzero Marketing count before extraction; incomplete/unreadable
census refuses. Clean-target restore still requires every application table to be
provably empty. Both runners independently reject unsupported Marketing fields,
even empty arrays and even when a supplied shared validator accepts them. Existing
backup-service guards continue to enforce the same rule for web preview/import,
transactional replacement and extraction. Never disable immutable triggers.
Separately authorized consistent whole-SQLite backup remains the accepted route
for nonempty custody; JSON support needs a separate reviewed format/order contract.
This rebind grants no live migration, backup/restore, credential, send, deployment
or merge authority.

That executable gate now passes on the composed 179-model source: 22 positive
and 15 adversarial checks, with thirteen executable/schema inputs frozen during
the run. Its populated six PM and two Pricing families restore into fresh
synthetic targets. The [integration report](../../../.brain/reports/2026-09-17-project-feature-phase-b.md)
retains the exact proof; this does not establish production role or migration
readiness.

Version diff 0.3.17b → 0.3.18b: add the four FR-270 Business WIG tables to the exact public-table mapping; pin the current schema and target hashes; preserve all prior mappings and Memory/Marketing custody guards; every historical binding remains refused.

Version diff 0.3.16b → 0.3.17b: add `BusinessKpi` and `BusinessKpiObservation` to the exact public-table mapping; pin the current schema and target hashes; preserve all prior mappings and Memory/Marketing custody guards; every historical binding remains refused.

Version diff 0.3.15b → 0.3.16b: compose the approved branch reconciliation with all 198 unchanged model-to-table mappings. Pin the exact composed schema and preserve both Memory and Marketing custody guards; every historical binding remains refused.

Main branch history — Version diff 0.3.14b → 0.3.15b: preserve the original 194 mappings, pin the exact
197-model Marketing receiver schema, and enforce retained-custody refusal at the
generic offline runner boundary. JSON format and historical bindings are unchanged.

API-010 branch history — Version diff 0.3.14b → 0.3.15b: bind the frozen recovery inventory to the
current schema bytes and the full 195-table mapping, including
`MemoryProjectionReceipt`; the prior 194-table and schema-digest bindings stay
historical and are refused.

Version diff 0.3.13b → 0.3.14b: rebind the frozen recovery inventory to the schema
with the `AgentTraceEvent (kind, occurredAt, id)` index (FR-022 MSP memory
erasure scan). The 194-table mapping is unchanged; the 0.3.13b binding stays
historical and is refused.

Version diff 0.3.12b → 0.3.13b: rebind the frozen recovery inventory to the
194-table schema with `CustomerRetentionConsent` and `LegalHoldArchiveKey`
(FR-022, ADR-093 1.2.0). This supersedes the FR-277 192-table binding that
0.3.12b independently confirmed; that binding stays historical and is refused.

Version diff 0.3.10b → 0.3.11b: rebind the frozen recovery inventory to the
schema with `Message.authorChannelIdentityId` (FR-022 group-speaker erasure).
The 191-table mapping is unchanged; the 0.3.10b binding stays historical and is
refused.

Version diff 0.3.9b → 0.3.10b: rebind the frozen recovery inventory to the merged
Notion + Conversation Runtime schema (191 tables, `runtimeOwner` on the LINE
account and conversation-job models). The table mapping is unchanged; the
Notion-only and runtimeOwner-only bindings stay historical and are refused.

Version diff 0.3.8b → 0.3.9b: rebind the frozen recovery inventory to the 191-table
schema after adding the Notion OAuth state, encrypted webhook verification-token
and receipt models. OAuth state and verification-token material stay out of
snapshots; minimal receipts remain recoverable. The 188-table binding remains
historical and refuses cross-schema recovery.

Version diff 0.3.6b → 0.3.7b: rebind the frozen recovery inventory to the
composed 187-table schema after FR-268's `BusinessKeyResult`/
`BusinessKeyResultCheckIn` models and the PM approval gateway's
`ProjectApprovalRequest` model landed. The 186-table binding remains historical
and refuses cross-schema recovery.

Version diff 0.3.4b → 0.3.5b: rebind the frozen recovery inventory to the composed
179-model schema after adding the two Knowledge artifact storage models; the
177-model binding remains historical and refuses cross-schema recovery.

Version diff 0.3.3b → 0.3.4b: record the successful composed executable recovery
gate without changing approved recovery or erasure authority.

Version diff 0.3.2b → 0.3.3b: bind the independently reviewed 177-model
composition and preserve Pricing validation and parent-first offline insertion.
Recovery and erasure authority are unchanged.

Version diff 0.3.0b → 0.3.1b: bind the mandatory peer-composed inventory;
the approved recovery and erasure decisions are unchanged.

Preflight and apply use an explicit transaction on the supplied connection.
Set `row_security = off` locally and count every application table. This setting
does not grant a bypass: a query that would be filtered by RLS must fail. Such a
failure is `TARGET_EMPTY_UNVERIFIED`, never a zero-row proof. The actual supplied
maintenance connection must demonstrate complete visibility and the required
read/insert/table-lock capabilities. It may be privileged; that fact is recorded
as maintenance evidence and can never satisfy the ordinary runtime isolation gate.

The machine result contains `schemaVisibility: FULL | UNVERIFIED` and
`applicationTableCount`. Emit FULL only after the inventory and complete counts
and the selected command's privileges are proven on that same connection:
read/insert/lock for recovery, read for protected export. A filtered/unreadable
table is UNVERIFIED and returns `TARGET_EMPTY_UNVERIFIED` for empty-target
proof; a role name or assumed bypass privilege is never sufficient evidence.

During apply, acquire table locks in sorted schema/table order before counting,
hold them through validation and insertion, and use a bounded lock timeout.
Refuse on a lock/privilege error. Recheck that every application table is empty
on that same connection before the first insert. This prevents a concurrent row
from invalidating an earlier preview. Insert the existing complete snapshot and
the six new families in validated dependency order, then reconcile IDs, versions,
hashes and counts before commit. Do not modify the existing rows or roles.

Output is one redacted JSON result:

```text
{ status: READY | RESTORED | REFUSED | ROLLED_BACK,
  errorCode: null | bounded code,
  snapshotSha256, targetSchemaSha256,
  schemaVisibility: FULL | UNVERIFIED, applicationTableCount,
  targetCounts, incomingCounts, insertedCounts: counts | null }
```

Codes are `TARGET_CONNECTION_UNAVAILABLE`, `TARGET_SCHEMA_UNVERIFIED`,
`TARGET_EMPTY_UNVERIFIED`, `TARGET_NOT_EMPTY`, `TARGET_PRIVILEGE_UNAVAILABLE`,
`TARGET_LOCK_UNAVAILABLE`, `SNAPSHOT_DIGEST_MISMATCH`,
`PHASE_B_SNAPSHOT_INCOMPLETE`, `PHASE_B_SNAPSHOT_INVALID`,
`PHASE_B_SCOPE_INVALID`, `PHASE_B_RECEIPT_INVALID`, and
`PHASE_B_WRITE_ROLLED_BACK`. Refusal/rollback uses nonzero exit status and no
committed inserts. Successful evidence records digest, schema, counts and the
operator command's control result; no source text or connection string.

### Complete protected export

To avoid making protected recovery depend on an unavailable web export, provide
the companion local command
`node apps/server/scripts/phase-b-protected-export.mjs --output <absolute-path>`
with optional `--report <absolute-path>`. It uses the same process-only recovery
connection boundary and never accepts a database URL as an argument. Refuse an
existing output path so the operation cannot overwrite a prior backup.

Within one repeatable-read transaction, establish complete visibility with local
`row_security=off`, validate table inventory, extract every included snapshot
family and reconcile counts with the same transaction snapshot. Preserve all
existing exclusion/redaction rules and required archive/rollup manifests. It
creates no source-database row and does not change roles or credentials. If any
family is unavailable or invalid, publish no completed snapshot. Write the
validated artifact atomically, compute its exact byte digest, and return only
its output path, schema/digest/counts and `EXPORTED` or a bounded refusal.
The snapshot itself retains the same confidential-data classification as the
existing backup format; reports contain no row payloads. This supplies an
explicit full-family artifact for the clean-target restore command.

### Family descriptors and restore matrix

| Delegate | Ordinary runtime | Restore dependency |
|---|---|---|
| governanceSnapshot | SELECT / INSERT | Tenant, Business, Project, Workspace, Repository, ProjectRepository |
| projectFeature | Scoped mutable | Project and optional GovernanceSnapshot |
| featureContribution | Scoped mutable | ProjectFeature |
| featureWorkLink | Scoped mutable | ProjectFeature, WorkItem and Workstream |
| requirementBinding | Scoped mutable | ProjectFeature and GovernanceSnapshot |
| projectFeatureMutationReceipt | SELECT / INSERT | Project, typed resource and AuditEvent |

The six arrays form one complete family. Validate the selected data contract,
including cross-family keys, same-Project scope, deletion batches, hashes and
receipt tuples. Missing, present-empty and unreadable remain distinct states.

| Incoming family | Authoritative current family | Web replacement | Clean-target command |
|---|---|---|---|
| Any | Completeness unavailable | Maintenance refusal | Empty-target proof refusal |
| Malformed or partial | Any | Invalid snapshot refusal | Invalid snapshot refusal |
| All six missing from an explicitly legacy snapshot | All six proven empty | Preserve legacy behavior; no Phase B insert/delete | Incomplete snapshot refusal |
| All six present-empty and valid | All six proven empty | Preserve legacy behavior; no Phase B insert/delete | Ready only if every application table is proven empty |
| Missing or present-empty | Any current row | Maintenance refusal | Target-not-empty refusal |
| Complete valid nonempty | Any | Maintenance refusal | Insert only into a fully verified empty target |
| Invalid row/scope/hash/receipt | Any | Invalid snapshot refusal | Specific validation refusal |

An unbound ordinary PostgreSQL client cannot establish global zero counts for
the new forced-RLS families, even if a query returns zero. Export must refuse
with `PHASE_B_EXPORT_COMPLETENESS_UNAVAILABLE` before producing an artifact in
that case. SQLite's unfiltered transactional extraction or a separately supplied
maintenance connection may prove complete counts; an HTTP caller cannot select
that privileged connection. An offline recovery consumes an artifact whose full
family provenance has already been validated; it does not fetch provider data.

`assertPhaseBWebRestoreSafe(tx, snapshot, preview)` runs inside the existing
import transaction, after the archive/rollup safety check and **before the first
delete of any table**, including pluginInstallation and localWorkspaceMount.
It repeats current-family proof instead of trusting preview counts. Refusals use
the existing envelope (`restored:false`, `valid:false`, bounded `errorCode`).
The ordinary delete/insert loops always skip the six new tables; empty immutable
tables still have no runtime DELETE privilege. A nonempty incoming family is
never ignored while unrelated tables are replaced.

## Concrete Identity-to-PM erasure contract

The internal manifest has fixed version `pm-erasure.v1`, tenantId, businessId,
subjectPersonId, reviewerPersonId, requestId, reasonRef, targets and
manifestSha256. Each target contains projectId, recordType, recordId, field and
expectedVersion. The allowlist is exactly:

- ProjectFeature: title, problem, outcome.
- FeatureContribution: responsibility.

Sort targets by projectId, recordType, recordId and field; reject duplicates and
inconsistent versions for one record. Hash UTF-8 JSON with the above binding keys
in that fixed order and target keys in the listed order, excluding the digest
itself. All IDs, positive integer versions and field names have strict schemas.
There is no original text or replacement input. The reason is a bounded internal
reference, not free-form personal data.

`status: REVIEWED` is not an authorization token. Identity passes a separately
resolved trusted reviewer/viewer and its already-authorized subject/Business
context; PM validates that context against the manifest. Reviewer identity must
match, and existing erasure authority must cover the Business and every target.
The public erase request schema stays unchanged and cannot carry a manifest,
reviewer, database client or authority flag. The internal review integration must
explicitly record whole-field approval; missing approval returns PENDING.

```text
applyReviewedProjectFeatureErasure(tx, manifest, { authority, now })
  -> { status: APPLIED | REPLAYED | UNMAPPED | PENDING,
       manifestSha256, changedRowCount, changedFieldCount }

erasePrincipal(input, { db = prisma, reviewedPmContext = null })
eraseCustomerPrincipal(customerId, input,
  { viewer, db = prisma, reviewedPmContext = null })
```

These are internal service signatures, not new public API operations.
eraseCustomerPrincipal forwards the same db to erasePrincipal. A root client
opens one transaction; an explicit transaction client is reused without nesting.
All CRM, Integration and PM effects and the existing audit use that transaction.

The PM port locks the subject for request/replay serialization and locks affected
Projects in deterministic order. It verifies current authority, hierarchy and all
expected versions before updating. PostgreSQL scope changes occur only within a
tested erasure adapter that restores the prior local scope after each bounded
Project callback; this exception cannot be used by the ordinary one-Project
Feature repository. Any nonempty unrecognized initial scope refuses.

Update each targeted row once with `[erased]`, increment its version once, and
increment each affected parent Feature aggregate version once when a Contribution
changes. Preserve all IDs, lifecycle, tombstones and deletion batches. A stale,
foreign or invalid target throws a typed refusal so Identity rolls back every
composed effect; returning a status without rollback is insufficient.

Under the same subject lock, compare request identity and manifest digest to the
existing immutable PRINCIPAL/ERASED audit. A matching prior PM effect replays with
no new PM update; a changed digest refuses. Identity appends its normal audit only
after successful composition, with PM digest/reviewer/target identities/fields
and counts. No seventh model or new audit mutation is introduced. Absent mapping
or review is surfaced as UNMAPPED/PENDING in the erasure result and audit; a
generic success message must not claim all PM text has been erased.

## Verification required before accepting implementation

| Area | Required evidence |
|---|---|
| Export | RLS-hidden populated family refuses instead of exporting empty; valid scoped/maintenance extraction reconciles complete family counts. |
| Web restore | Positive target/snapshot sentinels and a row introduced after preview trigger refusal before the first destructive statement; legacy unaffected cases retain behavior. |
| Offline recovery | Empty target succeeds atomically; nonempty target, missing/partial families, bad scope, wrong digest, receipt tuple mismatch and failed insert leave the target unchanged. |
| Runtime privileges | Actual non-bypass runtime login cannot update/delete immutable evidence; maintenance evidence is labeled separately. |
| Erasure | Review targets, subject, scope, field allowlist and versions are enforced; stale/foreign/changed replay leaves all records unchanged. |
| Shared text | Only reviewed fields are redacted; other-authored/unknown/unreviewed text is retained with explicit pending status; no actor inference. |
| Composition | Identity/CRM/PM rollback and current legal-hold behavior pass together; manifest audit contains no original user text. |

## Approval and version diff

Both decisions above are approved by the owner's latest "Approve". Difference from the
original Phase B plan: protected recovery uses a separate clean-target offline
path, and PM text erasure requires explicit reviewed field targets. Neither
capability is implemented by this document alone. Root updates the
selected contract, phase handoffs and tests under that approval; production rollout
still requires its existing independent and real-role gates.

## CHANGELOG

| 0.3.24b | 2026-10-24 | beta | Add excluded product-field disclosure authority to the complete 210-table census; preserve every predecessor mapping and historical binding refusal | working-tree | Codex Root |
| 0.3.25b | 2026-10-24 | beta | Compose Pipeline C1 and FR-235 into the current 210-table recovery binding; retain predecessor bindings as historical | working-tree | Codex Root |

### Historical FR-235 product disclosure binding before Pipeline C1

The owner-approved [LINE customer product contract](../../change-requests/integration/line-customer-product-disclosure-20261024.md)
adds only `LineProductDisclosurePolicy` to the complete census, preserving all
209 predecessor mappings. Knowledge owns this default-OFF disclosure authority.
It is excluded from portable snapshots; restoring its Business/account/Product
parents clears the grant, requiring a fresh owner preview and approval.

- Pre-C1 canonical LF schema SHA-256: `291c8a43acdeb62e1839e262d663371a6c009c92a46fe60f3296c045c550e86e`.
- Pre-C1 target inventory SHA-256, computed with `computeTargetSchemaSha256`: `3848d6a69c33dec8f6e49ece409bcc73854bb7493b7eb5d78e154e9b6c4814c1`.

This 210-model binding predates the Pipeline C1 `Dependency.contractJson`
column and is now historical. The policy model remains in the current Pipeline
inventory, while the current reader binds the composed schema below. This former
binding is refused at loader, adapter, export and restore boundaries. A nonempty
policy table still makes a recovery target nonempty. This static schema
maintenance does not relax recovery, privilege, custody or production gates and
applies no deployed migration.

### Historical FR-291 stock policy static binding

The approved [customer LINE stock/price contract](../../change-requests/integration/line-agent-stock-price-facts-20261023.md)
adds only `LineStockDisclosurePolicy` to the complete application table census.
All prior 208 public model/table mappings are preserved exactly; the new
`public.LineStockDisclosurePolicy` mapping brings the census to 209. Inventory
owns this default-OFF authority. Its presence in the empty-target/catalog census
does not make it portable snapshot data or authorize restoring a disclosure
grant. Existing portable recovery exclusion remains in force.

- Exact canonical LF schema SHA-256: `fe67a5c5ed02710cdb67227e80380812f233f88ab5a3638f7079527c056b1808`.
- Target inventory SHA-256, computed with `computeTargetSchemaSha256`: `db2e0014754558f8e21fdcad9960565cfccd150343e71b0ae614589b9429e633`.

These exact values identify the historical pre-C1 FR-291 inventory preserved at
`contracts/phase-b/target-schema.inventory.json`. The current reader uses the
Pipeline inventory below. The 208-table FR-001 predecessor and every earlier
binding remain historical and must be refused at loader, adapter, export and
restore boundaries. An existing policy row makes a target nonempty even though
the policy is excluded from portable data. No schema validation, target
visibility, privilege, custody or transaction gate is relaxed. This reviewed
static rebind under the owner's implementation mandate applies no deployed
database migration and grants no live recovery, external target connection or
production release authority.

### Historical FR-001 scope metadata static binding

The FR-001 correction adds `Portfolio.status`, `LegalEntity.version` and
`Branch.version` to support non-destructive archive and concurrent update checks.
All 208 application model/table mappings from TASK-ZAI-011 are preserved exactly;
no model is added, removed or remapped. Root reconciles this static binding under
the owner's delegated application-fix mandate. Existing custody, clean-target,
privilege and transactional recovery checks remain required.

- Exact canonical LF schema SHA-256: `579afacd11ae1ad34c11183a9617896812c2af94d6b5c7187f382d3f37f418e8`.
- Target inventory SHA-256, computed with `computeTargetSchemaSha256`: `af3a57bba8079615e6f8c85718e731eade38aa8de5840e78958231e50fc5e683`.

The former loader bound these values and the complete 208-model census. This
binding and the preceding same-count TASK-ZAI-011 binding are refused at the loader,
adapter, export and restore boundaries. Tests verify that refusal as well as
current schema equality. No historical evidence is rewritten. This source
reconciliation neither applies a deployed database migration nor proves or
authorizes live recovery, production rollout or external target access.

### Historical TASK-ZAI-011 static binding

The notification model added by TASK-ZAI-011 is included in the portable snapshot
census and the exact Phase B public-table inventory. The prior 207 mappings are
preserved; `AgentApprovalNotification` is added as the 208th mapping. Approval
notifications remain in-app records; this static rebind grants no external send,
production migration, target connection or live recovery authority.

- Exact canonical LF schema SHA-256: `47efde1279bc107458cfa28b9e80920df60555089b8763d7634b550c0e9e661b`.
- Target inventory SHA-256, computed with `computeTargetSchemaSha256`: `cb2449ec562fbf9217956442a48b34eac948c74873d7c24f85a2593fd12df38c`.

The former loader bound these values and all 208 declared application models. The 207-table
TASK-ZAI-010 binding below and all earlier bindings remain historical and are explicitly refused
at loader and recovery-runner boundaries. Local tests still gate delivery; target
visibility, custody, clean-target and production gates are unchanged.

### Historical TASK-ZAI-010 static binding

TASK-ZAI-010 added `AgentApprovalRequest` and `AgentApprovalDecision` to the
205-model FR-286 census, preserving those mappings for 207 total application
tables. Both models are portable history; restore invalidates nonterminal
requests so approval cannot execute again. This binding is now historical because
TASK-ZAI-011 adds `AgentApprovalNotification`.

- Exact canonical LF schema SHA-256: `ddbda079e8fdc4a8521ef75e35cecc9a139a465aa9736d0158c9a779fb793c34`.
- Target inventory SHA-256, computed with `computeTargetSchemaSha256`: `6ca13ac1246889b4449fee8f94af3aad8012e55159a3427bf9ef953f1adc9b76`.

The former loader bound all 207 mappings. Its schema and target inventory hashes
are retained for audit and are refused at loader and recovery-runner boundaries
under its then-current 208-table successor binding. No live migration or recovery is implied.

### Historical FR-286 static binding

The 0.3.20b FR-286 snapshot records four Business marker/snapshot columns and
Workspace.provisioningKey; those column additions did not change its 205-model
inventory. It remains historical after TASK-ZAI-010 added approval request and
decision models and TASK-ZAI-011 added the notification model. Its recorded
canonical schema SHA-256 is `4679367cef0dcb57f17e68a9b1fe1ae56d2c84313d8618b8733b111a68b6cbb7`;
its target inventory SHA-256 is `764149d3115fb3476983f1e8b1088985a137d15c3c7d9909476d523e8534fe44`.
No historical receipt is rewritten. The old binding is refused at loader and
recovery-runner boundaries. No external migration application, target connection
or live recovery is granted.

### Historical FR-285 static binding

Root reconciles the frozen inventory under the delegated repository mandate
after full-CI evidence exposed the added model's missing inventory binding.
This is a local source reconciliation of the existing recovery decision, with
no production migration, target connection or live recovery authority granted.
The census contains 205 application models: the prior 204 mappings are preserved
exactly and only `BusinessAgentConfig` is added. Its dependent Business lifecycle
and retained audit are specified by the [Factory v1 contract](../../change-requests/agent-factory/AGENT-FACTORY-V1.md).

- Exact canonical LF schema SHA-256: `9dc731a7fb749d147f285e0c5eafa3b494b0c67007bdba48f1c094ef06e8aefa`.
- Target inventory SHA-256, recomputed with `computeTargetSchemaSha256`: `9d8c464cbe8d07500dfe0515e85e434b9ab1454ac141f999978e1b8b6987a1c4`.

The FR-285 loader required these exact values and all 205 mappings. This and earlier bindings
remain historical and are refused by the current loader. Independent source
review and fresh executable recovery tests still gate delivery; actual external
target visibility, clean-target, custody and production gates remain in force.

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.3.23b | 2026-10-23 | beta | Add only excluded LineStockDisclosurePolicy to the complete 209-table static census; preserve all prior mappings and old binding hashes as history, and retain all external recovery, custody and production gates | working-tree | Codex Root |
| 0.3.22b | 2026-10-23 | beta | Bind FR-001 scope archive/version columns with all 208 table mappings unchanged; refuse the same-count TASK-ZAI-011 predecessor and retain custody, recovery and production gates | working-tree | Codex Root |
| 0.3.21b | 2026-10-18 | beta | Bind TASK-ZAI-011 AgentApprovalNotification as the 208th static snapshot table; preserve the prior 207 mappings and all external recovery, migration and production gates | working-tree | Codex Root |
| 0.3.20b | 2026-10-15 | beta | Rebind FR-286 Business/Workspace provisioning columns with all 205 prior mappings preserved; explicitly refuse the same-count FR-285 predecessor and retain external recovery/production gates | working-tree | Codex Root |
| 0.3.19b | 2026-10-15 | beta | Add only FR-285 BusinessAgentConfig to the static 205-table census and bind canonical LF schema/inventory digests under delegated root disposition; preserve 204 prior mappings, custody refusals and all external recovery/production gates | working-tree | Codex Root |
| 0.3.18b | 2026-10-12 | beta | Bind the four FR-270 Business WIG tables in the static 204-table inventory; preserve all earlier mappings, custody guards and production/recovery gates | working-tree | Codex |
| 0.3.17b | 2026-10-12 | beta | Bind the FR-269 Business KPI tables in the static 200-table inventory; preserve all earlier mappings and production/recovery gates | working-tree | Codex |
| 0.3.16b | 2026-10-10 | beta | Compose API-010 and main into 198-table inventory; preserve both lineages, all mappings and retained-custody refusal; mechanical reconciliation only | working-tree | Codex |
| 0.3.15b | 2026-10-06 | beta | Main branch history: owner-approved 194→197 Marketing custody rebind; exact prior mappings preserved, raw LF and canonical inventory hashes pinned; retained/unsupported Marketing JSON recovery refuses | working-tree | Codex |
| 0.3.15b | 2026-10-04 | beta | API-010 branch history: rebinds Phase B recovery to the raw current schema digest and 195-table mapping including MemoryProjectionReceipt; prior bindings remain refused | working-tree | Codex |
| 0.3.14b | 2026-09-28 | beta | Rebinds Phase B recovery to the AgentTraceEvent erasure-scan index schema; preserves the 194-table mapping and refuses the prior schema digest | working-tree | Codex |
| 0.3.13b | 2026-09-27 | beta | Rebind Phase B recovery to the 194-table schema adding `CustomerRetentionConsent` and `LegalHoldArchiveKey` (FR-022, ADR-093 1.2.0): `schemaSha256` `1f7fa962…1206`, `targetSchemaSha256` `3b0841c3…8c79` via `computeTargetSchemaSha256`; both new models in `SNAPSHOT_MODELS`; the 192-table binding confirmed in 0.3.12b is superseded and refused | working-tree | Claude Opus 5.5 (MC0) |
| 0.3.12b | 2026-09-27 | beta | Independently recompute and confirm the FR-277 rebind (191→192 tables, `LineGroundingShadowComparison`): `schemaSha256` matches the committed `prisma/schema.prisma` bytes exactly; `targetSchemaSha256` recomputes correctly via the repo's own `computeTargetSchemaSha256` over the committed 192-entry mapping. Mechanical hash/count check only — does not re-review family/RLS mapping design beyond noting the model follows `AgentTraceEvent`'s existing no-relation precedent; a deeper design review and the CLI proof remain separately undone | working-tree | Claude Sonnet 5 |
| 0.3.11b | 2026-09-27 | beta | Rebind Phase B recovery to the 191-table Message `authorChannelIdentityId` schema (FR-022 PDPA erasure column); table mapping unchanged, schema bytes change; refuse the merged Notion + Conversation Runtime binding | ffede2f9 | Claude Opus 5.5 |
| 0.3.10b | 2026-09-27 | beta | Rebind Phase B recovery to the merged Notion + Conversation Runtime schema (191 tables, runtimeOwner fields); refuse both the Notion-only and runtimeOwner-only bindings; document runtimeOwner restore handling | working-tree | Claude Opus 5.5 (MC0) |
| 0.3.9b | 2026-09-26 | beta | Rebind Phase B recovery to the 191-table Notion schema; exclude OAuth state and encrypted webhook verification material from backups, include minimal receipts, and preserve refusal of the historical 188-table binding | working-tree | Codex GPT-6 |
| 0.3.8b | 2026-09-24 | beta | Rebind Phase B recovery to the 188-table schema after adding the operational LINE OA worker checkpoint; preserve the historical 187-table binding | working-tree | RWANG |
| 0.3.7b | 2026-09-23 | beta | Rebind Phase B recovery to the composed 187-table schema after FR-268 and PM approval gateway models landed; preserve the historical 186-table binding | working-tree | RWANG |
| 0.3.6b | 2026-09-22 | beta | Rebind Phase B recovery to the composed 186-model schema after the FR-268 Business Key Result models landed; preserve the historical 179-model binding | origin/main | RWANG |
| 0.3.5b | 2026-09-19 | beta | Rebind Phase B recovery to the composed 179-model schema after the two Knowledge artifact storage models landed; preserve the historical 177-model binding | working-tree | RWANG |
| 0.3.4b | 2026-09-17 | beta | Close the separate executable 177-model recovery gate with 22 positive and 15 adversarial frozen-source checks | 052821a7 + 892f23f3 | RWANG |
| 0.3.3b | 2026-09-17 | beta | Bind reviewed Pricing/PM 177-model schema and complete snapshot coverage; require fresh executable proof and preserve obsolete-binding refusal | 052821a7 + 892f23f3 | RWANG |
| 0.3.2b | 2026-09-17 | beta | Document the implemented operator-checkout dependency boundary and unavailable-validator refusal; selected behaviors unchanged | bd99651f | RWANG |
| 0.3.1b | 2026-09-17 | beta | Bind the peer-composed 175-model inventory and record independent inventory review; selected recovery and erasure behavior unchanged | bd99651f | RWANG |
| 0.3.0b | 2026-09-17 | beta | Record owner approval of both frozen v0.2.1b decisions and authorize bounded W2 local implementation | bd99651f | RWANG |
| 0.2.1b | 2026-09-17 | candidate | Pin schema-inventory hash bytes and explicit full-visibility attestation after independent owner-selection PASS | bd99651f | RWANG |
| 0.2.0b | 2026-09-17 | candidate | Define offline command, actual visibility and locking proof, family matrix and Identity transaction/replay seam | bd99651f | RWANG |
| 0.1.0b | 2026-09-17 | candidate | Propose bounded clean-target recovery and reviewed PM erasure targets to close source-audited W2 authority gaps | bd99651f | RWANG |

## Current composed Pipeline C1 and FR-235 schema binding (2026-10-24)

The owner-approved C0 v0.1.5 D1–D6 and C1 instruction authorize qualification
of the additive nullable Dependency.contractJson column. The current recovery
reader selects [the Pipeline inventory](contracts/pipeline-target-schema.inventory.json).
It preserves all 209 Pipeline C1 model/table mappings and adds
`LineProductDisclosurePolicy` to the complete census, for 210 models. The
default-OFF policy remains excluded from portable snapshots. The prior Phase B
inventory file stays byte-for-byte historical. This records a static binding,
not a production migration or recovery acceptance claim.

- Current canonical LF schema SHA-256: `d02a47eb5fd6e4ec850b2fa77b40abe854cef4d2a5a1a3c0a39e111666bb16f9`.
- Current target inventory SHA-256, computed with `computeTargetSchemaSha256`: `a5299c23812a8c44f9590af29e15db6e6cdc06d6c1904a2b8b555f97564121e7`.
- Historical Pipeline C1 209-table schema/target binding: `d8ec4c28d9c3354305e4699f6d090148daedc52638da1c5bb2d17fbb136d8d21` / `dbbde65f8e637e738b0bc3fc5295871bd82641928828946092b11677647b1559`.
- Historical pre-C1 FR-235 210-table schema/target binding: `291c8a43acdeb62e1839e262d663371a6c009c92a46fe60f3296c045c550e86e` / `3848d6a69c33dec8f6e49ece409bcc73854bb7493b7eb5d78e154e9b6c4814c1`.
- Historical pre-C1 FR-291 Phase B 209-table schema/target binding: `fe67a5c5ed02710cdb67227e80380812f233f88ab5a3638f7079527c056b1808` / `db2e0014754558f8e21fdcad9960565cfccd150343e71b0ae614589b9429e633`.
- Both adapters must preserve legacy NULL and declared contract/provenance,
  immutable delta audit/receipt/trace identities, and cross-Tenant legacy bridges.
- Unknown contract versions/corruption or missing target columns refuse restore
  before mutation; downgrade must not strip enforcement or content.

The three prior bindings above remain historical and must be refused at loader,
adapter, export and restore boundaries. The current inventory changes no recovery
or erasure authority and does not authorize a live migration or recovery run.
