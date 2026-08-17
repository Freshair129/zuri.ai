---
title: "A2 Roadmap Board Wireframe"
doc_id: "DESIGN-WIREFRAME-A2-ROADMAP-BOARD"
status: "draft"
version: "0.1.1+draft"
updated: "2026-06-20"
owner: "THESEUS / VIBE"
source_of_truth: false
related_docs:
  - "docs/roadmap/GoVibe-Mission-Control-template.html"
  - "docs/references/templates/TEMPLATE_REFERENCE.md"
  - "docs/design/SITE_MAP.md"
  - "docs/design/DOMAIN_DETAILS.md"
---

# A2 Roadmap Board Wireframe

## 1. Purpose

This wireframe translates the A2 section of the legacy Mission Control template into a readable structural reference for planning, implementation, and QA.

It is a wireframe/spec artifact, not a runtime source.

## 2. Source Reference

Primary source:

- `docs/roadmap/GoVibe-Mission-Control-template.html`

Supporting extracted view:

- `comp/mission-control-template/views/A/A2-roadmap-tracker.html`

## 3. Screen Role

`A2 Roadmap Board` is the planning and execution visibility surface inside `Domain A: Project Overview`.

It must let a user:

- see global roadmap progress
- inspect roadmap or backlog structure
- switch between approved planning sources
- review sprint and task detail
- assign or review agent ownership
- export roadmap/task artifacts

## 4. Primary Layout Zones

```text
+--------------------------------------------------------------------------------------+
| A2 ROADMAP HEADER CARD                                                               |
| Title | Thai summary copy | overall progress % | progress bar                        |
| Stats: total features | ready/implemented | backlog                                 |
| Actions: source tabs | export | reset                                                |
+--------------------------------------------------------------------------------------+

+-----------------------------+--------------------------------------------------------+
| LEFT SIDEBAR PANEL          | MAIN ROADMAP DETAIL PANEL                              |
| AI Assist Roster            | Phase / roadmap container                              |
| Agent cards                 | Sprint shell / sprint block                            |
| Drag-to-assign affordance   | Task rows                                              |
|                             | Expandable task detail dropdown                        |
+-----------------------------+--------------------------------------------------------+
```

## 5. Structural Wireframe

```text
+===============+
|[Roadmap A tab]| [Roadmap B tab] | [Roadmap C tab] |
+               ===================================================================================+
| GoVibe Development Roadmap A             timeremaining : [hh:mm:ss]      [ <progress>% ]     |
| แผนการพัฒนาและติดตามผลความคืบหน้าของฟีเจอร์                                                          |
| ----------------------------------------------------------------------------------------------   |
| [progress bar..............................................................................]     |
|                                                                                                  |
| <done>/<total>        X               XX      [elapsed]              [deadline ts]    [Export] [Reset] |
| Task ทั้งหมด    ระดับความซับซ้อน     Tokenusage     Timeescape            Deadline                   |
|                                                                                                  |
+==================================================================================================+

+===============================+==================================================================+
| Agent list                    | +--------------------------------------------------------------+ |
| Drag a card to assign...      | |                                                              | |
|                               | |  [PHASE 0]  <Title>        [Duration:] [-----------] 0% [▾]  | |
|                               | |                                                              | |
| +---------------------------+ | +--------------------------------------------------------------+ |
| | EVA Agent                 | | |                                                              | |
| | model / status / quota    | | |  [PHASE 1]   <Title>        [Duration:] [-----------] 0% [▾] | |
| | capability badges         | | |                                                              | |
| | Configure                 | | +--------------------------------------------------------------+ |
| +---------------------------+ | |                                                              | |
| +---------------------------+ | |                                                              | |
| | Qwen Agent                | | +--------------------------------------------------------------+ |
| +---------------------------+ | |                                                              | |
| +---------------------------+ | |                                                              | |
| | UAT Agent                 | | |                                                              | |
|                               | |                                                              | |
|                               | |                                                              | |
|                               | |                                                              | |
|                               | |                                                              | |
|                               | +--------------------------------------------------------------+ |
+===============================+==================================================================+
```

## 6. Zone Details

### 6.1 Header card

Contains:

- title: `GoVibe Development Roadmap`
- short Thai descriptive line
- overall progress percentage
- horizontal progress bar
- three compact stats
- export control
- reset control
- roadmap source selector as document-like tabs

### 6.2 Source tab row

Contains one tab per approved source:

- roadmap
- backlog
- sprint source when applicable

Visual intent:

- should read like file/document tabs
- active tab appears attached to the detail panel
- inactive tabs remain clickable but lower emphasis

### 6.3 Left roster panel

Contains:

- section title `AI Assist Roster`
- short instruction about drag-to-assign
- stacked agent cards
- quick agent status/role summary

### 6.4 Main roadmap detail panel

Contains:

