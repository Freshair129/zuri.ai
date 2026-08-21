---
version: "0.1.0b"
created_at: "2026-08-21T00:00:00+07:00,ATHER"
last_update: "2026-08-21T00:00:00+07:00,ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "governance"
  doc_type: "rca"
  scope: "the 17 informational findings reported by npm run govern"
---

# RCA — informational governance debt was not actionable

## Symptom

`npm run govern` passed with zero CRITICAL and WARNING findings but still
reported 17 INFO findings. The count mixed missing document metadata, one
accepted enum copy, and a healthy id-ledger roster.

## Evidence

- Fifteen live documents were missing Version and/or Status control fields.
- The Audit page kept a hand-copied entity vocabulary in
  `src/app/(pm)/audit/page.jsx`; the copy was complete, but the vocabulary had
  no independent source of truth.
- `evaluateIdStability` emitted a healthy roster summary as an INFO finding even
  when no id rule fired.

## Root Cause

The document-control check treated inherited documents as informational but did
not give them a defined control block. The enum guard had a shrink-only baseline
for a deliberate copy rather than a separate authoritative Audit vocabulary.
The id-stability health proof used the same channel as actionable review
signals, so a successful check increased the debt count.

## Why the issue escaped detection

The gate used PASS/WARN/CRITICAL for release decisions, so INFO output was
treated as harmless inventory. Existing tests protected the id-stability rules
and the Audit page's behavior, but neither asserted that a clean governance run
has zero informational findings.

## Proposed prevention

- Keep Version and Status in every live document's frontmatter or control table;
  generated views must receive those fields from their generator.
- Declare independent vocabularies once and derive consumers from them; keep
  the enum-copy baseline shrink-only.
- Store successful guard health under `docs/.preflight-report.json` metadata,
  separate from findings, and keep a regression test for the distinction.
