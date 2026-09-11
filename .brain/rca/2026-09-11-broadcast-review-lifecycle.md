# Broadcast review lifecycle

Version: 1.0.0b; Date: 2026-09-11; Status: beta.

## Symptom

An owner cannot continue editing or archive directly after revising a plan.
Archiving hides the saved plan and its immutable history on reload.

## Evidence

The real browser flow persisted revision 2 but its response had canWrite false.
Two added integration assertions failed: revised canWrite was false and archived
deletedAt contained the archive time instead of null. Four existing cases passed.

## Root cause

The mutation response hard-codes canWrite false for both revise and archive.
Archive also sets deletedAt, while list/get exclude rows with deletedAt. This
conflates retaining an archived plan with deletion.

## Why the issue escaped detection

Existing service tests asserted revision numbers and stale CAS refusal but did
not open an archived plan or use the mutation response for the next UI action.

## Proposed prevention

Use the already authorized owner write result with the DTO's status guard:
PLANNING remains writable and ARCHIVED does not. Archive changes status only,
retaining immutable revisions for authorized reads. Prove revise then archive and
list/get after archive through integration and browser tests. LOW risk within the
approved FR-185 lifecycle; no new action, migration or permission is introduced.

Version diff: lifecycle response and archive visibility regressions.

## AskMarketing development replay

The browser also stayed at Reading after the API completed. Its mounted guard
started true but the effect only set false in cleanup; React development effect
replay runs that cleanup before setup again, and setup never restored true.
Reset the guard in setup and retain cleanup invalidation. The real AskMarketing
browser request is the regression, with no timing/retry relaxation.

## Unavailable stored revision

Review found that revisionDto catches malformed/hash-invalid stored payloads and
returns state UNAVAILABLE with payload null, while the owner canWrite flag still
allows lifecycle actions. The Edit handler directly dereferenced payload.content.
Existing browser fixtures contained only valid revisions and missed this crash.
Disable Edit when the current revision is not READY or lacks its content reference;
retain the existing unavailable explanation and safe archive action. A browser
regression corrupts an isolated stored revision, then verifies the actual API/UI
unavailable state, disabled editing and retained readable history.
