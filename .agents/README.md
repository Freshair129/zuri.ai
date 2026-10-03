---
status: active
superseded_by: null
version: "0.1.0"
---

# Zuri developer team

This directory holds repository development roles and reusable authoring skills.
Product requirements, domain ownership and contracts retain their existing
authority in `docs/` and the canonical registry. Start with [AGENTS.md](../AGENTS.md)
and [CLAUDE.md](../CLAUDE.md); use an isolated worktree for changes.

The [team roster](team.md) defines the handoffs. The first configured specialist is
[Doc Writer](roles/doc-writer.md), approved by the owner on 2026-10-04.
The other five responsibilities remain manual assignments, without shipped
custom-agent definitions. This is not an autonomous scheduler.

## Use Doc Writer

Give the agent the task, source references or qualified IDs, approved scope,
worktree, allowed output paths and acceptance criteria. For example:

> Use zuri-doc-writer to refine the approved feature note in this worktree.
> Preserve the canonical requirement subjects. Return the version diff,
> parent/peer impact, sources and PASS/FAIL/NOT_RUN evidence.

- Codex custom agent: [zuri-doc-writer.toml](../.codex/agents/zuri-doc-writer.toml).
- Claude Code custom agent: [zuri-doc-writer.md](../.claude/agents/zuri-doc-writer.md).
- Direct skill invocation: `$zuri-doc-writing` from this repository's worktree.

Both adapters instruct the agent to read the same role and
[skill](skills/zuri-doc-writing/SKILL.md) before working. Their prompts are loaders,
not separate copies of the role policy. Missing source files stop the task.
Keep the adapter role name and references aligned when changing the role.

Model and reasoning settings inherit from the calling session. Qualify any local
model for the assigned work before using it; this package does not select a
provider or prove local inference support. File write sets are task constraints,
not a filesystem sandbox. The calling harness must supply suitable permissions
and worktree isolation. Claude's adapter omits shell access; command execution
and generation belong to the verifier/integrator.

## Source boundaries

| Material | Authority |
|---|---|
| Product behavior, requirements, ownership | Existing canonical records, ADRs, domain charters and contracts |
| Role responsibility | `roles/doc-writer.md` |
| Authoring procedure | `skills/zuri-doc-writing/SKILL.md` |
| Team handoff | `team.md`, subject to root instructions and task approval |
| Native loading/tool configuration | `.codex/agents/` or `.claude/agents/` |
| Session history | Local `.brain/session-memory/`; history is not approval |

The root [product skill pack](../skills/README.md) and the historical Edge sales
persona serve product workflows; they are not this developer team.
The two S-01 candidates remain reference designs until their authority is
reconciled: [standard](../docs/STD-Multi%20agent%20workflow%20S-01.md) and
[runbook](../docs/runbooks/S-01.md). No precedence is inferred from their versions.

## Version diff

0.0 → 0.1.0: adds the developer-team entry point, a configured Doc Writer, shared
authoring skill and native adapters. No product requirement or runtime is changed.
