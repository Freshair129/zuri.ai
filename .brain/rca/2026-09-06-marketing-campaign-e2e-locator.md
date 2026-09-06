# Marketing Campaign e2e label locator RCA

## Symptom

The integrated Campaign browser tests timed out at several form controls even
though the page rendered correctly: first at the Campaign form, then at the
Strategy decision and PM handoff controls.

## Evidence

- Playwright captured the rendered controls while the failed locator waited for
  an exact label match.
- The shared `Field` primitive wraps hints inside labels, and its select labels
  also contain option text in the accessible name. The affected controls were
  Success metric intent, Budget, Currency, Decision, Approval expires, and
  Target Workspace.
- Existing Strategy browser coverage uses non-exact label matching for these
  controls.

## Root Cause

The Campaign e2e helper used `{ exact: true }` for labels whose accessible name
also contains a hint or select options. Playwright therefore waited for an
exact name that could not exist, and the failure looked like a stalled form.

## Why the issue escaped detection

The unit contract checked source labels but did not exercise browser accessible
names. The first integrated run was the first path through the new Campaign
form against the real DOM.

## Proposed prevention

Use exact accessible labels only when the shared field has no hint; use a
stable base label for hinted fields. Keep at least one real browser create
flow for each new form and retain screenshots on timeout.
