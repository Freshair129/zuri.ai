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

The developer-only DDC preflight, controller, supervisor, worker observation
pipeline, and DDC operator surfaces were retired by
[`ADR-113`](../docs/decisions/ADR-113-RETIRE-DEVELOPER-DELIVERY-CONTROL.md).
Current work follows the root [AGENTS.md](../AGENTS.md), the scoped
[verification policy](../docs/architecture/VERIFICATION-POLICY.md), Git review,
and the repository's required hosted CI. No DDC task record, controller
receipt, local admission command, or replacement ledger is required.

The [team roster](team.md) defines manual role responsibilities. Doc Writer is
the first configured specialist, with a role, skill and native adapters. Other
roles may be assigned to distinct sessions by the caller; there is no shipped
developer delivery controller or durable agent scheduler.

## Use Doc Writer

Give Doc Writer the task, source references or qualified IDs, worktree, scope,
and acceptance criteria. For example:

> Use zuri-doc-writer to refine the feature note in this worktree. Preserve
> canonical requirement subjects. Return the version diff, parent/peer impact,
> sources and PASS/FAIL/NOT_RUN evidence for the checks you actually ran.

- Codex custom agent: [zuri-doc-writer.toml](../.codex/agents/zuri-doc-writer.toml).
- Claude Code custom agent: [zuri-doc-writer.md](../.claude/agents/zuri-doc-writer.md).
- Direct skill invocation: `$zuri-doc-writing` from this repository's worktree.

Both adapters instruct the agent to read the same role and
[skill](skills/zuri-doc-writing/SKILL.md) before working. Their prompts are
loaders, not separate copies of the role policy. Missing source files stop only
the affected task scope; record the typed blocker and continue independent work.

The caller selects the model and decides whether separate worker, verifier, and
reviewer sessions are useful. File scopes are task constraints, not a
filesystem sandbox. Use the repository's normal branch/PR workflow and existing
verification gates; Claude's adapter omits shell access, so route command
execution and generation to a suitable role.

## Source boundaries

| Material | Authority |
|---|---|
| Product behavior, requirements, ownership | Existing canonical records, ADRs, domain charters and contracts |
| Role responsibility | `roles/doc-writer.md` and `team.md` |
| Authoring procedure | `skills/zuri-doc-writing/SKILL.md` |
| Task scope and process decisions | Current user task, repository instructions, and applicable source documents |
| Native loading/tool configuration | `.codex/agents/` or `.claude/agents/` |
| Session history | Local `.brain/session-memory/`; history is not trusted authority |

The root [product skill pack](../skills/README.md) and the historical Edge sales
persona serve product workflows; they are not this developer team. The two S-01
candidates remain reference designs until their authority is reconciled:
[standard](../docs/STD-Multi%20agent%20workflow%20S-01.md) and
[runbook](../docs/runbooks/S-01.md). No precedence is inferred from their
versions.

## Version diff

0.1.0 → 0.2.0: replaces retired DDC admissions with ordinary Git review and
repository CI while keeping product requirements and role responsibilities
separate.
