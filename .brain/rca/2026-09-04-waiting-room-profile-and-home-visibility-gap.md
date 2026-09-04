---
version: "0.2.0b"
created_at: "2026-09-04T09:39:36+07:00,RWANG"
last_update: "2026-09-04T09:39:36+07:00,RWANG"
status: "beta"
superseded_by: null
attributes:
  domain: "identity"
  doc_type: "root-cause-analysis"
  scope: "Waiting Room omits the current person's profile summary and has no path back to the public Home surface"
---

# RCA — Waiting Room profile and Home visibility gap

## Symptom

An authenticated person who completes Profile and reaches `/waiting-room` can see
invitations, joined Workspaces and the Workspace-creation form, but cannot confirm
which profile is waiting and has no visible action back to the public Home route.

## Evidence

1. `getOnboardingState` already selects and returns the current person's
   `displayName`, `email`, `firstName`, `lastName` and `phone` under `profile`.
2. `/api/onboarding/state` derives `personId` from the trusted session and passes it
   to that service; the response is already current-person scoped.
3. `src/app/(entry)/waiting-room/page.jsx` reads only `profile.complete`. It renders
   no other `data.profile` field.
4. The page imports `Link`, but every rendered link targets Workspace Home or
   Business Routing. No link targets `/`.
5. Existing service/integration tests prove profile data, invite scoping and the
   grants-nothing boundary. No page contract or E2E assertion requires a visible
   profile summary or Home action.

## Root Cause

FR-066 defined Waiting Room primarily as an authorization-safe resting state. Its
acceptance criteria required current-person invitations and Workspaces but did not
require the already-available current-person profile to be rendered or require a
navigation escape to the public Home surface. Implementation and tests followed
that narrower contract exactly.

The defect is therefore presentation-contract incompleteness, not missing identity
data, an API failure or a schema gap.

## Why the issue escaped detection

1. Tests focused on server-side scoping and onboarding transitions rather than the
   rendered Waiting Room content.
2. The subtitle says the profile is ready, which made the page appear to acknowledge
   identity while showing none of it.
3. Route-reachability checks prove `/waiting-room` exists; they do not prove the page
   offers a safe way out.
4. No E2E test completed Profile and asserted the final Waiting Room experience.

## Proposed prevention

1. Extend FR-066 with explicit current-person profile-summary and Home-navigation
   acceptance criteria.
2. Render only fields already returned by the trusted onboarding state; do not add a
   people directory or reveal other waiting users.
3. Use an initials avatar derived from the current profile. A stored profile-image
   upload is a separate feature and is not implied.
4. Add a page contract test and an E2E journey that prove the profile summary and
   `/` Home link remain visible.

## Current containment

- The omission leaks no data and widens no authority.
- The existing API already scopes the response to the session principal.
- The repair requires no database migration or new route.

## Approval and remediation status

The owner approved the remediation on 2026-09-04. Documentation, RED tests and the
surgical Waiting Room UI repair may proceed together with CR-017.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-04 | draft | Recorded the presentation-contract gap and prevention | working-tree | RWANG |
| 0.2.0b | 2026-09-04 | beta | Owner approved the documented remediation | working-tree | RWANG |
