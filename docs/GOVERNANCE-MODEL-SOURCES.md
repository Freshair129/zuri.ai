---
version: "0.1.0"
status: active
superseded_by: null
last_update: "2026-10-06T08:00:00+07:00,Codex"
---

# Domain model evidence sources

This contract implements the owner-approved File governance source proposal
(approval recorded 2026-10-06). It changes evidence attribution, not runtime
ownership or deployment state.

Domain charters remain the ownership source under ADR-025. A charter may declare
one repository-relative `model_source` in frontmatter when its models are owned
by a standalone service rather than the Server Prisma schema:

```yaml
model_source: services/file-management/migrations/0001_file_management.sql
owns_models:
  - FileRecord
  - FileVersion
  - FileOperation
```

Without `model_source`, Server charters continue to use
`apps/server/prisma/schema.prisma`. The source must be an existing, readable
`.prisma` or `.sql` file inside this repository. SQL `CREATE TABLE` names use
snake_case to PascalCase for charter comparison. A planned model without a
declaration in that source remains unimplemented evidence, even if prose names it.
Missing, outside-repository, empty, or conflicting sources cannot establish a
verified database check. The graph, preflight, and domain-state projection use
the same source rule; duplicate model ownership remains a critical preflight
finding.

MCP readiness uses a domain-owned adapter with a protocol test that references
it, or a shared adapter whose code and protocol test both point to the same
domain requirement. A protocol test for another domain cannot verify this
domain. With no domain MCP responsibility or implementation, the check is
`not_applicable`. This is repository evidence only; it is not a deployment or
production-runtime claim.

Version diff (2026-10-06): records the approved standalone model-source and
domain-scoped MCP evidence contract. No ownership, model, or deployment is
declared by this document itself.
