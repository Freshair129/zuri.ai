---
feature: FR-053
module: agent
source: v2-native
version: "0.2.0b"
created_at: "2026-08-14T07:58:02+07:00,ATHER"
last_update: "2026-08-14T08:20:18+07:00,ATHER"
status: "beta"
---

# FR-053 — Phase 1 golden question evaluation

## Rationale

Unit tests cannot establish that an approved provider answers the approved business questions from
the approved evidence. Phase 1 therefore needs a versioned corpus and evaluator that can run with
injected fake ports in CI and, later, with an environment-provided real credential. A result is a
redacted evaluation artifact, not permission to activate LINE.

## Boundary

- minimum 20 unique cases;
- expected registered query, evidence codes, allowed numeric claims and policy outcome;
- deterministic 20/20 pass gate with zero unsupported numbers;
- no PII, cost, margin, invoice or secret material;
- real-provider execution remains an external activation step.

## Delivery state

The versioned 20-case placeholder corpus, deterministic evaluator, redacted report and tracked CLI
are implemented. Injected fake ports pass 20/20 with zero unsupported numeric claims. The corpus is
not yet an owner-approved mapping to the production 74-row artifact, and no approved provider
credential has been exercised; real-provider evaluation remains `NOT_RUN`.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Owner-approved evaluation contract | working-tree | ATHER |
| 0.2.0b | 2026-08-14 | beta | Evaluator and placeholder corpus implemented; fake 20/20 passes, real provider remains NOT_RUN | working-tree | ATHER |
