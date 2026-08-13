---
feature: FR-037
module: project-manager
source: v2-native
---

# FR-037 — Project Files

| Field | Value |
|---|---|
| **Version** | 1.1.0 |
| **Status** | Implemented; compatibility boundary retained by FR-045 |
| **Date** | 2026-08-13 |
| **Relates to** | HANDOFF-SHELL-V2-CODEX §5 step 7, BR-002, SEC-003 |

`ProjectFile` is a file-reference record, not a binary-storage implementation.
It belongs to one Project and may optionally attach to a WorkItem in that project.
It stores `name`, `mime`, byte `size`, `url` or `blobRef`, version, uploader reference,
and timestamps. The service rejects cross-project WorkItem attachment and writes audit
events for creation and deletion.

The repository currently has no Prisma migration baseline and uses `prisma db push`
for its local SQLite workflow. `prisma/migrations/20260813070000_add_project_file/`
therefore records the additive SQL for review/cutover, while `db:push` applies the
canonical schema locally. `schema.postgres.prisma` is regenerated from that canonical
schema so the future provider migration contains the same model.

## Compatibility note — FR-045

[FR-045](FR-045-managed-local-file-workspace.md) implements managed local content,
Business aggregation and disposable cache. It supersedes only this feature's
“metadata/reference only” limitation. FR-037 remains as the legacy response and
route compatibility contract. Existing ProjectFile ids, rows, audit history and
`/api/projects/{id}/files` consumers are not silently deleted or rewritten.
