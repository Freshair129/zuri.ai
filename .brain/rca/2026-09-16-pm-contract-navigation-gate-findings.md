---
version: "0.1.0b"
status: candidate
created_at: "2026-09-16T15:29:41+07:00,RWANG,base eddd3dd8"
last_update: "2026-09-16T15:29:41+07:00,RWANG"
attributes:
  domain: project-manager
  scope: Documentation contract and navigation verification
---

# RCA — PM candidate contract and navigation disagreement

## Symptom

Candidate prose, OpenAPI and navigation mappings disagreed. Structural validation alone passed examples while admitting empty preview version pins and non-draft preview states. A strict receipt could not carry the override reason required by prose. The navigation patch kept obsolete bindings and narrowed Docs & Decisions to Decisions.

## Evidence

- Independent D01 attempt-2 receipt `D4252D5667B27471B9146C89B063680FCC5881C9AE897F1459BD4790D2DA6FEA` recorded six reproducible findings despite 126 passing worker checks.
- `PreviewInput.sourceVersions` lacked `minItems`; preview reused record-state `AllocationChange`; `PMMutationReceipt` forbade the required override reason through `additionalProperties: false`.
- Unchanged Workforce operations still referenced the earlier `Error` with `correlationId`, while the new prose claimed the scoped error envelope covered them.
- Independent D08 receipt `3D9179643000BC325BE6144C5DA46D6E2A86421A898E01325482C012EE53BCAA` recorded five navigation failures: shared Import visibility, residual legacy bindings, undeclared group/action typing, `b.work` versus `b.all-work`, and WF-13 semantics.
- Root browser checks found the composed documentation prototype needed one Docs & Decisions entry to match the machine model. Removing the extra Decisions entry was followed by a new browser check.

## Root cause

The first proposals updated related representations separately. Reusing a persisted-record schema as preview intent conflated two lifecycles. A keyed UX merge preserved obsolete `navIds`; no explicit generation policy classified those inherited references. Prose described a wider contract closure than the three operation nodes that were actually replaced.

## Why the issue escaped detection

The initial checks covered supplied positive examples, local references and operation retention. They did not test the empty version-pin set, forbidden preview states, receipt representability or all surviving navigation references. A valid schema document is not proof that it expresses the intended behavior.

## Correction and prevention

- Compose complete candidate documents before review, keep immutable failed attempts, and record exact output hashes.
- Separate DRAFT preview command intent from persisted allocation states; require nonempty pins and owner verification of the complete affected read set.
- Keep receipt and error scope explicit, including override evidence and 409 expiry versus 412 version conflict.
- Classify every legacy navigation reference; deferred bindings cannot drive generation. Keep Import an action, not a tab.
- Run positive/negative schema checks and source enumeration, then independent Luna verification, then root composition and browser verification of the documentation artifact.
- Preserve open CSRF owner binding, Workforce input ports, service tests and migration work as separate gates. No runtime correction or production claim follows from this document review.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | Record independently reproduced candidate contract/navigation defects and prevention | base eddd3dd8; isolated documentation | RWANG |
