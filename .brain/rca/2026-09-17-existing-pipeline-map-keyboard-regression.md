# Existing Data Pipeline Map keyboard regression found by TASK-ZAI-047

Version: 0.1.0b

Status: confirmed; outside the approved FR-253 implementation scope

Date: 2026-09-17

## Symptom

The full ordinary Playwright suite fails `fr213-data-pipeline-map.spec.js`, "an owner follows a chain and reads it again in the list view", at line 44 on both attempts. After selecting CH-01, focusing the LINE webhook node and pressing Enter leaves the CH-01 detail visible; `pipeline-detail-in.line-webhook` never appears.

## Evidence

- The retained trace and screenshot show successful navigation, chain selection, node focus and Enter; the node is visibly focused but the detail stays on the chain.
- `apps/server/src/modules/knowledge/pipeline-map/DataPipelineMapView.jsx:757` renders an SVG `g` with `role="button"`, `tabIndex={0}` and `onClick`, but no keyboard handler.
- `git diff HEAD -- apps/server/src/modules/knowledge/pipeline-map/DataPipelineMapView.jsx` is empty. TASK-ZAI-047 does not modify this file.
- `git show 099ebc8f -- apps/server/src/modules/knowledge/pipeline-map/DataPipelineMapView.jsx` shows the baseline PR #391 removed the Enter/Space `onKey` helper and the node's `onKeyDown` binding.
- All six FR-253 Console browser scenarios passed in this same full-suite run. Final counts and evidence paths are in the [phase report](../reports/2026-09-17-task-zai-047-knowledge-console.md).

## Root cause

The base map redesign retained focusability and button semantics on an SVG group while removing its keyboard activation handler. SVG groups do not gain native button activation merely from their ARIA role. Enter therefore does not call `selectNode`, matching the observed unchanged detail.

## Why the issue escaped detection

Compilation and static rendering do not exercise keyboard activation. The unchanged existing Playwright assertion detects the regression when the complete suite runs. Whether the base PR executed this exact browser gate is not established here; no hosted-CI conclusion is inferred.

## Proposed prevention

In the map's own FR-213 scope, restore explicit Enter/Space activation for the interactive node, preserve focus semantics, and rerun the existing keyboard assertion without replacing it with a click or increasing its timeout. Keep this path in the map's review gate. The current approved Console slice records this inherited failure and leaves the map implementation/test unchanged under AGENTS R9; full verification is not green and release is not authorized.
