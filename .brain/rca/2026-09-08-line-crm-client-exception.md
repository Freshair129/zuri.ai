---
version: "0.1.2b"
created_at: "2026-09-08T13:43:29+07:00,RWANG,798d89ed"
last_update: "2026-09-08T15:03:31+07:00,RWANG"
status: "beta"
superseded_by: null
attributes:
  domain: "crm"
  surface: "line-oa-studio"
  scope: "Live CRM initial render exception"
---

# RCA: Live CRM initial render exception

## Symptom

The operator reported a browser-side application exception and supplied
`https://unspirited-expostulatory-angila.ngrok-free.dev/overview`, identifying
the LINE OA domain. The exact failing navigation and first browser stack trace
have not yet been captured from the authenticated operator session.

## Evidence

- The running `zuri-ai-web-1` image revision label identifies
  `798d89ed3ac0033cc2fc41a713e2bd13bce36076`. Diagnosis used that exact Git revision.
- Local and public `/api/health` probes returned `status: ok`, `db: ok`.
  A fresh browser passed the ngrok warning and reached the login form without
  a reported JavaScript exception. This does not verify authenticated routes.
- At this revision, `LineStudioLiveCrm.jsx` defaults to its chat subtab and renders
  `LineCrmLiveChat`. That component references `MessageSquare` at lines 255 and
  315, but its lucide-react import at lines 4-23 does not bind that identifier.
- Rendering the actual deployed component with React DOM server, real React and
  lucide ESM icons, and read-only doubles for ScopeContext/useFetch reproduced:
  `ReferenceError: MessageSquare is not defined`.
- The diagnostic used an empty conversation result and called no API, database,
  webhook, or LINE provider. This is also the component's initial state before
  its fetch returns.
- Repeating the same render with only `MessageSquare` added to the import in an
  in-memory source copy succeeded and included the empty-inbox message.
  No application source file was modified by this experiment.

## Root Cause

**Confirmed for the Live CRM empty/initial render:** an unbound JSX component
identifier throws during React rendering. Importing an icon in the parent
`LineStudioLiveCrm` module does not bind it in `LineCrmLiveChat`.

**Not yet confirmed for the operator's reported `/overview` incident:** the
operator's authenticated console trace is pending. Do not describe the Live CRM
reproduction as proof that Overview itself fails, or that every reported error
has this cause.

## Why the issue escaped detection

The referenced `fr151-line-oa-rich-menu-console.spec.js` exercises account setup
and Rich Menu authoring, not the Live CRM empty-inbox render. A successful build
does not prove that every runtime JSX identifier is bound on every render path.
The precise historical CI outcome for the introducing commit was not audited.

## Proposed correction and prevention

Complexity: **C-2** (documented correction plus rendering regression test).
Risk: **LOW** (isolated UI import; no API/schema/RBAC change).

1. Add `MessageSquare` to the existing lucide-react import in
   `apps/server/src/modules/line-crm/LineCrmLiveChat.jsx`.
2. Add `tests/unit/line-crm-live-chat-render.test.js` using the existing
   React DOM render-test convention. Exercise the initial loading state and
   a completed empty inbox with context/data doubles and real icons. Require
   actual rendered empty-state content and no render exception.
3. Run the regression against the original source first (must fail), then the
   corrected source (must pass). Run the production build and governance checks.
4. Confirm navigation to `/line-oa/live-crm` in an isolated browser environment
   without sending messages. Match the operator console trace before claiming
   resolution of the reported incident. Deployment requires a separate release
   decision and verified release evidence.

## Parent and peer alignment

- `docs/domains/line-oa-studio/CHARTER.md`: LINE OA Studio owns the console surface.
- `docs/domains/crm/features/FR-091-conversation-inbox.md`: CRM owns conversation
  visibility. The correction only restores rendering; it changes no scope policy.
- Existing FR-093 delivery behavior is unaffected by the proposed import.
- `platform-users-page-render.test.js` establishes a real component render test
  as protection against failures invisible to source-string assertions.

## Acceptance and exit criteria

- Both initial loading and completed empty-inbox states render without throwing.
- The regression demonstrably fails on the original deployed source.
- Build and governance results are recorded separately from browser/deploy results.
- An authenticated reproduction or operator console trace closes the remaining
  uncertainty about the originally reported navigation.

## Current state and version diff

The operator approved the import correction and regression test on 2026-09-08.
Version `0.1.0b` to `0.1.1b` records implementation and verification:

- Added the missing icon import and test annotation; no other application behavior
  was changed.
- `npm test -- tests/unit/line-crm-live-chat-render.test.js`: original source
  failed both cases with `MessageSquare is not defined`; corrected source passed
  both cases. Tests use the existing ScopeProvider factory and real lucide icons.
- `npm run build`: passed, including compilation, type/lint stage, and static pages.
- `npm run govern`: passed after adding the regression test (zero critical
  findings, zero warnings, zero dangling edges); generated views are included.
- Isolated authenticated browser: login, Business selection, and Overview rendered;
  direct `/line-oa/live-crm` rendered both empty states with zero `pageerror` events.
- The first browser attempt used `next start` with SQLite and was rejected by the
  existing `PRODUCTION_DATABASE_URL_REQUIRED` guard. The successful browser render
  used the repository's dev-mode SQLite testing topology; the guard was unchanged.
- Browser testing also exposed an existing HTTP 400 from `/api/crm/conversations`
  and a separate Dashboard exception on `groups`. Therefore full console behavior
  was not fixed by this import alone. The operator then approved both follow-up
  corrections; the full Overview -> Dashboard -> Live CRM flow now passes locally
  with an inbox HTTP 200 and zero browser errors. See the
  [follow-up RCA and results](2026-09-08-line-studio-dashboard-and-inbox-scope.md).
- Browser evidence is in ignored `apps/server/test-results/`: `live-crm-fixed.png`,
  `line-dashboard-groups-error.png`, and `line-crm-browser-evidence.json`.

The correction is isolated on `codex/line-crm-client-exception`, based on deployed
revision `798d89ed`. No production deployment or LINE transport change was made.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---------|------|--------|---------|-------------|-------|
| 0.1.0b | 2026-09-08 | candidate | Reproduced initial Live CRM render failure; proposed import and regression test; original incident correlation pending | 798d89ed (baseline) | RWANG |
| 0.1.1b | 2026-09-08 | beta | Approved import correction; red/green render tests and build passed; browser exposed separate Dashboard and scope defects | working-tree | RWANG |
| 0.1.2b | 2026-09-08 | beta | Linked the approved follow-up corrections and successful local navigation verification | working-tree | RWANG |
