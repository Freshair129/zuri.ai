---
status: active
superseded_by: null
version: "0.1.0"
date: "2026-10-05"
---

# Authored planned rows misread by graph

## Symptom

Composed strict governance reports FR-278/279/280 as lacking code anchors although their canonical rows explicitly declare planned delivery. The generated readiness projection also labels their registryStatus live and awards declaration credit despite no receiver implementation.

## Evidence

`doc-graph.mjs:130/142` recognizes only the legacy 🔜 marker. New authored rows end with the exact status cell `planned`. Strict preflight consequently emits a requirement-coverage CRITICAL. Three projection regressions fail before the fix against the actual composed graph.

## Root Cause

The export reader retained its legacy status vocabulary when the approved v2 authoring format introduced a plain planned status cell. This changes delivery interpretation in graph/readiness, not the canonical statement or issuance provenance.

## Why the issue escaped detection

Registry/snapshot fixtures verify authored statements and provenance, but synthetic view graphs do not run the legacy export status parser. The original corpus has no newly authored rows, so pre-issuance governance cannot catch this incompatibility.

## Proposed prevention

Recognize only the exact plain planned status alongside the existing legacy marker, preserving old done/retired behavior. Regenerate graph/runtime projections and test actual planned classification/coverage/no delivery credit. Do not hide missing code by weakening coverage or claiming receiver tests passed.
