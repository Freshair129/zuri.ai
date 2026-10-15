---
id: ZAI:CONTROL-ACCESS-RESPONSE-20261015
version: "0.1.0"
status: approved
---

# Platform Control login and forbidden response

## Approval and scope

The owner explicitly requested on 2026-10-15 that `/control/roadmap` direct an
unauthenticated visitor to Login and never disguise a signed-in account's
missing permission as 404. Root adopts this correction to FR-105/FR-046 and
ADR-048's response presentation under that instruction. Operator authority,
session verification and protected data remain unchanged. The member-window
renewal was stopped before implementation; its branch-only issued FR-287 is
preserved at local commit `158feeec` and must not be reused.

## Contract

- No authenticated session: existing server redirect to `/login`.
- Session store unavailable: existing retry state; no credential error.
- Authenticated but not Operator: a clear forbidden response with a Login or
  change-account link and a route to return home; no control shell or data.
- Next 14's server-component navigation cannot set an arbitrary 403 status.
  The control guard redirects to a dedicated, generic `/access-denied` route
  handler whose actual final HTTP response is **403**, with `X-Robots-Tag:
  noindex, nofollow`, an HTML robots tag and `Cache-Control: private, no-store`.
  This is explicitly a redirect followed by 403, not a claim that the first
  redirect response itself is 403. The handler never trusts a query URL or
  reflects account data. There is no automatic redirect from the denied page
  to Login, so an account with insufficient rights cannot enter a login loop.
- The Login page permits signing in with another account through its existing
  flow. No automatic logout, new privilege, expiry extension or return URL is
  introduced. Operator sessions still pass the original guard.

## Acceptance

1. Unit tests distinguish missing session, actual auth failure, store outage,
   forbidden account and Operator admission; no child control content renders
   for an unadmitted state.
2. The dedicated denial handler returns 403 and privacy/robots headers, clear
   Thai copy and working local links. Supplied URLs/markup cannot be reflected
   into HTML, cause open redirects or change its status.
3. The existing browser test's authenticated non-operator control visit expects
   the denial destination and final 403. The expired member window is separate
   and is not reopened by this repair.
4. Exact-source independent verify/review, focused tests, governance/build and
   applicable exact-head CI gate merge. Local Docker verification is separate;
   preserve its database and prior image, with no production/Supabase changes.

## Verification boundary and follow-up

Independent source review confirmed that App Router soft-navigation/session or
grant-revocation behavior belongs to the pre-existing shared-layout design at
the base revision. This response-only change neither introduces nor validates
that behavior. It is a separate request-boundary audit hypothesis, not a proven
exploit or a completed revocation test. Fresh protected-route Login/403 behavior
is the acceptance scope here. Direct visits to the generic `/access-denied`
handler always receive its data-free 403, including anonymous visits.

## Version diff

0.0.0 → 0.1.0: adopts explicit Login/403 semantics on the owner's instruction;
retains all authorization and redaction predicates.
