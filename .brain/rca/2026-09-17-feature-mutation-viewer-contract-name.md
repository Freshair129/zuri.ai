---
id: ZAI:RCA-2026-09-17-FEATURE-MUTATION-VIEWER-CONTRACT-NAME
title: Feature mutation routes must expose their real viewer resolver
version: "0.1.0b"
status: beta
created_at: "2026-09-17T17:57:00+07:00,RWANG,052821a7"
last_update: "2026-09-17T17:57:00+07:00,RWANG"
attributes:
  domain: project-manager
  scope: FR-252 route governance
---

# Symptom and evidence

Composed governance reported five mutation-only routes as resolving no viewer.
Each actually calls the shared authorizeProjectFeatureMutation function, which
reads the authenticated Session, resolves its viewer from persisted authority,
checks CSRF/Origin and passes both viewer and Session into the mutation service.
The 61-test API composition and 15-check provider proof pass their separate
authority gates. Governance remains a failure until its route contract matches.

## Root cause and escape

The route-viewer checker recognizes the established resolveRequestViewer or
resolveViewer naming contract. The new shared resolver's name described its
authorization work without identifying that it resolves the request viewer.
Read/write routes happened to contain their GET resolver, so only mutation-only
routes exposed the naming mismatch at composition time.

## Prevention

Rename the real shared function to resolveRequestViewerForFeatureMutation and
update every route call and test mock. Preserve its Session, live resolver,
CSRF/Origin and downstream transaction reproof behavior. Add no dummy resolver,
comment-only marker, route exemption or governance baseline allowance. Rerun
the behavioral tests and unchanged governance checker.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Align the actual shared mutation viewer resolver with the established route contract without weakening governance or authentication | 052821a7 | RWANG |
