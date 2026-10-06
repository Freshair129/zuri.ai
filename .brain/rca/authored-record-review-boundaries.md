---
status: active
superseded_by: null
version: "0.1.0"
date: "2026-10-05"
---

# Authored record boundary failures caught before issuance

## Symptom

Independent review rejected candidate tree `465e4d8dd0531eac2b3610f095752c2b21002631`: snapshot verification can accept false base provenance in a second migration, and path validation misses dangling links. No real records were issued.

## Evidence

The `cache-forged-base` synthetic Git fixture produced a VALID proof before the fix despite a forged second manifest ledger digest. Both manifests share genuine base and approval revisions; their own record/manifest hashes are consistent. The denial test failed with a fulfilled VALID result.

All three synthetic dangling-link denial fixtures failed before the fix. On this Windows host, file symlinks require privileges, so the executed fixtures use dangling junctions at record, receipt and ancestor paths. They demonstrate the same `existsSync`/`lstatSync` gap without creating outside data. Logs are private operator evidence; fixtures contain no user data.

## Root Cause

The snapshot memoization key omitted manifest identity and base index/ledger digests. An earlier successful check therefore authorized distinct proof inputs. The writer used target existence to decide whether to inspect the link itself; `existsSync` returns false for a dangling link.

## Why the issue escaped detection

Existing authored snapshot tests covered one migration per capture. Path tests covered traversal but not dangling links. The earlier 70 Node and 30 snapshot tests consequently did not exercise these cases.

## Proposed prevention

Bind the cache to every provenance proof input, including manifest digest and both base digests. Inspect each path component with `lstatSync`, ignoring only ENOENT. Keep positive two-manifest verification and negative forged-second-manifest/link tests. Actual issuance remains gated on repeat independent review and governance.
