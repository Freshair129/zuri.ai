---
id: ZAI:GIT-WORKTREE-POLICY
status: active
superseded_by: null
version: "0.1.0"
relations:
  - type: references
    target: ZAI:ADR-113
  - type: relates_to
    target: ZAI:VERIFICATION-POLICY
---
# Git and worktree lifecycle policy

This portable policy implements workspace lifecycle guidance under ADR-113's existing Git review and repository CI procedure. It adds no DDC task records, `delivery:*` commands, controller receipts, admissions, replacement ledger, supervisor or registry service. Business Project Manager/product approval and document governance remain separate systems. Read only the sections needed for the operation; Codex users may also consult their global lifecycle policy.

## Reuse, writer ownership and session memory

Inspect repository/common-dir identity, branch/HEAD, remotes, upstream, staged/unstaged/untracked changes and existing worktrees before writes. Default to the assigned worktree or existing checkout; reuse a suitable owned branch. A new task/chat/subagent is not a worktree allocation reason. Allocate only for real concurrent writes, destructive tests, incompatible builds/dependencies or environment isolation that cannot safely share resources.

One active writer owns each mutable worktree. Establish the current owner through the existing assignment/session and a current handoff. Never take over an active Dot/Codex workspace or switch its branch. Idle/archived/unloaded chats, a clean checkout, merged PRs or no process-search match are insufficient release evidence. Unknown ownership is protected; deliver a scoped patch/handoff instead. Existing Workspace Recovery classifications are not silently changed by this policy.

Read-only subagents may share the checkout. Serialize parent/subagent writer turns, the Integrator's shared generators, registry/graph/view output, lockfiles and Git operations. File boundaries alone do not isolate shared writers. When worker/verifier/reviewer roles are delegated, retain the model/role and independent-review requirements stated in root AGENTS.md; this policy does not change them.

Preserve the root AGENTS.md session-memory convention: locate the primary checkout's newest note by `ended_at`, read the required summary/state/issues/resume sections, and re-verify its claims. Notes are history, not authority to revive retired DDC procedures. Session-close notes are append-only, local-only and never committed. Never write a note or generator output into another session's protected workspace. A patch-only review outside the repository can carry its handoff with the patch; the receiving owner performs repository session steps after ownership is established.

Use existing task/PR/session records to identify owner, path, branch/HEAD, scope, dependencies, dirty/ignored/unpushed work, current checks, remaining UAT/decisions, runtime users and recovery evidence. Handoff needs former-writer release and receiving-owner verification. Do not invent a replacement task controller to record this information.

## Task, PR and dependency lifecycle

Use DISCOVER → REUSE OR ALLOCATE → EXECUTE → VERIFY → REVIEW → MERGE OR RETIRE → CLEANUP. Record final disposition and distinguish local evidence, exact-head hosted CI, release, deployment and real production/Business/LINE acceptance.

Keep ordinary GitHub/task/session statuses and existing records; do not require state conversion, a new record, or a replacement developer-task ledger. For unfinished work, identify the blocker, responsible owner and resume trigger in the existing handoff or PR. Prefer completing valid work; explicitly retire cancelled/obsolete work only with authorized disposition, replacement links and preservation of unique changes. A closed chat does not complete the task or release its runtime.

Reuse suitable owned branches and the existing naming/commit conventions. Preserve unrelated and unpushed work, stage intended paths and select the intended remote explicitly. Follow the current PR/base/review and release controls; do not commit directly to a protected branch or bypass hooks/checks.

Substantive changes require independent review of the same patch. Before merge eligibility verify current branch protections, base freshness and required exact-head `changes`, `verify` and `edge-verify` results, plus all applicable acceptance. A local shadow plan or green check on another SHA is not merge evidence. Never infer merge authority from a zero approval-count setting. Do not alter protection settings, disable CI or reinstate DDC.

Record prerequisites by exact PR/base/contract/migration/artifact. Integrate them into the intended final target before independently merging a dependent PR. A child merged into an unmerged feature branch is not delivery to main. After authorized prerequisite integration/retargeting, recompute the diff and repeat affected review/checks on the resulting head. Retain parent branches/worktrees and evidence still needed by children, migrations or UAT.

## Documentation and verification authority

