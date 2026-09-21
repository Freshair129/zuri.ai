---
id: RCA-TASK-ZAI-045-FILE-ADMISSION-TEST-GAP
date: 2026-09-21
status: open
scope: TASK-ZAI-045
baseline: e61a909029107fe29a9743ca604741848f89470b
---

# RCA — TASK-ZAI-045 FILE admission happy-path proof gap

## Symptom

The focused knowledge-admission service suite does not prove the successful FILE admission path. It proves that authorization rejects a file before its content is read, while the full managed-Markdown path is covered only by the long native acceptance.

## Evidence

- apps/server/tests/unit/knowledge-admission-service.test.js has a FILE case that expects authorization denial and asserts that the content resolver was not called; it has no successful FILE case.
- apps/server/tests/acceptance/knowledge-admission-native.test.js covers a managed Markdown FileAsset through publication and native evidence, but that acceptance requires the external KI17_* environment and is not the normal focused suite.
- apps/server/src/modules/knowledge/knowledge-admission-service.js computes the immutable FILE content hash, validates declared size/hash, and records FileAsset metadata in sourceMetaJson; those invariants therefore lack a fast regression at the service boundary.
- The knowledge charter and FR-173/FR-109 contract require authorized Text/Markdown and FileAsset admission to preserve immutable source identity before Stage 1. This audit does not claim production activation.

## Root cause

The original focused tests were added around the authorization-before-read security boundary. The successful FILE path was left to the expensive native acceptance, so the service-level immutable-content and metadata contract was never given a small deterministic regression.

## Why the issue escaped detection

The native acceptance is opt-in and intentionally long because it starts the real Next, MSP/GKS and GenesisRAG17 processes. Standard PR checks can therefore pass while a regression in the service's successful FILE mapping remains uncovered by the focused test file.

## Proposed prevention

Add one deterministic service-level regression using the existing fake repository and injected content resolver. Assert that an authorized Markdown FileAsset becomes one queued FILE ingestion with the resolver bytes, the computed immutable hash/source version, and redacted but complete FileAsset metadata. Keep the native acceptance as the separate end-to-end proof.

## Boundary

This RCA is limited to application-test proof. It does not change roadmap files, migrations, credentials, deployment, provider activation, or production state.
