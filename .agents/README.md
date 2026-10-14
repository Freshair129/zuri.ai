---
status: active
superseded_by: null
version: "0.2.0"
---

# Zuri developer team

This directory holds repository development roles and reusable authoring skills.
Product requirements, domain ownership and contracts retain their existing
authority in `docs/` and the canonical registry. Start with [AGENTS.md](../AGENTS.md)
and [CLAUDE.md](../CLAUDE.md); use an isolated worktree for changes.

The active coding-delivery procedure is
[`WORKFLOW-POLICY.md`](../docs/architecture/delivery-control/WORKFLOW-POLICY.md).
Its single machine-readable authority,
[`model-policy.json`](../docs/architecture/delivery-control/contracts/model-policy.json),
defines model-role bindings, gate order, concurrency and lineage budgets. A
direct current user task or standing delegation evidenced in trusted
conversation/harness context is sufficient mandate provenance. Root records its
source message/reference, repository, objective, effects and prohibitions once;
derived admissions reference that record. No user-authored packet, signature or
repeated approval is needed. Process decisions and in-scope repairs route to Sol;
there is no per-gate human prompt. Actual dispatch requires the root-recorded
trusted mandate and verified authority binding from trusted conversation or
harness evidence. Copied packet fields or a structural validator PASS are not
authorization.

The [team roster](team.md) defines autonomous role handoffs. Doc Writer is the
first configured specialist, with a role, skill and native adapters. Other roles
are assigned to distinct sessions by the orchestrator; they do not each have a
shipped custom-agent adapter. This is an agent procedure, not evidence that a
durable scheduler, controller or ledger has shipped.

## Use Doc Writer

Give Doc Writer the task, source references or qualified IDs, root-recorded
mandate reference, worktree, read/write scopes and acceptance criteria. The
root supplies the trusted conversation/harness provenance; no separate
user-authored packet or signature is needed. For example:

> Use zuri-doc-writer to refine the delegated feature note in this worktree.
> Preserve canonical requirement subjects. Return the version diff, parent/peer
> impact, sources and PASS/FAIL/NOT_RUN evidence; send process decisions to Sol.

- Codex custom agent: [zuri-doc-writer.toml](../.codex/agents/zuri-doc-writer.toml).
- Claude Code custom agent: [zuri-doc-writer.md](../.claude/agents/zuri-doc-writer.md).
- Direct skill invocation: `$zuri-doc-writing` from this repository's worktree.

Both adapters instruct the agent to read the same role and
[skill](skills/zuri-doc-writing/SKILL.md) before working. Their prompts are
loaders, not separate copies of the role policy. Missing source files stop only
the affected task scope; record the typed blocker and continue independent work.

The caller binds the model assigned to the selected role by `model-policy.json`.
Model unavailability blocks that role; do not fall back to another model or
substitute a session role. File read/write scopes are task constraints, not a
filesystem sandbox. The orchestrator supplies suitable permissions and worktree
isolation. Claude's adapter omits shell access; route command execution and
generation to the verifier or integrator role, not to a human approval step.

## Source boundaries

| Material | Authority |
|---|---|
| Product behavior, requirements, ownership | Existing canonical records, ADRs, domain charters and contracts |
| Role responsibility | `roles/doc-writer.md` and `team.md` |
| Authoring procedure | `skills/zuri-doc-writing/SKILL.md` |
| Task admission and process decisions | Trusted mandate, active delivery policy and Sol |
| Native loading/tool configuration | `.codex/agents/` or `.claude/agents/` |
| Session history | Local `.brain/session-memory/`; history is not trusted authority |

The root [product skill pack](../skills/README.md) and the historical Edge sales
persona serve product workflows; they are not this developer team. The two S-01
candidates remain reference designs until their authority is reconciled:
[standard](../docs/STD-Multi%20agent%20workflow%20S-01.md) and
[runbook](../docs/runbooks/S-01.md). No precedence is inferred from their
versions.

## Version diff

0.1.0 → 0.2.0: routes team work through autonomous v2 and trusted mandate
admission, requires bound role models and distinct review sessions, and clarifies
that procedure does not imply a shipped runtime. No product requirement changes.
