---
version: "1.0.0"
created_at: "2026-08-28T00:00:00+07:00,Claude Opus 5"
last_update: "2026-08-28T00:00:00+07:00,Claude Opus 5"
status: "accepted"
superseded_by: null
attributes:
  domain: "governance"
  doc_type: "architecture-decision"
  scope: "where concurrent Claude Code sessions may perform git writes, and what the detached primary checkout does and does not protect"
---

# ADR-051 — The primary checkout is not a working lane

**Status:** Accepted on 2026-08-28. D1 landed in `CLAUDE.md` via PR #149 (merged 2026-08-28); D3 lands via branch `chore/primary-git-guard`. No product code, route, model or requirement id is authorized by this ADR.

**Decided by:** Boss, Lead Architect

**Relates to:** [ADR-039](ADR-039-REQUIREMENT-IDS-ARE-PINNED-BY-SUBJECT-ANCHOR.md), `CLAUDE.md`, `AGENTS.md`, `.brain/rca/2026-08-16-preflight-read-a-stale-graph.md`, `.brain/rca/2026-08-17-governance-did-not-govern.md`, `src/platform/integrations/core/pipeline-tracking-contract.js`.

## Context

`D:\zuri-ai` is one git working copy. Several Claude Code sessions use it concurrently, and git gives a working copy exactly one branch, one index and one working tree. Those three are therefore **global mutable state shared between agents that cannot see each other**, and every git write in that directory is a write into another session's workspace.

This is not a theoretical hazard. Three incidents have cost real work:

1. **2026-08-28** — a session left the primary checked out on its own branch; the next session ran `git merge` in the primary and fast-forwarded that branch to a commit its owner had not chosen.
2. **2026-08-28, within the hour** — the same failure in the opposite direction, between two different sessions.
3. **Earlier in the project** — a `git stash` run across a peer's checkout permanently destroyed two uncommitted edits to `docs/PRD-SDD-v1.0.md`. They were reconstructed by hand and the reconstruction is recorded in `89c7367` (`git log --all --grep "stash lost"`); the originals are gone.

The first two moved refs. The third destroyed files, and it is the only one of the three that lost data permanently.

What makes this worth an ADR rather than a reminder is *why* it kept happening. Nine worktrees already existed when incidents 1 and 2 occurred (`git worktree list`), and both agents knew worktrees were the intended pattern. They used the primary anyway, because the primary is zero-setup and already carries a populated `node_modules`, while a fresh worktree does not. The sanctioned path was more expensive than the dangerous one, so the dangerous one won — twice, in an hour, among agents who knew better.

## Decision

### D1 — Any lane that writes takes a worktree

`D:\zuri-ai` is the **read-only reference tree**: the place to read files and run non-mutating git queries, the junction target for `node_modules`, and the base from which `git worktree add` is run. No `commit`, `merge`, `rebase`, `checkout`, `reset` and above all no `stash` belongs there.

Every lane that intends to write — code, docs, generated artifacts, anything — creates its own worktree first and works there. Refreshing the primary is the one sanctioned mutation and only on a clean tree: `git fetch && git checkout --detach origin/main`.

**D1 is the primary mechanism of this ADR.** D2 and D3 exist to limit what breaks when D1 is missed; neither replaces it. Do not read this document as "the detachment prevents the problem" — the ordering is deliberate and the first version of this argument got it backwards (see D4).

### D2 — The primary stays on a permanent detached HEAD at `origin/main`

The primary is checked out detached rather than on `main`. A stray `merge`, `commit`, `reset --hard` or `pull` then moves a floating HEAD instead of advancing a branch that belongs to some other session. Incidents 1 and 2 would have produced a detached commit nobody was standing on, rather than a silently rewritten peer branch.

This is **blast-radius reduction, not an invariant**, and the ADR is explicit about the three ways it falls short:

