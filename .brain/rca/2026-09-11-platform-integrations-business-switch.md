---
version: "0.1.1b"
created_at: "2026-09-11T01:30:00+07:00,RWANG,base 4938b6cb"
last_update: "2026-09-11T01:40:00+07:00,RWANG"
status: beta
superseded_by: null
attributes:
  domain: "integration"
  scope: "Platform Integrations Business-switch lifecycle"
---

# RCA — Platform Integrations retains an earlier Business response

## Scope and evidence boundary

This RCA covers the approved FR-080 Platform Integrations UI reliability fix. It
does not change the metadata API, authorization service, connector catalog
vocabulary, secret manager, LINE transport, or persisted credentials. Browser
verification uses only the isolated seeded fixture and intercepted test
responses; no provider or production write is made.

## Symptom

When a model metadata POST starts for Business A and the operator selects
Business B before that request settles, the form keeps A's provider/name/model/
Vault reference. The existing completion callback then reports A's success,
clears the reference, reloads the current read model and changes the busy state
while B is displayed. The page's shared fetch hook can also commit a delayed A
integration list after B's list has become current.

## Evidence

`apps/server/src/app/(pm)/platform/integrations/page.jsx` previously synchronized
`targetBusinessId` from the shell but had no form reset or request identity. The
`submitModel` closure posted the captured `businessId`, then unconditionally
called `setMessage`, `setSecretRef('')`, `integrations.reload()` and
`setBusy(false)`. The shared `useFetch` implementation intentionally retains
prior data during a new URL request and has no sequence check for a response
that settles after its path/dependency changed.

The regression exercises both interleavings in a real Playwright page. It holds
the A POST, switches through the catalog to B, enters B's own form values,
releases A and waits for the matching browser response plus two animation frames;
the B values remain and no A success is rendered. A second case holds the A
integration GET, fulfills the B GET first, opens B's settings, then releases A;
the delayed A row never appears.

## Root cause

The component treated Business selection as display state while asynchronous
callbacks remained unscoped. A request had no captured Business generation to
compare with the current selection, and the read hook had no local sequence
fence. Therefore a late callback was allowed to mutate state belonging to a
different Business.

## Why the issue escaped detection

The page stays mounted while its Business selector changes, so the initial
`useState` values survive the change. Existing unit tests inspect ownership and
provider contracts but do not mount the page or delay a response across a scope
change. Normal API latency usually completes before an operator switches
Business, hiding the ordering defect.

## Correction and prevention

The page now keeps a monotonically increasing Business scope generation. A
Business change resets the model form and feedback state, including the
write-only Vault reference, and invalidates pending callbacks. `submitModel`
captures the Business and generation before POST and publishes success, clears
the reference, reloads, or reports an error only while that scope is current;
its unmount cleanup invalidates late completions as well.

The page uses a local scoped read hook for its two Business-dependent lists. It
clears data on a scope change and commits a response only when its sequence is
still current. This keeps the generic `useFetch` behavior unchanged for other
surfaces while preventing Platform Integrations data from crossing Businesses.

## Acceptance and validation

- Existing integrations and LINE settings unit contracts pass (22/22).
- The browser regression passes both delayed A POST completion and delayed A
  read completion after B is current (2/2 Chromium tests). The fixture grants
  the seeded owner a real BUS-002 membership in the isolated E2E database and
  removes it in cleanup.
- The server production build passes, including lint and type validation. The
  targeted E2E run used `--no-deps`; the repository's dependency warm-up and
  full E2E gate remain a separate integration check. No production or provider
  evidence is implied.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.1b | 2026-09-11 | beta | Add scoped form/read callback fences and deterministic browser regressions | pending | RWANG |
