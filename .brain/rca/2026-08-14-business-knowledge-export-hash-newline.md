# RCA — Business-knowledge export hash differs on Windows

**Date:** 2026-08-14
**Scope:** Phase 1 SmartGift JSONL export and migration reconciliation

## Symptom

The approved 74-row export reported SHA-256
`63a2d5426838a2fe6e11eb14c370377f28c494e62c6f160d228dc619cf862c5a`,
but hashing the emitted `business-knowledge.jsonl` file returned
`109e68acf15930ce2d96cef030e16bbc0bbfcd4f4f77725e1658591816a75f94`.

## Evidence

- The exporter computed its digest from an in-memory JSONL string joined with `\n`.
- The exporter emitted the same string with `Path.write_text()`.
- On Windows, text-mode newline translation wrote CRLF bytes while the digest covered LF bytes.
- The export row count was 74 and the public-field deny checks passed; the mismatch was limited
  to byte serialization and reconciliation identity.

## Root Cause

Hashing and file emission did not share one byte-level serializer. The digest represented
canonical LF JSONL, while the Windows output artifact contained translated CRLF bytes.

## Why the issue escaped detection

Unit tests covered approval, projection, price suppression, and forbidden fields but did not hash
the emitted artifact bytes. The earlier empty export also produced no output file to compare.

## Proposed prevention

Render JSONL once as UTF-8 bytes with explicit LF delimiters, use those exact bytes for both the
reconciliation SHA-256 and file emission, and add a regression test that hashes the written bytes.
