---
version: "1.0.0b"
status: beta
created_at: "2026-09-27T00:00:00+07:00,Claude Sonnet 5"
last_update: "2026-09-27T00:00:00+07:00,Claude Sonnet 5"
attributes:
  domain: knowledge
  doc_type: dod-review
  scope: "read-only review of TASK-ZAI-050's two open Definition of Done items"
---

# TASK-ZAI-050 Definition of Done review — 2026-09-27

Revision 2.134.0b of [`docs/roadmap/ROADMAP.md`](../../docs/roadmap/ROADMAP.md) moved
TASK-ZAI-050 to `in-progress / PRODUCTION / IN_PROGRESS` on the 2026-09-24 GenesisRAG17
production observation, but explicitly declined to call it `done` because two
Definition-of-Done items were unverified: **knowledge migrations recorded** in the
production migration ledger, and **a documented operator activation record**. This note
is a read-only review of both, run from a sibling worktree
(`docs/task-zai-050-dod-review` branch) off `origin/main` at `cc44ab86`, to find out
whether either gap is already closeable from evidence that exists elsewhere in the
repository, or whether it is genuinely still open. No production database, Docker host
or credential was touched or mutated by this review.

## 1. Knowledge migrations recorded — closeable from existing evidence

[`TC-TASK-ZAI-050`](../../docs/roadmap/ROADMAP-zuri-ai-24w-program.md) names the exact
scope of this item in its acceptance criterion, unchanged since 2026-09-13:

> Given the production database, when the knowledge migrations (`genesisrag17_tier1`
> `20260907160000`, audit remediation `20260908040000`, `knowledge_admission`
> `20260908100000`, `knowledge_evidence_cursor` `20260907120000`) are checked, then each
> is recorded applied — the 2026-09-11 gap map found the tables present and the
> migrations unrecorded, which is not the same thing

So the open question is narrow: were these four specific migration versions, found
present-but-unrecorded on 2026-09-11, ever recorded in
`supabase_migrations.schema_migrations`?

