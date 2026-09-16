---
version: "1.0.0b"
status: beta
created_at: "2026-09-08T22:06:00+07:00,RWANG,base d1062fcb"
last_update: "2026-09-08T22:06:00+07:00,RWANG"
---

# Knowledge PR identity collision with published main

## Symptom

After pushing the validated admission revision d1062fcb, GitHub reported PR #293 CONFLICTING and did not schedule its pull-request checks.

## Evidence

`git merge-tree --write-tree HEAD origin/main` against main d36f9a61 reported registry/ledger/generated-view conflicts. Main declares CRM as FR-172 and ADR-071; the unmerged knowledge branch had independently used those numbers for admission and isolated execution. Application source merged without content conflicts.

## Root cause

Independent unmerged branches allocated the same next registry numbers. The local governance pass validated each branch internally, not the identity ownership on a subsequently advanced trunk.

## Why the issue escaped detection

The admission tests and local graph operated on the earlier trunk baseline dfdbaf11. The collision became visible when GitHub tried to compose the new PR head with current main. The gates reported it correctly; earlier green checks belonged to the earlier head.

## Resolution and prevention

Following AGENTS.md section 18, the later unmerged knowledge declarations move to FR-173 and ADR-073. Published main keeps its CRM IDs. The ID tooling records both branch abandonments and trunk declarations; source annotations and current links follow the new knowledge IDs. Historical pinned reports retain their original revision identities. Regenerate all derived views rather than resolve generated JSON by hand, and preserve main's removal of the tracked drift report.

Three same-subject statements (SDD-057, SDD-059, FEAT-013) referenced the moved IDs. The full suite identified stale review digests. Exact `docs:ids --review` commands acknowledge these reference-only changes without changing anchors or weakening the test. Refresh published main before allocating new IDs or preparing a coordinated PR, then verify the composed tree again.
