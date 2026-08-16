# ADR-001 — Build Standalone Before Integrating with Zuri

**Status:** Accepted  
**Date:** 2026-08-11

## Context

Current Zuri is already a multi-module application. Its dashboard layout is centered on
a TenantProvider and its module navigation is registered in a central modules config.

The Project Manager introduces deeper domain changes:

```text
Portfolio / Business Group
Tenant
Business
Workspace
Project
```

It also introduces mixed execution modes and a neutral execution model.

Changing these foundations directly inside the current Zuri repository would mix:
- product redesign
- tenant semantic changes
- database migration
- UI navigation changes
- Project Manager implementation

into one refactor.

## Decision

Build a separate `zuri-v2-lab` application first.

Project Manager is its first module.

The existing Zuri application is a compatibility target, not a codebase to mutate.

## Why

Benefits:
- no production regression
- clean data-model experiments
- local/offline iteration
- easier destructive schema changes
- independent acceptance testing
- clear comparison with Zuri v1
- enables a real Zuri v2 decision later

## Integration decision point

After MVP and dogfooding:

### Merge into Zuri v1 if

- Workspace remains Project-Manager-only
- Business/Portfolio hierarchy does not need to become global
- existing Tenant model remains sufficient for CRM/POS/etc.
- integration changes are small and backwards compatible

### Promote to Zuri v2 if

- Portfolio / Business / Workspace becomes a global application context
- CRM, POS, Marketing, Inbox, Employees, etc. must all become workspace/business aware
- Tenant meaning changes materially
- navigation, permissions, or data ownership need a new root model

Current expectation:

> Zuri v2 is more likely if Workspace + Business hierarchy becomes cross-module.
