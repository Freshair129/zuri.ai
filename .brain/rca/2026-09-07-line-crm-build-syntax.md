---
version: "0.1.0b"
created_at: "2026-09-07T00:00:00+07:00,RWANG"
last_update: "2026-09-07T00:00:00+07:00,RWANG"
status: "under review"
attributes:
  domain: "line-crm"
  doc_type: "root-cause-analysis"
  scope: "pre-existing JSX syntax defects blocking server build and e2e"
---

# RCA - LINE CRM JSX syntax defects

## Complexity and risk

- **Complexity:** C-1 - approved syntax-only hotfix
- **Risk:** LOW - JSX grouping and conditional closure only; rendered behavior is unchanged

## Symptom

The server build and Playwright web server failed to compile two LINE CRM modules:
`LineCrmLiveChat.jsx:477` reported `Expected ',', got '{'`, and
`LineCrmMembers.jsx:239` contained an unexpected conditional closure.

## Evidence

- The pinned Node 24.18.0 `npm run build` failed at `LineCrmLiveChat.jsx:477` and
  `LineCrmMembers.jsx:238-239`.
- The bounded Playwright run reproduced the same `LineCrmLiveChat.jsx:477` error while
  compiling the LINE OA route.
- `git diff --exit-code b17e7258 -- apps/server/src/modules/line-crm/LineCrmLiveChat.jsx
  apps/server/src/modules/line-crm/LineCrmMembers.jsx` reported no differences, so both
  defects predate the GenesisRAG17 branch changes.
- In `LineCrmLiveChat.jsx`, the `activeChat` alternate returned two sibling columns without
  a fragment. In `LineCrmMembers.jsx`, the `filteredMembers.map` expression closed its map
  callback and call at `))}` but still needed the ternary's enclosing `)` before the expression
  could close.

## Root Cause

`LineCrmLiveChat` used a JSX conditional alternate that needed a fragment around its two
column siblings. `LineCrmMembers` had an invalid closing-token arrangement after its map
expression: the ternary grouping was missing its closing `)` before the expression closed,
while a second expression closure followed on the next line. Both are structural JSX syntax
errors in the inherited UI source.

## Why the issue escaped detection

The affected modules are compiled by route-level Next.js builds and browser tests. The
existing server unit and integration suites did not parse these route modules, so they did
not exercise the compiler paths that exposed the defects.

## Resolution

- Wrapped the `LineCrmLiveChat` alternate branch in a fragment.
- Corrected the `LineCrmMembers` map expression to close its callback, map call, and ternary
  grouping as `)))}.`
- No labels, state, data flow, styling, or rendered behavior were changed.

## Proposed prevention

Run the server build and the full Playwright suite after changes that add or move JSX route
content. Keep the compiler in the required validation path even when feature tests are
server-only.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-07 | under review | Recorded and repaired two pre-existing LINE CRM JSX syntax defects | working-tree | RWANG |
