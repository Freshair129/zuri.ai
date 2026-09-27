# RCA: Notion schema change and Phase B inventory binding

## Symptom

The full test run failed while loading `tests/integration/phase-b-recovery.test.js` with `The committed Phase B target inventory could not be loaded`.

## Evidence

- `phase-b-recovery.mjs` required the exact SHA-256 `9ca8618d758d29387a0eaf79877a370c2ee8f24aadf09a07b4c103e0fe7f974a` and a complete 188-table inventory.
- The approved Notion feature added `NotionOAuthState`, `NotionWebhookVerificationToken` and `NotionWebhookReceipt` to `schema.prisma`, producing 191 Prisma models and schema SHA-256 `ca3e8247e50eb95980561e3ce8aa882ed7b11010d0b2167582e5f37b448132c8`.
- The Phase B loader correctly returned unavailable for that mismatched exact-byte binding.

## Root Cause

Adding the three Notion models changed the canonical Prisma schema bytes and model set, but the Phase B frozen inventory and its executable hash/count pins still described the previous 188-table target.

## Why the issue escaped detection

The focused Notion suite exercised its SQLite schema and migration contracts but did not load the repository's Phase B recovery inventory. The full repository test suite exposed the cross-module contract.

## Proposed prevention

For every Prisma model change, recompute the Phase B schema and target-inventory hashes, add every model to the frozen table map, reconcile snapshot inclusion/exclusion, update the executable pins and tests together, and retain the mismatch-refusal checks. The 188-table binding remains historical and refuses cross-schema recovery.
