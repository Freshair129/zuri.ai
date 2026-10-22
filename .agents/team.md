---
status: active
superseded_by: null
version: "0.4.0"
---

# Developer team responsibilities

Assign responsibilities based on the current user task, applicable repository
instructions, and the scoped verification policy. The developer-only DDC
controller and task preflight were retired by
[ADR-113](../docs/decisions/ADR-113-RETIRE-DEVELOPER-DELIVERY-CONTROL.md).
Sol owns in-scope decisions, critical debugging, integration and delivery.
Exploration, implementation, verification and review may use separate sessions
when useful; this roster does not require a controller or durable task ledger.

| Stable role | Responsibility | Policy assignment |
|---|---|---|
| `dev-lead` | Derive task scope from the user request and applicable sources; inspect dependencies and risks | Sol root/orchestration |
| `dev-doc-writer` | Draft and reconcile documentation, diagrams and evidence | Doc Writer skill and native adapters; worker session when delegated |
| `dev-implementer` | Implement the scoped change in the assigned checkout or worktree | Worker session |
| `dev-reviewer` | Independently review meaning, contracts, diff and evidence | Separate reviewer session for substantive changes |
| `dev-verifier` | Execute relevant checks and report exact revision and results | Separate verifier session when delegated |
| `dev-integrator` | Compose accepted sources, regenerate outputs and validate the combined result | Sol root integration; serialize shared-source generation |

Persona, domain expertise and role identity remain separate. Only Doc Writer has
a custom-agent role card, skill and native adapters in this package. The root
selects suitable sessions; no additional task packet or DDC preflight is
required.

## Delivery handoff

1. Root reads current Git state, repository instructions, and the applicable
   product/architecture sources, then records the objective, acceptance and
   changed-path scope in the working task context.
2. The implementer makes the scoped change and reports changed paths, checks,
   results and remaining gaps.
3. Run change-relevant verification from
   [VERIFICATION-POLICY.md](../docs/architecture/VERIFICATION-POLICY.md).
   Substantive changes receive an independent review against the same patch.
4. Sol integrates source edits and generated outputs, checks the exact diff,
   required tests and hosted CI, and records any checks that remain unrun.
5. Commit, push, PR, merge, deployment and release follow the user's scope and
   repository/environment controls. No local readiness result authorizes them.
6. Reconcile roadmap and source-of-truth status with actual delivery evidence.

~~~mermaid
flowchart LR
    T[User task and repository sources] --> S[Scope and acceptance]
    S --> W[Scoped implementation]
    W --> V[Change-relevant verification]
    W --> R[Independent review when substantive]
    V --> I[Integration and exact diff]
    R --> I
    I --> C[Required hosted CI]
    C --> M[Authorized delivery and roadmap closeout]
~~~

The diagram describes a lightweight team procedure, not a shipped controller.
Required hosted CI, applicable tests, independent review for substantive work,
and environment-specific authority remain in force.

## Version diff

0.1.0 to 0.2.0 (2026-10-22): removes DDC task preflight, controller-bound
dispatch, and execution-cycle machinery; retains manual roles, relevant checks,
Git review, and required repository CI.