- **A detached HEAD protects refs, not files.** `git stash`, `git reset --hard` and `git checkout -- .` in the primary destroy another session's uncommitted work exactly as they did before. **Incident 3 — the only one that lost data permanently — is the one D2 does not address at all.**
- **One `git checkout main` re-attaches it.** The wrong state remains fully expressible by a single ordinary command, typed in good faith by a session trying to be helpful. D2 is a *default*, not a constraint.
- **D2 introduces a small new loss mode of its own.** A commit made on the detached primary is reachable only through the reflog, and the next `git checkout --detach origin/main` orphans it. Before that refresh, `git log HEAD` in the primary is worth one look.

Stating these is the point of recording D2 rather than just doing it. An earlier draft of this argument claimed the detached HEAD made the damage *structurally impossible*; that claim is false, review caught it, and it is preserved here as a rejected formulation so it cannot be re-derived from the design.

### D3 — Enforcement belongs at the layer that can see the tool call

A Claude Code `PreToolUse` hook denies a writing git command whose working directory is the primary checkout. It lands via branch `chore/primary-git-guard`.

The hook is chosen for one reason: **all three incidents happened at the agent's tool call**, and `PreToolUse` is the only layer that observes that event before it takes effect. It sees the command string and the working directory together, which is exactly the pair that distinguishes "a merge" from "a merge in the shared tree", and it fires for `stash` and `reset --hard` — operations for which git itself offers no hook at all.

D3 is defence in depth over D1, not a substitute for it. It is configuration on one machine: it does not travel with the repository, a session can be run without it, and it cannot see a git command issued outside the harness.

### D4 — An invariant enforced by construction still needs its reason written where someone would undo it

The detached HEAD in D2 is a structural oddity with no note attached to it. Left that way, it reads as a defect — a tree somebody forgot to put back on `main` — and the next session repairs it away in one command, in good faith, destroying the property without ever knowing there was one.

So the rule is written into the `CLAUDE.md` hard-rules table *and* in prose, next to the oddity, saying that the detachment is deliberate and what it is for.

The precedent is in this repository. Two `z.literal()` pins in `src/platform/integrations/core/pipeline-tracking-contract.js` bound `dataPipelineDefinitionId` and `executionContractId` to single values, and in doing so held an invariant nobody had written down: a run's definition and its execution contract must be the matched pair. When a second pipeline definition arrived, the pins had to become flexible — correctly — and the change that loosened them dropped the unwritten job with them, so an event could name a run of one pipeline definition under another's contract. The fix (`579e970`) is a `superRefine` that validates the pair, and it carries the paragraph the pins never had.

Generalised: **an invariant enforced by construction still needs its reason written where someone would undo it.** Structure enforces; only prose survives the refactor that touches the structure.

### D5 — The sanctioned path must not cost more than the dangerous one

A rule that makes the correct path more expensive than the incorrect one erodes. That is not a prediction; it is the observed cause of incidents 1 and 2, which happened *because* nine worktrees existed and a tenth still meant a fresh dependency install.

The cost is real: `node_modules` is 763 MB per real install (`du -sh node_modules`, 2026-08-28; 23,123 files, 722 MB of file content before allocation overhead), plus the install time. The mitigation sessions actually use is to junction `node_modules` back to the primary, and junctioning has two recorded failure modes in this project:

- **`npm ci` or `npm install` in a junctioned worktree deletes the primary's `node_modules`.** npm removes the directory before installing and removes *through* the junction. This has happened twice.
- **The shared Prisma client resolves its relative SQLite path against whichever tree generated it last**, so a real-database test run in a junctioned worktree reads or writes the wrong database.

The policy that follows is therefore split by what the lane does, not by preference:

| Lane | `node_modules` | Safe to run |
|---|---|---|
| Docs-only (ADRs, registries, generated views) | Junction to the primary | `docs:graph`, `docs:check`, `docs:preflight`, `govern` |
| Runs tests, builds, or touches the database | Its own real install (`npm ci`, never through a junction) | `test`, `test:e2e`, `build`, `verify` |

Remove the junction when the lane is finished (PowerShell `(Get-Item "<path>\node_modules").Delete()` — deleting the *link*, not its contents) and confirm the primary's `node_modules` still has contents before trusting the next run.

