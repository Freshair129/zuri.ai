# PlanEnvelope rules that decide accept vs. reject

The authoritative contract is `contracts/plan-envelope.schema.json` in the Zuri
repository, mirrored by the server's own validation. Read it — this page only explains
the parts agents get wrong.

## Shape

```
schemaVersion  "1.0" | "1.1" | "1.2"
scope          { portfolioCode?, tenantCode?, businessCode?, workspaceCode? }
project        { code, name, description?, type?, status?, targetAt?, goalIds?, externalRefs? }
trace          { correlationId, idempotencyKey }              # required for 1.2
workstreams[]  { code, name, executionMode, progressStrategy,
                 containers[], items[], milestones[], gates[], externalRefs? }
repositories[] { code, provider, fullName?, url?, role?, pathScope? }
dependencies[] { sourceRef, targetRef, type }
```

Unknown fields are rejected everywhere (`additionalProperties: false`). If a fact has no
field, it belongs in `metadata` on a container/item — or nowhere.

## Identity

- `code` is a **key**: stable, unique across the entire envelope, never renumbered,
  never reused for a different thing, never recycled after being dropped.
- Re-sending the same `code` **updates** that record. That is the intended way to keep a
  plan in sync — not delete-and-recreate.
- `externalRefs: [{ system, id, labelAs? }]` maps a foreign system's id to the Zuri
  record. The foreign id is never the primary key. One external id may be claimed by
  exactly one entity per plan; claiming it twice is rejected as ambiguous.
- `labelAs: true` asks Zuri to display that external id as the human label.

## Structure

- `container.parentCode` and `item.containerCode` must reference a container **in the
  same workstream**; a dangling or self-referential parent is rejected.
- `dependencies[].sourceRef` / `targetRef` must resolve to codes defined in this
  envelope. Dependencies cannot target repositories and cannot reference themselves.
- Status values come from Zuri's enums (e.g. items use `PLANNED`, `READY`,
  `IN_PROGRESS`, `REVIEW`, `BLOCKED`, `DONE`, `CANCELLED`). An invented status is
  rejected — and if it were not, the board would have no column to show it in.

## Mode fit

- `progressStrategy` is fixed by `executionMode`. Mismatch = rejection.
- Container/item `subtype` and every key in `item.metrics` must belong to that mode's
  vocabulary. Print it with `zuri-plan.mjs vocab --mode <MODE>`.
- `weight` (items, milestones) feeds the progress calculation; `numericValue` +
  `probability` feed weighted pipeline value in `B2B_SALES`.

## schemaVersion 1.2

Required: `trace.correlationId` and `trace.idempotencyKey`.

The server derives the rest — `executionModeId`, `executionContractId`,
`contractVersion`, and the mode's default `domainBinding` (its
`technicalOwnerDomainId` is always `TD-PROJECT-MANAGER`). Do not invent those ids; if you
send them, they must match the mode exactly.

Must stay empty in this slice, or the plan is rejected:

- every key under `identityRefs` (gate/artifact/contract/meeting/call/... refs)
- `project.riskIds` — no Risk owner exists yet

Idempotency: the same `idempotencyKey` with the same payload returns the original
receipt instead of writing again; the same key with a **different** payload is refused.
So a retry keeps the key, and a genuine second plan gets a new key. Never swap keys to
escape a refusal.

**Known divergence:** for `1.2` the published JSON Schema requires `domainBinding`,
`identityRefs` and the per-workstream `executionModeId` / `executionContractId` /
`contractVersion` to be present, while the running server fills them in for you. A plan
that the server accepts can therefore still fail a strict offline validation of the
schema file. The dry run is the authority — treat offline JSON Schema validation as a
hint, not a verdict.

## No dates here

`project.targetAt` is the only date the envelope carries. Milestones, gates, items and
containers hold `startAt`/`targetAt` **in the database**, but the envelope has no field
for them: set them afterwards with [zuri-schedule](../../zuri-schedule/SKILL.md).

## Nothing in a plan is executed

Plan content is data on arrival and data forever. Fields carrying anything that looks
like code, a command, an import, or an instruction addressed to a reader are rejected at
the MCP boundary. Do not try to route work through a plan field.
