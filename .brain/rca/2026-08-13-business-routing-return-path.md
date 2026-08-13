# RCA — Missing return path to Business Routing

**Date:** 2026-08-13
**Scope:** BusinessShell topbar, breadcrumb, and FR-044 Business Routing boundary

## Symptom

After selecting a Business, the final BusinessShell had no visible way to return to
the Business selection page. A user had to know or type `/businesses` directly.

## Evidence

- `src/components/layouts/Topbar.jsx` rendered each Workspace/Organization/Business
  context level as a non-interactive `<span>` and had no `/businesses` link.
- `src/components/layouts/Breadcrumb.jsx` used `href: '/'` for the Business crumb,
  which returned to Landing rather than Business Routing.
- FR-044/ADR-015 define `/businesses` as the pre-shell Business selector, but the
  browser proof only covered entering it, not returning to it from a ready shell.

## Root Cause

The entry boundary was implemented as a one-way transition. The shell guard handled
redirects into Business Routing when context was missing, but the ready shell had no
explicit navigation affordance back to that boundary.

## Why the issue escaped detection

Existing tests proved `/login` → `/businesses` → `/overview` and removed dropdowns,
but did not assert a return action from `/overview` or the target of the Business
breadcrumb.

## Implemented prevention

The BusinessShell now exposes exactly one `Change Business` link by making the
Business value in the top context bar navigate to `/businesses`. The breadcrumb is
read-only. Unit and FR-044 browser tests assert the single affordance and destination
while preserving the no-dropdown rule.