## Alternatives rejected

**A git `pre-commit` hook refusing commits made in the primary.** Rejected on coverage, and the coverage gap is the whole argument. `pre-commit` does not fire on a fast-forward merge, because no commit is created — which is precisely what happened in incidents 1 and 2. Git provides no hook at all for `reset --hard` or for `stash`, which is incident 3. The hook would therefore have caught none of the three recorded incidents while presenting, in the repository, as protection against exactly this class of accident.

This project's standing doctrine is that **a guard whose source cannot represent the failure it checks for is worse than no guard**: green ends the question, where an acknowledged absence invites a look. The same shape is already recorded twice — a preflight run that printed CRITICAL and exited 0, and a check that read a build artifact while reporting on the source (`.brain/rca/2026-08-17-governance-did-not-govern.md`, `.brain/rca/2026-08-16-preflight-read-a-stale-graph.md`). D3 is chosen because `PreToolUse` sits at the layer where all three incidents actually occurred.

**Making the primary a bare repository, with every lane a worktree.** Rejected for this iteration: it removes the junction target that D5 depends on, and forces a real install on every lane including docs-only ones — reintroducing the cost asymmetry D5 exists to avoid. Worth revisiting if per-lane installs become cheap.

**Serialising sessions with a lock file in the primary.** Rejected: it converts a correctness problem into a scheduling problem, does not stop a session that ignores the lock, and the failure mode of a stale lock is a blocked project.

**Leaving it as convention.** Rejected by evidence: it *was* convention on 2026-08-28, and it failed twice within an hour among agents who knew the convention.

## Consequences

- The safe operation is now the documented one, and the unsafe one is nameable in review: a git write with `cwd` = `D:\zuri-ai` is a defect regardless of outcome, and does not need a discussion about whether it happened to be harmful this time.
- **Uncommitted work in the primary remains destructible.** D2 does not protect files, and D3 is a local, bypassable configuration. Nothing in this ADR makes incident 3 impossible; it makes it a rule violation instead of an ordinary command. Anyone who reads this document as having closed that hole has read it wrong.
- The primary's HEAD is detached, so `git branch --show-current` there prints nothing. That is the expected reading, not a broken checkout, and it is now the cheap way to tell the reference tree from a working lane. `git branch --show-current` before any writing git command, anywhere, is the habit this ADR asks for.
- A commit made accidentally in the primary survives only in the reflog and is orphaned by the next `checkout --detach`. This is a new, small loss mode created by D2 and accepted knowingly against the ref-corruption it prevents.
- The junction policy in D5 is load-bearing, not advice. A test-running lane on a junctioned `node_modules` has two recorded ways to fail, one of which empties the primary's dependencies for every other concurrent session.
- Worktree count grows and needs pruning; `git worktree list` is the inventory and `git worktree prune` the cleanup. Never `rm -rf` a worktree directory whose `node_modules` may be a junction — the delete follows the link into the primary.
- This ADR authorizes no product change. It declares one id — `ADR-051` — which must be pinned in `docs/.id-ledger.json` before the branch is green (preflight Check 12, [ADR-039](ADR-039-REQUIREMENT-IDS-ARE-PINNED-BY-SUBJECT-ANCHOR.md)).
- If D1 is followed and D3 never denies anything, that is the intended steady state, not evidence that D3 is unnecessary. Its value is the incident it stops on the day D1 is forgotten, and a hook that has never fired cannot be distinguished from a hook that is not installed — so the way to know it works is to test it deliberately, not to infer it from silence.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-08-28 | accepted | Made the shared primary checkout a read-only reference tree with worktrees as the only writing lane, recorded the detached HEAD as blast-radius reduction rather than an invariant (it protects refs, not files, and does not address the one incident that lost data), placed enforcement in a `PreToolUse` hook because `pre-commit` cannot observe a fast-forward merge, a `reset --hard` or a `stash`, and fixed the junction policy so the sanctioned path stays cheaper than the dangerous one | working-tree | Claude Opus 5 |
