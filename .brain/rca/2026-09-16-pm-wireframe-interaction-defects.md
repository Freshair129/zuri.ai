---
version: "0.1.0b"
created_at: "2026-09-16T02:02:42+07:00,RWANG,base 087f3025"
last_update: "2026-09-16T02:02:42+07:00,RWANG"
status: candidate
attributes:
  domain: project-manager
  scope: Local UX wireframe review artifact only
---

# RCA — PM wireframe interaction defects

## Symptom

The initial documentation prototype rendered its screens, but keyboard activation of an SVG architecture node did not open the inspector. API filtering changed the hidden property without visually hiding all excluded operations. Initial form-control choices also needed reconciliation against schema types.

## Evidence

- `inspect-graph-keyboard.cjs` captured `e.target.click is not a function`; the selected SVG group had `typeof click === "undefined"`, and inspector text did not change after Enter.
- `verify-ux-preview.cjs` expected one matching operation after searching dispatchProjectRun; all 72 remained visible. The source set the hidden property while the authored `.oplist button { display:block }` rule overrode the browser's default hidden styling.
- Field enumeration found RiskInput.impact is a string enum (LOW/MEDIUM/HIGH/CRITICAL), dueAt is date-time, and several reference fields are arrays. A check limited to copied constraints did not prove the selected control type matched those constraints.
- The candidate API path/schema inventory exposes Project ReviewInput with six resource kinds, not a Business routing-policy review endpoint. Wiring WF-37 to WF-15 would misrepresent the authority boundary.

Evidence scripts/reports are local review artifacts in `pm-design-qa`; they do not run against application routes.

## Root causes

1. The key handler assumed an SVG group exposed the HTML element click method.
2. Explicit author display styling took precedence over native hidden presentation.
3. The initial form draft selected control types separately from schema constraints; verification checked the binding/constraints but not the compatibility of the control.
4. A proposed navigation action was connected before validating the reviewed resource's scope and operation contract.

## Why these escaped initial detection

The first smoke check captured visual pages and JavaScript errors on load. It did not activate graph nodes by keyboard, check filtered visibility, validate control-type compatibility or inspect the policy review scope. No product regression is inferred.

## Corrections and prevention

- Route Enter/Space through the same bubbling activation event as pointer selection; retain keyboard node/edge inspection checks.
- Explicitly honor hidden attributes; verify the visible result count after filtering.
- Derive scalar enum/date-time/array reference controls from contract semantics; allow fractional numeric values for number fields. Add type-compatibility assertions.
- Keep WF-15 Project-scoped. WF-37 policy inspection remains visible; administration stays unavailable until an owner-approved Business contract is bound.
- Keep the prototype's restrictive CSP. When a Playwright function-poll hit CSP evaluation restrictions, use an explicit focused/collapsed locator for the native dialog close condition. Do not remove CSP or insert arbitrary delays.
- Re-run the artifact interaction suite after fixes; evidence is recorded in [review record](../../docs/architecture/project-manager-system/08-EVIDENCE-AND-REVIEW.md).

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | Local artifact RCA, source-backed causes, corrections and preventive checks | base 087f3025 | RWANG |