Canonical ZAI records, issued IDs/subject anchors, ADRs and approved migration profiles retain their authority. Do not hand-edit PRD/FEATURES compatibility exports or add a product requirement ID for an operational prose convention. This policy does not consolidate or rewrite the existing large AGENTS.md/CLAUDE.md bodies.

Use the existing document writer/governance rules for metadata and typed links. Where canonical records change, regenerate registry, graph and views in the approved order; run `npm run govern` and applicable freshness/reader/contract checks in an owned writable location. Changes to root AGENTS.md/CLAUDE.md also require the current `docs:llms`/freshness handling. Review and include generated changes; only the authorized Integrator writes shared generated state.

The active verification selector and [verification policy](../architecture/VERIFICATION-POLICY.md) govern scoped checks. Documentation/policy changes are not blanket exemptions. Shadow verification plans cannot authorize omissions; required hosted checks remain in force. A patch prepared outside a safe editable repo can establish static applicability/links while leaving govern, generated-artifact freshness, independent review and hosted acceptance explicitly pending. No application build is justified merely by creating a file-only handoff.

Before editing/integration compare current ADRs, domain/service contracts, canonical records and diffs. Reconcile textual conflicts and semantic drift. ADR-113's retirement takes precedence over historical DDC records; ADR-110's retired execution surfaces and the existing Knowledge/RAG/product boundaries remain unchanged.

## Shared databases, Docker and runtime resources

Preserve ADR-112's separation of primary dev, Knowledge Studio and each UAT stack by Compose project, database, volume and environment. ADR-114 keeps self-hosted production and cloud Supabase as distinct targets. Never repoint development at UAT/production, promote by changing a dev connection, or infer permission to migrate/apply/deploy from a documentation change.

Do not launch, restart, stop or remove another session's containers, tunnels, watchers, databases, runtime profiles or worktrees. Use current owner/session evidence and resource/process enumeration together. A process-path search is a floor, not proof of absence; exclude the inspection's own ancestry and preserve unknown users. Docker volumes/data disks, shared caches and active runtime files remain protected.

## Cleanup eligibility and recovery

Worktree cleanup states are PROTECTED, REVIEW_REQUIRED, VERIFIED_SAFE and CLEANED, independently of task status. MERGED never implies VERIFIED_SAFE. This policy authorizes no cleanup.

Before any separately authorized destructive operation, verify current ownership release and absence of active consumers; final task disposition; all dependency/UAT/release-evidence needs; staged/unstaged/untracked/ignored files, local refs and unpushed work; and a recovery artifact whose coverage, integrity and recoverability are verified. Git patches/bundles do not include all ignored data, databases or local session notes. Never infer safety from tidiness, age, archive status or a missing/prunable registration.

Resolve exact absolute paths and junction/symlink boundaries immediately before acting. Preserve primary/common Git metadata; never force-remove a worktree merely because its PR merged or discard unrelated changes. Branch deletion needs separate reachability/dependency verification. After an authorized action, verify registrations and retained recovery evidence, then record the exact target/result as CLEANED.

Avoid duplicate builds/installs, reuse safe caches, and check source/build/temp/cache drive capacity. Do not run heavy parallel builds on critically full drives. Shared dependency caches, Codex/Dot session state, Docker volumes/data disks and runtime data need verified ownership, recovery evidence and applicable authority before cleanup. Cleanup remains a separate task under existing operational safety rules.

On an unexpected effect or ownership conflict, stop dependent mutations and preserve refs/diffs/logs/artifacts. Report through the authorized task channel; use the existing RCA process for material incidents. Restore only affected owned state from verified evidence after checking for newer work. A Git rollback cannot recover a deleted volume; environment/data recovery needs its own operator authority.

## Enforcement boundary

Markdown neither locks the filesystem nor proves exclusive ownership. Current GitHub branch protection and required jobs enforce only their configured rules. Governance/reader/contract scripts enforce their actual coverage, not arbitrary operational claims. PR templates, CODEOWNERS and local hooks are effective only where configured and required. No protection settings, CI gates or runtime framework are changed by this policy; propose additional automation separately.

## Version diff

0.0 → 0.1.0 (2026-11-04): add portable reuse-first ownership, dependency-aware recovery and independent cleanup eligibility under the existing ADR-113 delivery policy; preserve documentation/session and runtime/data boundaries.
