# FR-053 W1 task brief — golden evaluation

Implement only the golden-question contract, evaluator and focused tests under FR-053/SDD-027.
Own `contracts/phase1-activation/golden-questions.schema.json`,
`contracts/phase1-activation/smartgift-golden-questions.json`,
`src/modules/agent/golden-evaluation.js`, `scripts/evaluate-phase1-golden.mjs` and
`tests/unit/golden-evaluation.test.js`. Do not edit shared indexes or `package.json`.

Exit: AC-053-01..05 pass with injected fake ports; real-provider state remains `NOT_RUN`; no secret,
PII, cost, margin or invoice field enters fixtures/reports.
