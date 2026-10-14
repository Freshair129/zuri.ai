---
doc_type: change-request
title: Portable managed file content on Windows and POSIX hosts
status: approved
superseded_by: null
version: "0.1.0"
date: "2026-10-14"
risk: HIGH
relations:
  - type: relates_to
    target: ZAI:FR-045
  - type: relates_to
    target: ZAI:SDD-023
  - type: relates_to
    target: ZAI:SEC-007
  - type: relates_to
    target: ZAI:ADR-016
---

# Portable managed file content

## Approval

The user's current instruction is to make PM and Knowledge actually usable, fix
encountered problems, and commit, push, open a PR and merge after all checks pass.
The standing trusted delegation permits in-scope technical decisions without
another human approval. The configured Sol decision role approves this bounded
platform extension under that delegation on 2026-10-14. This is an agent decision
under the user's mandate, not a claim that the user authored this document.

Approval covers isolated implementation, testing, governed additive record
issuance and the authorized Git delivery. It grants no production, Supabase,
provider-message, credential, host PATH or database-reset effects. Publication
and merge require independent verification, separate review and applicable
exact-head CI; this design approval is not their result.

## Evidence and parent impact

At main `e580052d325426590f55a65d874a2b4ef829f950`, the native Knowledge browser
acceptance passes text admission, real publication, citation, restart, correction
and withdrawal. Its managed FileAsset case fails HTTP 500 with ENOENT: the local
file service normalizes its POSIX `/tmp/...` mount with `path.win32`, resulting in
`\tmp\...`. The acceptance runs on the official Linux Docker environment.

SDD-023 explicitly describes the previous Windows-only containment capability.
Preserve that historical source row, its hash, ID and provenance. Add separately
authored FR and SDD records through the sanctioned record-migration writer;
they extend managed content IO to POSIX hosts without rewriting SDD-023.
FR-045 identity, ownership, links, quarantine, audit and legacy compatibility
remain the governing contract. ADR-016 D3/D6/D8 still requires device-local roots,
contained IO and atomic promotion. Explorer reveal remains a Windows capability;
hosted requests cannot acquire local OS process access.

## Bounded design

Choose one path dialect from the explicit absolute mount root: fully qualified
Windows drive/UNC paths retain Windows rules, while POSIX absolute roots use
POSIX rules. Reject drive-relative and ambiguous Windows rooted paths. Portable
client paths reject absolute paths, parent traversal, NUL and unsupported Windows
segments. Lexical and resolved root/parent/staged containment use the same dialect;
POSIX containment and reconciliation retain case sensitivity.

Apply that dialect consistently to mount normalization, staging, promotion,
read/stat/cleanup, cache paths and reconciliation. Keep Windows volume checks.
POSIX promotion uses rename without a copy fallback; cross-filesystem errors
remain failures and content stays quarantined. No database schema or authorization
change is included. The native Knowledge test must continue to admit real managed
text files and reject unsupported binary content with HTTP 415.

## Acceptance

1. Given a real temporary POSIX mount, when managed content is staged, promoted,
   read and reconciled, then exact bytes persist under that root without backslash
   path conversion, and cache stays non-authoritative.
2. Given Windows drive/UNC roots, when existing path/port/service regressions run,
   then existing contained paths and cross-volume refusal remain intact.
3. Given traversal, ambiguous roots or a symlink/junction escaping the selected
   root, when content IO is attempted, then it fails closed without promotion.
4. Given the unchanged actual native Knowledge browser acceptance, when both
   cases execute, then managed FILE publication and binary 415 rejection pass
   alongside the original text, citation, correction, withdrawal and restart case.
5. Given the frozen submission, when independent G2, separate G2R, build,
   governance and applicable exact-head CI complete, then root may merge only
   with their actual passing evidence. Earlier failed receipts stay failed.

## Version diff

0 to 0.1.0: approves the bounded additive platform extension under trusted agent
delegation. Existing published identities and source-preserved rows remain exact.