- one active roadmap/phase container at a time
- one or more sprint blocks
- one or more task rows per sprint
- one expandable task detail area per task

## 7. Task Detail Wireframe

# Wireframe — PHASE 0 / Sprint 0

> Converted from the provided screenshot into a Markdown wireframe.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [ PHASE 0 ]  <title>                                    [Duration: 1 week] [----------]0%   [▾] │
│                                                                          [download]  [collapse] │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│  Goal: <detail text>                                                                            │
│                                                                                                 │
│                                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │  SPRINT 0    Feasibility Spike                                      [Duration: 1 week] 0% │  │
│  │                                                                                           │  │
│  │  ┌──────────────────────────────────────────────────────────────────────────────────┐     │  │
│  │  │ ○  [▾]  Prototype YouTube IFrame Player บน 2 clients พร้อมกัน      ASSIGN TO: [▼] │     │  │
│  │  │        [FR] [High] [doc] [code] [test]                                           │     │  │
│  │  ├──────────────────────────────────────────────────────────────────────────────────┤     │  │
│  │  │                                                                                  │     │  │
│  │  │  SYMBOL LINKS                                                    [NOT IMPLEMENT] │     │  │
│  │  │                                                                                  │     │  │
│  │  │  CODE LINK:                         DOC LINK:                       TEST LINK:   │     │  │
│  │  │  <path>                             <path>                          <path>       │     │  │
│  │  │                                                                                  │     │  │
│  │  │  VERSION:       COMPLEXITY:         TYPE:          STATUS:          TOKENS USED: │     │  │
│  │  │  [version]      [complexity]        [type]         [status]         [tokens]     │     │  │
│  │  ├──────────────────────────────────────────────────────────────────────────────────┤     │  │
│  │  │  DEFINITION OF DONE (DoD):                                                       │     │  │
│  │  │                                                                                  │     │  │
│  │  │  ACCEPTANCE CRITERIA             SUCCESS CRITERIA             EXIT CRITERIA      │     │  │
│  │  │  ☐ Spec approved                 ☐ Code complete            ☐ Tests passed     │     │  │
│  │  │  ☐ Docs updated                  ☐ Lints clean              ☐ Regression free  │     │  │
│  │  ├──────────────────────────────────────────────────────────────────────────────────┤     │  │
│  │  │  CHANGELOG:                                                                      │     │  │
│  │  │  ┌────────────────────────────────────────────────────────────────────────────┐  │     │  │
│  │  │  │ [1.0.0] - Added iframe configuration sandbox;                              │  │     |  │
│  │  │  │         resolved background autoplay restrictions.                         │  │     |  │
│  │  │  │         [Updated: 2026-06-05T16:22:00+07:00, Wang,d4e5f6g]                 │  │     |  │
│  │  │  └────────────────────────────────────────────────────────────────────────────┘  │     │  │
│  │  │                                                                                  │     │  │
│  │  │  Created: 2026-06-05T00:00:07:00,EVA Agent,a3f2b1c                               │     │  │
│  │  │  TASK ID: TSK-<example>                       EXPORT TASK: [JSON][YAML][Markdown] │     │  │
│  │  └──────────────────────────────────────────────────────────────────────────────────┘     │  |
│  └───────────────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 8. Responsive Behavior

Desktop:

- two-column layout
- roster on the left
- roadmap detail on the right

Tablet:

- same visual order
- reduced panel width and tighter wrapping

Mobile:

- stack header, roster, and roadmap detail vertically
- source tabs may scroll horizontally
- task side controls move under task content

## 9. Interaction Notes

- Clicking a source tab switches the active roadmap source.
- Clicking phase header expands/collapses roadmap detail.
- Clicking task detail toggle opens the dropdown detail block.
- Dragging an agent card over a task suggests assignment intent.
- Export is available at roadmap level and task level.

## 10. Runtime Honesty Rules

This wireframe inherits the current GoVibe UI truth rules:

- no fake live progress when no approved source exists
- no invented task metadata
- missing fields must render as `unavailable`
- source tabs must only represent approved live-selectable roadmap inputs

## 11. Acceptance Criteria

- A reader can identify the A2 layout without opening the HTML template.
- The document distinguishes header, roster, roadmap panel, sprint block, task row, and detail dropdown.
- The wireframe preserves the source-tab pattern, export/reset controls, and task detail structure.
- The wireframe is traceable back to the legacy template and current A2 React contract.

## 12. Changelog

| Version | Date | Owner | Summary |
|---|---|---|---|
| 0.1.1+draft | 2026-06-20 | THESEUS / VIBE | Fixed dangling example task ID to a clearly-marked placeholder and relabeled header-card/task-detail sample numbers as placeholders per Runtime Honesty Rules. |
| 0.1.0+draft | 2026-06-20 | THESEUS / VIBE | First wireframe draft for A2 Roadmap Board derived from the legacy Mission Control template. |
