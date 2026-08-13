# UI Design System: Zuri Heritage v2

| Field | Value |
|---|---|
| **Version** | 2.0.0 |
| **Status** | Accepted |
| **Date** | 2026-08-13 |
| **Applies to** | Zuri V2 web back-office surfaces |
| **Governing decision** | ADR-010 |

Zuri is a task-focused, offline-capable back-office application. The web UI prioritises
clear context, predictable controls, and dense operational data. It is not a visual
reset of V1: lifted V1 modules retain their compatibility boundary under ADR-006 and
are brought into this system only at their individual cutover.

## 1. Principles

1. **Clarity before decoration.** Users can identify their current business, domain,
   page, and the outcome of a control before acting.
2. **Content before chrome.** Data, status, and decisions carry the hierarchy. Cards,
   shadows, and colour do not compete with them.
3. **Progressive disclosure.** Keep the primary workflow on the page; expose detail
   when it is needed.
4. **Predictable interaction.** A component has the same semantics and states on every
   V2 screen.
5. **Semantic colour.** Colour supports text and icons. It never carries status alone.
6. **Dense when useful.** Data views may be compact; navigation and decisions retain
   sufficient separation and target size.

## 2. Token architecture

Tokens have three layers. Components consume component or semantic tokens only.

```text
Primitive (private palette)
  -> Semantic (meaning)
       -> Component (specific control role)
```

### 2.1 Primitive palette

The Zuri Heritage palette is binding. Amber Citrus is the sole primary brand accent;
unrelated blue or purple branding is prohibited.

| Family | Values |
|---|---|
| Amber | `#E8820C`, `#F09420`, `#B86A08`, `#FDE8D0`, `#FFF8F0` |
| Neutral | `#FFFFFF`, `#F7F8FA`, `#EFF1F3`, `#E5E7EB`, `#6B7280`, `#1F2937` |
| Informational | `#D6ECFA`, `#3D7A9E`, `#C6A052`, `#F5ECD7` |
| State | success `#238553`, danger `#C84B4B`, warning `#B7791F` |

### 2.2 Semantic tokens

| Meaning | Token |
|---|---|
| Application canvas | `--bg-canvas` |
| Standard surface / raised surface / overlay | `--bg-surface`, `--bg-raised`, `--bg-overlay` |
| Primary / secondary / tertiary / inverse text | `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-inverse` |
| Subtle / default / strong / focus borders | `--border-subtle`, `--border-default`, `--border-strong`, `--border-focus` |
| Primary action and hover | `--action-primary`, `--action-primary-hover` |
| Success, warning, danger, informational status | `--status-success`, `--status-warning`, `--status-danger`, `--status-info` |

### 2.3 Component tokens

Component tokens are aliases that protect components from palette or theme changes:

```text
--button-primary-bg       -> --action-primary
--button-primary-hover    -> --action-primary-hover
--input-border            -> --border-default
--input-border-focus      -> --border-focus
--card-bg                 -> --bg-surface
--card-border             -> --border-subtle
```

The legacy `--brand`, `--surface`, `--border`, and related variables remain aliases
during the V2 migration. New components must use the semantic or component layer.

## 3. Foundation

### Surface hierarchy

Use only four layers: canvas, surface, raised surface, and overlay. A card represents
an independent object such as a KPI or project. Continuous content uses sections,
lists, dividers, or tables, not nested cards.

### Typography

```text
IBM Plex Sans Thai, Manrope, Segoe UI, Tahoma, sans-serif
```

| Style | Size / line-height | Weight |
|---|---|---|
| H1 | 28 / 36px | 650 |
| H2 | 24 / 32px | 650 |
| H3 | 20 / 28px | 600 |
| Title | 16 / 24px | 600 |
| Body | 14 / 22px | 400 |
| Body small / label | 13 / 20px | 400 / 500 |
| Caption | 12 / 18px | 400 |

Desktop productivity screens use 14px body text by default. Dense tables may use 13px
when their row and column labels remain legible.

### Spacing, radius, shadow, motion and layers

- Spacing uses a 4px grid: `0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96`.
- Radius: input/button 8px, card 12px, modal 16px, badge 6px, avatar/pill full.
- Prefer borders for hierarchy. Raised surfaces may use the defined 2px/12px shadow;
  a card does not combine a decorative wide shadow with a border.
- Motion: 80, 120, 180, 240, or 280ms using `cubic-bezier(.2,.8,.2,1)`. Reduced-motion
  users receive instant state changes.
- Z-index: base 0, sticky 10, navigation 20, dropdown 30, popover 40, drawer 50,
  modal 60, toast 70, command 80, critical 90.

## 4. Component contract

Default interactive control height is 36px; high-volume forms may use 40px. Every
interactive component supplies default, hover, focus-visible, disabled, and loading
states. Input controls additionally define filled, read-only, and error states.

- One visual group has at most one primary action.
- Primary, secondary, ghost, destructive, and icon buttons are the only button
  variants.
- Validation explains how to correct input; it does not only say that input is invalid.
- Status is shown with text plus a semantic tone.
- Feedback uses the correct channel: inline for fields, toast for passive completion,
  banner for page-wide state, dialog for a decision, and progress for ongoing work.
- Loading defers feedback below 300ms, uses subtle progress to one second, skeletons
  above one second, and a progress bar when progress is known.

Lucide is the sole icon family: 16px inline, 18px controls, 20px navigation, 24px
feature. Do not mix icon libraries.

## 5. Patterns and navigation

Pages follow: breadcrumb, header (title, description, actions), optional tabs,
toolbar, content, then pagination or infinite load. Reuse the six patterns: Dashboard,
Collection/List, Detail, Create/Edit, Master Detail, and Settings.

The shell is governed by ADR-008: topbar, domain bar, breadcrumb, contextual sidebar,
and content. Scope selection happens on pages and through breadcrumb destinations;
this design system does not add persistent scope dropdowns.

Tables retain table semantics on smaller screens: full table, then horizontal scroll.
They do not automatically become a grid of cards. Their density is Compact 36px,
Default 44px, or Comfortable 52px.

## 6. Responsive and accessibility baseline

Breakpoints are `640`, `768`, `1024`, `1280`, and `1536`px. Behaviour is structural:
sidebar 240px to 64px to overlay, grids reduce columns, and tables scroll horizontally.

All newly changed V2 UI must meet WCAG 2.2 AA: semantic HTML, keyboard access,
visible 2px focus ring with 2px offset, ARIA where semantic HTML is insufficient,
4.5:1 body-text contrast, error text, reduced motion, and 44px touch targets when
the surface is touch operated. No implementation removes an outline without a
visible replacement.

## 7. Migration boundary

1. First establish semantic and component aliases in `globals.css`, keeping legacy
   aliases for current V2 routes.
2. Shared V2 primitives use only the new layers. Existing feature markup migrates
   when it is otherwise being changed.
3. V1 lifted modules keep their own visual baseline until their ADR-003 cutover task.
   Reuse does not authorise an unscoped redesign.
4. Every UI change adds accurate `@req`, `@spec`, and `@tested` links where applicable,
   then runs `docs:graph` and `docs:preflight`.
