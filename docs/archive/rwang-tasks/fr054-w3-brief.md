# FR-054 W3 task brief — canary preflight

Implement only the dry-run canary contract, preflight, runbook and focused tests under
FR-054/BR-013. Own `contracts/phase1-activation/canary-plan.schema.json`,
`src/modules/agent/canary-preflight.js`, `scripts/plan-line-canary.mjs`,
`tests/unit/line-canary-preflight.test.js` and `docs/runbooks/LINE-PHASE1-CANARY.md`. Do not edit
shared indexes, `package.json`, binding data or LINE adapters.

Exit: AC-054-03..06 pass; default/result is dry-run; no code path updates a binding or calls LINE;
receipt states and rollback-first instructions are explicit.