**Yes, by 2026-09-23, on the evidence already in the repository.**
[ADR-104](../../docs/decisions/ADR-104-PRODUCTION-MIGRATION-LINEAGE-RECONCILIATION.md)
records a read-only preflight run on 2026-09-23 that compared the **full** committed
migration tree against the live production ledger: "105 committed Supabase migration
files versus 96 production ledger rows," with the gap enumerated as exactly ten named
versions (`20260907233000`, `20260912120000`, `20260912130000`, `20260912140000`,
`20260912150000`, `20260912160000`, `20260912170000`, `20260922120000`,
`20260922130000`, `20260923010000`). None of the four knowledge migrations above is in
that list. The file count checks out independently: `git ls-tree` of
`apps/server/supabase/migrations` at the commit immediately before this reconciliation
lands exactly 105 files dated at or before `20260923010000`, so the ADR-104 preflight's
105 covers all four knowledge migrations (all dated `20260907`–`20260908`, well inside
that set) with no exclusion or truncation.
[`docs/runbooks/production-migration-reconciliation.md`](../../docs/runbooks/production-migration-reconciliation.md)
records the apply that followed (PR #533, commit `119f9863`): "Post-apply verification
found 107 total ledger rows and all 11 expected version/name pairs" — the ten gap
versions plus the hardening migration ADR-104 itself added.

Because the 2026-09-23 preflight was a full, itemized diff against the entire migration
tree and did not flag any of the four knowledge versions as missing, the only consistent
reading is that they were already present in the production ledger at that point — two
days before the 2026-09-24 production probe found the KI17 overlay already publishing
against those same tables, and twelve days after the 2026-09-11 gap map had found them
unrecorded. Something recorded them in that window; ADR-104's preflight is the
documented proof that by 2026-09-23 they were no longer missing.

**Caveat, stated plainly:** this is an inference from a complete gap list, not a fresh
query naming these four versions by row. This session had no live production database
access to confirm it directly — the connected Supabase management tool
(`mcp__…__list_projects`) returned zero projects for this account, and no
`DIRECT_URL`/`DATABASE_URL` for the production instance was available in this
environment, so `scripts/readonly-supabase-preflight.mjs` could not be re-run here. If
the owner wants a first-class direct confirmation rather than an inference, the query is:

```sql
select version, name
from supabase_migrations.schema_migrations
where version in ('20260907120000','20260907160000','20260908040000','20260908100000')
order by version;
```

Four rows back would be a direct proof; this review's conclusion is that the existing
ADR-104 evidence already makes that the expected outcome, so this DoD item is treated as
**resolved by existing evidence** rather than "still open."

## 2. Documented operator activation record — genuinely still open

This is not resolved, and no document already in the repository substitutes for it. The
design document that defines what this record must contain is explicit that it does not
exist yet. [`docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md`](../../docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md)
§9.2, current on `origin/main` as of this review, states:

> What is **not yet true**: no record of the operator activation step itself (who ran
> §10, when, against which image digest and pin manifest, per §10 step 7) exists in
> `.brain/reports/`, ... Writing that activation record is tracked as separate
> follow-up work, not done in this note.

[`apps/server/deploy/ki17/README.md`](../../apps/server/deploy/ki17/README.md)'s current
status note says the same thing independently: "This status note records that the
overlay is running; it does not itself claim that knowledge migrations are recorded or
that a documented operator activation record exists — those remain open under
TASK-ZAI-050."

[`.brain/reports/2026-09-24-genesisrag17-production-probe.md`](2026-09-24-genesisrag17-production-probe.md)
was considered as a candidate for this record, since it is the most detailed production
observation on file. It is not a substitute, and says so itself, under "What this probe
does and does not prove": it does not prove "that an operator activation record exists
for when and how this runtime was turned on," and it is explicitly scoped as an
observation ("recorded for the Lane A4 round-3 acceptance review... which states
production facts that needed a committed, checkable record"), not as the activation
record §10 step 7 calls for. The two documents differ in kind: the probe counts rows in
a database at one point in time; §10 step 7 asks for a record of an *event* — who ran the
seven-step activation procedure, when, against which image digests and which four
pinned commits (zuri-ai, MSP, GKS, GenesisBlock), which Node/Python versions, which
model revision, which run id, and the publication receipt hash.

None of that event-level information is recoverable by reading the repository. Image
digests and receipt hashes exist only on the production host and in whichever database
row corresponds to the original admission run; the "who and when" is an operational fact
that only the person who ran the activation (or the host's own logs) can state. Writing
a document that filled in those fields from inference or from the probe's row counts
would not be a real activation record — it would look like one while asserting facts no
one checked, which is exactly the failure mode this task's instructions warned against.

**Conclusion: this DoD item requires real, new work by someone with production access**
— at minimum, `docker inspect` for the running `zuri-ai-web-1` /
`zuri-ai-genesis-worker-1` image digests, the four repositories' pinned commit SHAs used
to build them, and the publication receipt hash for one of the 22 `GenesisRag17PublicationReceipt`
rows already on record — recorded in `.brain/reports/` per §10 step 7. This review does
not attempt to manufacture that record.

## What this review changed

- `docs/roadmap/ROADMAP.md`: added Revision 2.137.0b and updated the TASK-ZAI-050 row's
  evidence text to reflect DoD item 1 (migrations recorded) as resolved by the ADR-104
  evidence traced above, and DoD item 2 (operator activation record) as still open. The
  task's status/scope/state (`in-progress / PRODUCTION / IN_PROGRESS`) is unchanged — it
  is **not** moved to `done`, because one of its two open DoD items is still genuinely
  unmet.
- `docs/roadmap/ROADMAP-zuri-ai-24w-program.md`: `TC-TASK-ZAI-050`'s
  `acceptance_criteria` entry (the four-migration check) is marked `checked: true` with
  a changelog entry citing this note; its `success_criteria` and `exit_criteria` are
  untouched, since they concern MSP/GKS reachability and the real-document run, not the
  two items this review was scoped to.
- No application code, test, migration, credential, deployment or production database
  state changed. No production migration was applied, and no operator activation
  occurred or is claimed.

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 1.0.0b | 2026-09-27 | beta | Initial DoD review: migration-ledger item resolved by tracing ADR-104 evidence; operator-activation-record item confirmed still open and requiring new operator work. No production access available to this session (Supabase MCP returned zero projects). | Claude Sonnet 5 |
