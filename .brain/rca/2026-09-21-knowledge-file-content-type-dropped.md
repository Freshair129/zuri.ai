---
id: ZAI:RCA-2026-09-21-KNOWLEDGE-FILE-CONTENT-TYPE
title: Knowledge FileAsset admission drops the Stage 1 content type
version: "0.1.0b"
status: beta
created_at: "2026-09-21T00:00:00+07:00,RWANG"
last_update: "2026-09-21T00:00:00+07:00,RWANG"
attributes:
  domain: knowledge
  risk: LOW
relations:
  - type: references
    target: ZAI:TASK-ZAI-045
  - type: references
    target: ZAI:FR-173
  - type: references
    target: ZAI:FR-109
  - type: references
    target: ZAI:ADR-072
---

# Knowledge FileAsset admission drops the Stage 1 content type

## Symptom

An admitted Markdown FileAsset preserves its bytes and hash in the durable
knowledge admission row, but the Stage 1 request sent by the queue runtime
labels the content as `text/plain`.

## Evidence

- `knowledge-admission-service.js` records the FileAsset MIME as `mime` inside
  `sourceMetaJson`.
- `knowledge-runtime.js` reads only the optional `structured` descriptor from
  that metadata and falls back to `text/plain` for the raw executor request.
- The Stage 1 contract requires `content_type` as raw-artifact evidence, and
  ADR-072/FR-173 explicitly admit existing readable Text/Markdown FileAssets.
- The combined focused audit suite reproduced 14/14 passing tests, but before
  this change it had no assertion that a FILE admission MIME reaches the raw
  executor.

## Root Cause

The admission metadata and runtime request were designed around the original
TEXT path. The FileAsset metadata was extended to retain MIME, but the runtime
fallback stayed hard-coded to `text/plain`, so the metadata was not projected
onto the Stage 1 source request.

## Why the issue escaped detection

Existing native FileAsset acceptance proves raw content, lineage, stage
evidence and publication, but it does not assert the Stage 1 request's
`contentType`. Unit runtime coverage used TEXT jobs only, so the fixed fallback
remained invisible while all byte/hash assertions passed.

## Proposed prevention

Project the server-written FileAsset MIME from `sourceMetaJson` into the raw
executor's `contentType`, retaining `text/plain` only for TEXT or legacy rows
without a MIME. Add one runtime regression test for a FILE job with
`text/markdown`; keep the native acceptance as the separate end-to-end proof.

## Validation boundary

This RCA concerns local/hosted code-path evidence only. It does not prove that
any production runtime has been activated or that a production FileAsset was
reprocessed. No roadmap, credentials, production migration, deployment,
provider activation or external `KI17_*` claim is in scope.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-21 | beta | Record the FileAsset MIME loss between admission metadata and Stage 1 request | working-tree | RWANG |
