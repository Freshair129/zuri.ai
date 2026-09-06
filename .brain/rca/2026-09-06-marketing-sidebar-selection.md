---
version: "0.1.0b"
created_at: "2026-09-06T19:26:00+07:00,RWANG,ecbe27e0"
last_update: "2026-09-06T19:26:00+07:00,RWANG"
status: beta
attributes:
  domain: marketing
  doc_type: root-cause-analysis
---

# RCA — Two selected Marketing sidebar entries

## Symptom

Dashboard and Strategy were both highlighted while creating a Strategy plan.

## Evidence

The desktop screenshot from the integrated mobile/keyboard browser test showed
two amber entries. Sidebar marked any prefix match as current: `/growth` matched
`/growth/strategy` as well as the Strategy entry itself.

## Root Cause

The newly activated root Dashboard lacked an exact-match option. The shared
sidebar's existing prefix rule treated its descendants as Dashboard pages.

## Why the issue escaped detection

Navigation tests checked reachability and authorization, not uniqueness of the
current section. Visual review found the duplicated selection after the flow passed.

## Proposed prevention

Set `exact: true` on Marketing Dashboard and honor that explicit option in the
sidebar. Other entries retain their existing behavior. The Marketing browser
test now requires exactly one current sidebar link and identifies it as Strategy.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | beta | Record visual selection defect and focused correction | See git history | RWANG |
