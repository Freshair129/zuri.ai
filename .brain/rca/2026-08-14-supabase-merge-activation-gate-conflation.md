---
version: "0.1.0b"
created_at: "2026-08-14T07:35:29+07:00,ATHER"
last_update: "2026-08-14T07:35:29+07:00,ATHER"
status: "beta"
attributes:
  domain: "data-security"
  doc_type: "root-cause-analysis"
  scope: "PR 3 merge readiness versus production activation"
---

# RCA — Supabase merge and activation gate conflation

## Symptom

PR #3 was technically mergeable and production-disabled, but its governance text required every
production activation gate before merge and simultaneously described a post-apply backup as
pre-apply evidence.

## Evidence

- GitHub reported the draft PR clean and mergeable with all local release suites passing.
- ADR-018 grouped runtime credentials, live login probes and the LINE canary into one exit list.
- ZV2-CR-004 required all ADR gates for Definition of Done although enabling LINE was out of scope.
- the committed evidence manifest classifies the retained dump as `post-apply-scoped-logical-backup`.

## Root cause

The production database deployment boundary and the later LINE traffic activation boundary were
modeled as one lifecycle gate. A concurrent evidence refresh then copied an earlier backup
description into the ADR, CR and phase report without reconciling it against the manifest.

## Why the issue escaped detection

The documentation graph validates identifiers, links and annotations, but does not compare factual
claims across prose and JSON evidence. Automated code tests also cannot decide release-policy
semantics or backup chronology.

## Proposed prevention

- define separate merge and production activation gates in the binding ADR and CR;
- require production-disabled state as a merge invariant;
- treat evidence manifests as authority for backup chronology; and
- verify activation evidence in a later controlled change before enabling traffic.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Root cause and prevention recorded before merging PR #3 | working-tree | ATHER |
