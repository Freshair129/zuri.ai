---
record_type: owner-approval-handoff
version: "0.1.1b"
status: approved-design-pending-integration
recorded_on: "2026-09-18"
timezone: Asia/Bangkok
approval_source: "Owner message: approve, following the twelve-document v0.1.0b review packet"
reviewed_main_commit: cfd5521e7d004e63ffead1e07f46045f1cdc06f2
canonical_id_allocation: pending
repository_governance: not-run
runtime_implementation: not-started
production_activation: not-performed
---

# Self-hosted inference pool — owner approval and integration handoff

## Decision recorded

The owner replied `approve` after reviewing the twelve-document Zuri Inference Pool Documentation v0.1.0b packet. Record that design as approved. The approval revision is v0.1.1b: metadata, approval status and CHANGELOG additions only; the technical design bodies remain unchanged.

This is a transcription of the owner's conversation instruction, not a cryptographic owner signature, GitHub review, successful test receipt or deployment receipt.

**This draft PR records approval only. It does not contain or integrate the twelve canonical document sources, allocate global IDs, or modify the requirement registries.** The complete approved source packet is delivered in the owner's conversation. Obtain that packet and verify its hash before continuing; this report is not a substitute requirement source.

## Exact reviewed and approval-revision artifacts

| Artifact | SHA-256 |
|---|---|
| `Zuri_Inference_Pool_Documentation_v0.1.0b.zip` — owner-reviewed candidate | `5d643d5505c04e0483ad3395cc51a2db741f5714dd7365600c97f36bd298feae` |
| `Zuri_Inference_Pool_Documentation_v0.1.1b_APPROVED.zip` — recorded approval revision | `021d742bf02e036db98c60579c8153bf2d9769199dbf7c9b9ba4c8a75c105b14` |

The approval revision contains `review/APPROVAL-RECORD.json`, with the source and revised SHA-256 for each of the twelve documents, and `review/FILE-MANIFEST.json`. Neither archive is claimed to be stored in this repository by this PR.

## Approved design scope

Use `LINE -> existing Zuri Server admission/worker -> Server agent and capacity router -> independent vLLM A/B -> existing Server delivery`. The 12 GB and 16 GB machines each hold a full model replica and their own KV cache; no VRAM aggregation or distributed model is introduced.

Server retains business authorization, tools, context composition, the durable LINE job queue, delivery fencing and CRM recording. Integration manages approved node endpoints and credential references; Agent owns runtime routing and capacity reservations; LINE OA Studio owns account policy and inference cutover; Platform Control owns a removable operator projection. MSP and GKS retain their existing authorities.

The approved packet includes enrollment and credential/model qualification, an explicit self-hosted processing policy, atomic per-engine capacity leases, fresh/unknown observation semantics, deadline-aware spillover, uncertain-attempt handling, an operations view, and qualification/recovery/rollback gates. It preserves existing `LOCAL_ONLY`, optional Edge capabilities and the single LINE sender. No implicit cloud fallback, Edge deletion, GPU-to-database superuser access, or automatic infrastructure restart is authorized by the design.

## Packet contents and intended canonical destinations

| Kind | Count | Intended destination after ID reconciliation |
|---|---:|---|
| Architecture decision | 1 | `docs/decisions/` |
| Functional requirement notes | 5 | `docs/domains/{integration,agent,line-oa-studio,platform-control}/features/` |
| Execution handoff phase notes | 3 | Owning domain `features/` directories |
| Domain-owned delivery plan | 1 | `docs/roadmap/` |
| Qualification and recovery runbook | 1 | `docs/runbooks/` |
| Verification matrix | 1 | `docs/domains/agent/` |

Source files retain `.md.template` and thirteen unallocated identifier slots: one ADR, one FEAT, five FR, two SEC, two SDD and two NFR. The placeholders indicate unfinished canonical registration, not withheld design approval.

## Why canonical registration is still pending

The GitHub connector re-read `main` at `cfd5521e7d004e63ffead1e07f46045f1cdc06f2`, matching the review baseline. A complete checkout could not be obtained in the working container: Git access failed with `Could not resolve host: github.com`. Repository-wide generation and the sanctioned ID writer therefore did not run.

Published registry tails are not a safe allocation authority by themselves. The visible open [PR #450](https://github.com/Freshair129/zuri.ai/pull/450), head `2bd61b495cd9186acdab02a3312487e6131b7a39`, reports that the Knowledge Console already uses `FR-254`. This is a concrete parallel-lane conflict to avoid, not proof that every active branch has been inspected. Do not preassign replacement numbers from this report.

Follow [AGENTS sections 18–19](../../AGENTS.md) and the [document-link metadata contract](../../docs/GOVERNANCE-LINK-METADATA.md). No manual ID-ledger edits or generated graph edits were made to bypass those gates.

## Required continuation before this becomes a canonical documentation change

1. Use a separate worktree. Re-read current main, active lanes, the full registries, `docs/.id-ledger.json`, and affected charters. Preserve existing published subjects and other branches' additions.
2. Verify the approved archive hash. Use its `handoff/APPLY-TO-ZURI.md` and renderer to bind reviewed unused IDs in a new staging directory. The renderer does not reserve IDs.
3. Compose the twelve sources into their canonical destinations, add the approved source rows to the existing PRD/FEATURES registries, reconcile roadmap work and charter prose, and amend only the affected existing architecture/provider restrictions. Do not claim planned Prisma models in `owns_models` before they exist.
4. Run `npm run docs:ids -- --write` using the repository's sanctioned writer, then `npm run govern` and the applicable verification checks. Commit only outputs required by the current repository policy. Keep all substantive design changes reviewable.
5. Record exact results and remaining gaps. Keep implementation and hardware/LINE activation separate; never mark a case passed merely because its test plan exists.

## Evidence status

| Gate | Result |
|---|---|
| Owner design approval | Recorded from the conversation |
| Twelve source-body preservation checks | Passed in approval-packet revision |
| Twelve metadata/schema checks | Passed with isolated placeholder substitutions; not canonical-ID validation |
| Renderer smoke and output-overwrite refusal | Passed using isolated fixture IDs only |
| Runtime acceptance case payload | Unchanged; all 52 cases remain `NOT_RUN` |
| Archive integrity and file-manifest hashes | Verified locally |
| Actual ID reservation and registry composition | Pending |
| `npm run docs:ids -- --write` on repository | Not run |
| `npm run govern` / `npm run verify` on repository | Not run |
| Runtime, schema and migrations | Not changed |
| Real GPU/LINE qualification, secrets and production deployment | Not performed |

Do not merge this as evidence that the inference-pool feature is implemented or its documentation fully integrated. It preserves the owner's approval and the exact handoff state so a later integrator can finish without inventing completion.

## CHANGELOG

| Version | Date | Summary |
|---|---|---|
| 0.1.1b | 2026-09-18 | Record owner approval of the unchanged twelve-document design; bind artifact hashes; explicitly retain ID, governance, runtime and activation gaps. |
