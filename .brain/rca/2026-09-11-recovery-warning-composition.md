# Recovery warning composition

Version: 1.0.0b; Date: 2026-09-11; Status: beta.

## Symptom

A legacy snapshot lacking both Knowledge admission and GenesisRAG17 recovery
manifests displays only the GenesisRAG17 warning. This masks an unavailable
recovery source while additional approved feature recovery manifests are composed.

## Evidence

`previewSnapshot` in `backup-service.js` appends `admission.warnings`, then assigns
`warnings = manifest.warnings`. The latter replaces the first list. The existing
FR-045 unit test explicitly expected only the GenesisRAG17 warning for that
two-manifest omission, so it encoded the defect.

## Root cause

Independent recovery validators were composed using replacement instead of
accumulation. Neither validator itself loses evidence.

## Why the issue escaped detection

The legacy preview test asserted one source's warning and omitted the second
source from its expected output. Required-table rejection tests exercise errors,
not simultaneous unavailable sources.

## Proposed prevention

Under the approved continuation's explicit unavailable recovery contract, preserve
both warning lists and test simultaneous omissions plus a declared valid source
beside an unavailable source. Keep global snapshot version and restore authority
unchanged. This is a surgical LOW-risk integration correction within C-3 delivery.

Version diff: new RCA and regression for recovery warning accumulation.
