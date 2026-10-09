---
status: active
superseded_by: null
---

# RCA — standalone domain evidence source and MCP attribution

## Symptom

The File T1 charter can truthfully claim three standalone SQL tables, but the
current governance projection reports them missing from Server Prisma. It can
also report MCP verified for a domain without that domain's adapter or protocol
test.

## Evidence

- `apps/server/scripts/doc-preflight.mjs` Check 3 built one model set from
  `prisma/schema.prisma` and compared every charter against it.
- `apps/server/scripts/doc-graph.mjs` created model nodes only from that same
  Prisma schema, while ownership edges came from all charters.
- `apps/server/scripts/domain-state.mjs` `databaseCheck` read only Server
  Prisma; `mcpCheck` scanned every Server MCP file and protocol test for each
  domain, without an ownership filter.
- The original MCP scan matched `LineCrmAiMcp.jsx`, a client component backed
  by `mockData`, and treated prose in the Agent and Identity feature notes as
  adapter responsibility. Raw protocol words in test comments were sufficient
  for a verified check. `generatedFrom` omitted declared standalone sources.
- The approved File proposal identifies
  `services/file-management/migrations/0001_file_management.sql` as its model
  evidence source and keeps `FileUsageReference` planned. The owner approved
  that proposal in chat on 2026-10-06; the retained proposal records the
  approval as `status: active` and `approved_by: owner-in-chat-2026-10-06`.
- Asset Management's charter intake contract and FR-133 acceptance criteria
  both declare Agent/MCP as a channel, while Identity FR-123 only prohibits
  session ID authorization and Agent FR-132 describes a future requirement.

## Root Cause

The governance readers encoded Server Prisma and global Server MCP tests as
universal evidence sources. The charter had no machine-readable way to select
a standalone source, and MCP checks did not require domain attribution.

## Why detection missed it

The governance tests exercised the Server Prisma layout and global protocol
test presence. They did not include a standalone SQL domain with an absent
planned model, malformed declaration or an empty claim list, nor did they
distinguish actual MCP dispatch from UI mocks, incidental prose or comments.

## Proposed prevention

Use one checked `model_source` contract across graph, preflight, and
domain-state. Attribute MCP implementation and protocol tests to each domain.
Test positive and negative SQL source cases, unreadable source behavior, and
cross-domain MCP evidence. Require executable protocol-test evidence, include
declared sources in generated lineage, and reject malformed declarations.
Keep an explicit declared intake channel visible as a transport gap when no
adapter exists; do not infer responsibility from incidental MCP mentions.
Regenerate derived views only from composed canonical sources before merging
the File charter.
