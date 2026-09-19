---
id: ZAI:RCA-PM-SCHEMA-EXTRACTION
title: PM documentation schema extraction lost composite key metadata
version: "0.1.0b"
status: candidate
created_at: "2026-09-16T12:15:00+07:00,RWANG,design base 087f3025"
last_update: "2026-09-16T12:15:00+07:00,RWANG"
superseded_by: null
attributes:
  doc_type: root-cause-analysis
  domain: project-manager
relations:
  - type: references
    target: ZAI:PM-TABLES-ERD
---

# PM table dictionary — composite key extraction

## Symptom

The first local documentation-model verification stopped on an undefined id
field. ProjectGoal legitimately uses a composite primary key. The draft ERD did
not mark its two key columns as PK. No application or database was changed.

## Evidence

The enumerated design-baseline apps/server/prisma/schema.prisma declares
ProjectGoal with projectId, goalId, createdAt and @@id([projectId, goalId]).
There is no scalar id column. The first dictionary extractor recognized scalar
@id only, while the validator assumed every record had a scalar id.
Source relation declarations are also separate from scalar lines in Prisma.

## Root cause

The source-to-document extraction simplified Prisma key declarations too far.
It extracted scalar fields but did not associate model-level composite key or
relation metadata with the corresponding scalar columns.

## Why the issue escaped detection

Earlier documentation checks validated Markdown links, OpenAPI and graph
references. They did not inspect source-model primary keys. The new catalog
validation exposed the discrepancy before the artifact was handed off.

## Correction and prevention

- Parse @@id column lists and mark those existing columns as PK; do not invent
  a new id column or alter the source.
- Associate relation metadata with scalar FK columns. Mark references outside
  this bounded catalog explicitly, rather than omitting or inventing target tables.
- Verify every record has a non-null primary key, and assert ProjectGoal's exact
  ordered key is projectId, goalId. Proposed records still require their
  designed UUID key.
- Preserve hashes and scalar definitions from the source. Validate relationships,
  indexes, diagram rendering and trace links separately from product tests.

Local evidence is in pm-design-qa/spec-blueprint-verification.json. Its scope is
documentation/model/browser validation; database migration and product tests
remain NOT_RUN.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | Record composite-key extraction defect and source-preserving verification | base 087f3025; uncommitted | RWANG |
