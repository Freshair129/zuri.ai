---
version: "0.1.0b"
created_at: "2026-09-28T07:25:00+07:00,MC0"
last_update: "2026-09-28T07:25:00+07:00,MC0"
status: "active"
attributes:
  domain: "agent-operations"
  doc_type: "schema"
  scope: "Structure of per-session handoff notes written when an agent session closes"
---

# Session memory

When a session closes, the agent writes one note to this folder. The next session reads the latest
note first, so it knows what was done, what state things are in, and what is still pending.

> **Notes are local only.** This repository is public, and notes can hold session ids and machine
> details. The note files (`CLAUDE-*`, `CODEX-*`, `GEMINI-*`) are excluded through
> `.git/info/exclude` on the primary checkout. Do not commit a note. This README holds no private
> data and may be committed.
> If something in a note belongs in the repository, promote it by copying it into the right tracked
> place (see "Promote, don't duplicate" below).

## File name

`{AGENT}-{session_id}-{ddmmyy}.md`

| Part | Value |
|---|---|
| `AGENT` | `CLAUDE`, `CODEX` or `GEMINI`, in upper case |
| `session_id` | The agent's native session id: the one the work was done in. If the process restarted, list the extra ids in `resumed_as` |
| `ddmmyy` | The date the session closed, in local time (+07:00) |

Example: `CLAUDE-1b2c3d4e-0000-4000-8000-000000000000-280926.md`

## How to find the latest note

The file name does not sort by date, so use `ended_at` in the frontmatter:

```bash
grep -H '^ended_at:' .brain/session-memory/*-*.md | sort -t'"' -k2 | tail -1
```

From a linked worktree, which does not hold this folder, read the primary checkout's copy:

```bash
ls "$(git rev-parse --path-format=absolute --git-common-dir)/../.brain/session-memory"
```

## Frontmatter

```yaml
---
agent: CLAUDE                      # CLAUDE | CODEX | GEMINI
role: MC0                          # Mission Control role (MC0, S1..S6) or "solo"
session_id: "<uuid>"
resumed_as: ["<uuid>"]             # optional: ids after a process restart
model: "<model id>"
started_at: "YYYY-MM-DDTHH:MM:SS+07:00"
ended_at: "YYYY-MM-DDTHH:MM:SS+07:00"
repo: Freshair129/zuri.ai
main_at_close: "<sha>"
status: closed                     # closed | interrupted
tags: [kebab-case, topics]         # domains and systems touched; used for search
summary: >-                        # 2 to 4 sentences: outcome first, then what is pending
  ...
counts: { prs_merged: 0, prs_open: 0, issues_open: 0, incidents: 0 }
supersedes: "<previous note file name>"   # optional
---
```

## Body sections, in this order

Each section says whether its content is **inline** in the note or a **pointer** to where it
lives. The rule: short, session-scoped items are inline; durable, reviewable items get their own
tracked home, and the note points to it.

| # | Section | Inline or pointer | Why |
|---|---|---|---|
| 1 | **State at close** | Inline | A snapshot the next session must trust or re-verify first: deployed images, feature flags, env changes, running agents, gates |
| 2 | **Done** | Inline. One line each, with the PR/commit link | A record of what the session did |
| 3 | **Issues (open)** | Inline. Pointer to the PR or GitHub issue when one exists | This is the next session's to-do list. Each item has an id `I-n`, an owner (`agent` or `user`), a status and the next action |
| 4 | **Decisions** | Inline. Pointer to the ADR/doc once it is recorded there | Owner rulings and MC0 decisions made in the session, with the date |
| 5 | **Knowledge** | Inline for short facts. Pointer for anything longer than 3 lines | Verified facts about the system learned this session (`K-n`) |
| 6 | **Aha moments** | Inline | Insights that changed the approach (`A-n`): what we believed, what was true, how it changes the next move |
| 7 | **Rules** | **Pointer** to the rule's home (AGENTS.md, agent memory or a runbook). Inline only for a *proposed* rule not yet adopted, marked `proposed` | Rules must live in one place, or they drift |
| 8 | **RCA** | **Pointer** to `.brain/rca/YYYY-MM-DD-<slug>.md` plus a one-line cause | An RCA is a long document with its own review; the note only indexes it |
| 9 | **Resume here** | Inline. An ordered list of the first 3 to 5 actions | So the next session starts without re-deriving anything |

## Rules for writing a note

- Record facts you verified, with evidence (a command, query or link). Do not record guesses as
  facts. Mark anything unverified as `unverified`.
- Never write a secret, a token or a credential value, even redacted. Name the variable instead.
- An item appears in exactly one of Issues, Knowledge or Aha, never in more than one.
- **Promote, don't duplicate.** When a Knowledge item or a proposed Rule becomes permanent, move
  it to its tracked home (ADR, handoff, AGENTS.md, runbook) and replace the note's copy with a
  pointer.
- A new session that finishes an Issue from an earlier note records it under its own Done. It does
  not edit the old note; notes are append-only history.
