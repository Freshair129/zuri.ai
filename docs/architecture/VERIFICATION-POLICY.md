---
id: ZAI:VERIFICATION-POLICY
status: active
superseded_by: null
version: "0.1.0"
relations:
  - type: relates_to
    target: ZAI:ADR-025
  - type: relates_to
    target: ZAI:ADR-062
  - type: relates_to
    target: ZAI:ADR-106
---

# Monorepo documentation and verification policy

The owner approved the monorepo documentation proposal on 2026-10-06. Domains
remain the business-ownership spine. Services describe process, contract,
installation, build and test boundaries. One service may host several domains;
an extracted process does not automatically own every model it uses.

```mermaid
flowchart TD
  P[Product intent and ADRs] --> D[Domain charters: business ownership]
  D --> R[Canonical FR and FEAT records]
  D --> S[Service documents: execution boundaries]
  R --> T[Code and test traceability]
  S --> M[Package scripts, contracts and pilot metadata]
  T --> V[Active CI selector and mandatory checks]
  M --> H[Shadow comparison report]
  V --> E[Actual run evidence]
  H --> G[Review before enabling omissions]
  E --> G
```

## One editable authority per fact

| Fact | Source |
|---|---|
| Product intent | PRODUCT and applicable ADRs |
| Business rules and model ownership | Owning domain CHARTER and canonical requirement records |
| Feature membership | Canonical FEAT record; never inferred from directories |
| Design rationale | Domain feature note or ADR |
| Runtime boundary | `docs/services/<project>/SERVICE.md`, citing its extraction decision |
| Test rationale, engines and fixtures | The corresponding `TESTING.md` |
| Executable commands | Package scripts and runner configuration |
| Pilot selection inputs | Conversation Runtime's `verification.json` |
| Observed verification | Exact-revision receipts, distinct from generated test bindings |

Root docs remain canonical. Service READMEs link to them and provide quick-start
instructions. Existing generated feature design/verification views and compatibility
exports remain generated. Brand identity and character persona stay in the brand
kit; runtime skills/configuration do not derive permissions from that kit.

## Current scope and pilot

The existing `scripts/ci-change-scope.mjs` remains the active CI selector. Its
related-test import, annotation, scanner, deletion, fan-out and fallback guards
remain in force. Main pushes retain full Server tests/build. Governance E2E is
scheduled/manual; it is not an ordinary PR check. All three existing service jobs
continue to run on non-scheduled governance events.

The Conversation Runtime pilot is **shadow-only**. `verification:plan` reuses the
active selector and records a candidate plan for a diff confined to Runtime and
its two explicitly listed service documents. No job condition or required-gate
input consumes that candidate. The JSON report is evidence for comparing plans,
not an execution receipt or authority to skip a job.

The pilot requires an actual Runtime code/test/contract change. Documentation-only changes,
deleted/renamed Runtime inputs, unknown paths, metadata/package/config changes,
unavailable references and non-PR events conservatively retain the current plan.
`docs/` and `.md` are not blanket exemptions: document-derived state has runtime
consumers. The narrow doc allowlist covers only SERVICE.md and TESTING.md beside
this pilot. It does not include requirements, charters, policy or generated state.

The candidate keeps global governance, the entire Runtime service job and all
Core tests discovered by the active service-reference contract selector. It would
omit MI/SCM and Server build/full tests only for that bounded diff. Empty or missing
Core contract evidence invalidates the candidate. The scanner's current limitations
remain visible; this first pilot does not certify all HTTP consumer dependencies.

## Pilot metadata contract

`services/conversation-runtime/verification.json` is version 1 and contains only:

| Field | Contract |
|---|---|
| `schemaVersion` | Exact integer 1 |
| `id`, `root` | Exact `conversation-runtime`, `services/conversation-runtime` |
| `mode` | Exact `shadow`; enforcement is also hard-coded by the planner |
| `documents` | Exactly the SERVICE.md and TESTING.md paths for this service |
| `domainRefs` | Existing charter references for navigation, not ownership grants |
| `contract` | Existing `contracts/v1/operation.schema.json` path |
| `tasks` | `test` and `build` package-script names; shell bodies stay in package.json |

Unknown keys, wrong versions/roots/modes, invalid or escaped paths, missing files,
and missing package scripts fail validation. Paths are repository-relative with
forward slashes; references must resolve inside the checkout, including symlinks
and Windows junctions. Metadata is not an arbitrary command runner. Other services
keep their current conservative selector behavior until separately onboarded.

## Reproducible planning

The CLI accepts `--base <commit>` and optional `--head <commit>` with
`--event pull_request|push|schedule|workflow_dispatch|local`. Revision arguments
must resolve to commits and cannot be Git options. It diffs exact revisions using
`--no-renames`; local mode uses the merge base and also includes staged, unstaged
and untracked files. Deleted paths remain in the change set. Missing base/history
is an error, never an empty successful plan.

The report records resolved revisions, changed paths, a digest of changed file
contents/deletions, active selection, candidate selection, reasons and
`mode: shadow`. The local digest is not a receipt proving the whole environment or
all dependency contents were tested. There is no test execution in this CLI.
CI reports use GitHub-provided base/head SHAs through environment variables, never
interpolate user titles or branch names into shell code. The report is always
printed as JSON; the caller controls the output file through ordinary redirection.

## Baseline and verification obligations

Choose a baseline matching the actual change before implementation. For this
approved documentation/verification-control-plane lane, run the existing selector
regression tests and required governance/reader checks in its isolated worktree.
There is no application behavior change requiring a blanket local application
suite solely because the worktree is new. An application, schema, fixture, shared
authority or runtime contract change still needs the appropriate wider baseline.
Never install through a shared node_modules junction or reuse a mutable test DB.

After implementing this pilot, run planner/metadata/CLI tests, existing selector
regressions, Runtime tests/build, relevant Core contract tests, generated-map
freshness and repository governance. Hosted CI retains its existing checks. Zero
tests, flaky retries, missing required jobs and cancelled jobs retain their current
failure semantics. A local scoped PASS does not mean all suites or hosted CI passed.

## Adoption gate

Before enabling omissions, compare the shadow plan with full/checking runs for:
Runtime-only, Runtime-plus-inert-doc, canonical-doc, contract, Core authority,
SCM generator source, shared config, renamed/deleted file, new service, unknown
path, missing base and empty/missing consumer cases. Check the provider and all
known consumers, including non-import edges; schema/reader changes expand scope.

SCM's Server-to-kernel generation and cross-domain transaction edges must be
registered before extending this pilot to SCM. Do not create HTTP writes or split
atomic transactions just to narrow tests. Keep independent package lockfiles and
the existing npm toolchain; no Nx migration, remote cache or new test-result cache
is included.

The aggregate gate must accept an omitted job only when a successful trusted plan
explicitly marks it unaffected. No activation switch exists in this increment.
Review the comparison evidence and update the governed policy and gate together
before introducing one. The main/release full safety net remains.

Measure elapsed feedback, summed job durations, queue/install/build/test time and
cold/warm runs separately. The reported older 60+ minute CI run remains unidentified;
this policy does not claim to diagnose it or deliver a measured speedup.

## Navigation and version diff

- [Service documentation index](../services/README.md)
- [Generated service map](SERVICE-MAP.md)
- [Pilot implementation and verification record](../migrations/scoped-verification/PILOT.md)

0.0 → 0.1.0: adopts the approved service-documentation layer and bounded Runtime
shadow pilot. Existing CI selection and deployment/data authority remain active.
