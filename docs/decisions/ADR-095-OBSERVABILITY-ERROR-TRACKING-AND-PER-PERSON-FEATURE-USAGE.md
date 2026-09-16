---
version: "1.0.0"
created_at: "2026-09-16T19:00:00+07:00,Claude Sonnet 5"
last_update: "2026-09-16T19:00:00+07:00,Claude Sonnet 5"
status: "accepted"
superseded_by: null
attributes:
  domain: "platform-control"
  doc_type: "architecture-decision"
  scope: "persisted error tracking and route/action-level per-person usage events, both extending the existing structured logger"
---

# ADR-095 — Observability: error tracking and per-person feature usage

**Status:** Accepted on the owner's instruction of 2026-09-16 (CR-020 §7).

**Relates to:** [CR-020](../change-requests/CR-020-OBSERVABILITY-ERROR-TRACKING-AND-FEATURE-USAGE.md), `src/lib/observability/logger.js` (SDD-048, NFR-017, SEC-009), [ADR-086](ADR-086-PROGRAMME-DELIVERY-TELEMETRY.md) D7 (privacy discipline precedent for a detail block), [ADR-092](ADR-092-TIME-BOXED-MEMBER-VIEW-OF-THE-PROGRAMME-ROADMAP.md) (the precedent for stripping a per-person breakdown before it reaches a wider audience — the opposite move this decision does NOT take, on the owner's explicit instruction).

## Context

A full survey of every log surface in the system (prompted by the owner asking what is logged) found seven surfaces, none of which answer two questions: "where did this error happen, and how often" and "which page or feature is actually used, by whom." [CR-020](../change-requests/CR-020-OBSERVABILITY-ERROR-TRACKING-AND-FEATURE-USAGE.md) proposed closing both gaps and laid out the options. The owner's answer (CR-020 §7, 2026-09-16):

- Error tracking: extend the existing logger, not a third-party service.
- Feature usage: both route level and action level, and **per person** — the more expensive, more privacy-sensitive of the two axes CR-020 asked about, not the aggregate-only starting point CR-020 proposed as the safe default.

This decision records the shape both take, because "per person" is a real trade-off worth writing down rather than silently building, matching the discipline ADR-086 D7 and ADR-092 already established for this codebase's other measurement surfaces.

## Decision

### D1 — Error tracking extends the logger; it does not replace it

`src/lib/observability/logger.js` gains one new function, `exception(error, fields)`, beside the existing `debug`/`info`/`warn`/`error`. `src/lib` stays free of a Prisma dependency by existing convention (no sibling file there imports `@/lib/db`), so `exception()` does the parsing and returns a shape a caller persists — it does not reach into the database itself:

1. Emits exactly as `error(...)` does today — same allowlist, same stdout sink, nothing about the ephemeral log changes.
2. Computes a **fingerprint**: `sha256(error.name + ':' + error.message + ':' + firstStackFrame)`, where `firstStackFrame` is the first `file:line` pair parsed out of `error.stack`. Two errors with the same fingerprint are the same defect recurring, not two defects.
3. Returns `{ fingerprint, name, message, frames }` alongside the usual emitted record. A caller that wants the error persisted (every route-boundary catch does) calls `recordErrorEvent(db, logger.exception(error, fields))` — one new service in `application/`, which upserts by fingerprint: a new fingerprint inserts a row with `occurrenceCount: 1`; an existing one increments the count and updates `lastSeenAt`, leaving `firstSeenAt` untouched.

**What is captured, and why it is safe under the existing allowlist discipline (SEC-009, SDD-048):**

| Field | Source | Why it is safe |
|---|---|---|
| `name`, `message` | `error.name`, `error.message` | This codebase already throws typed, coded errors with static messages — `httpError(503, 'SESSION_UNAVAILABLE')`, `new Error('QUEUE_UNAVAILABLE')`, `'LINE_TEXT_TOO_LONG'` — confirmed by survey, not assumed. A message is a system-chosen code, never interpolated user input, by the same convention every route handler in this tree already follows |
| `stack` | `error.stack`, parsed into `{file, line, function}` frames | V8 stack traces (this runtime) carry call-site locations only — no local variable values, unlike some other languages' traces. Parsed rather than stored raw, so a frame that fails the `file:line` shape is dropped rather than stored as free text |
| the existing allowlisted `fields` | caller-supplied, same as `error()` today | unchanged |

**What is never captured:** request/response bodies, tool output, any field outside `ALLOWED_FIELDS` — identical to every other call through this emitter.

**Read surface:** operator-only, under `/control`, grouped by fingerprint with occurrence count, first/last seen, and a **resolve** action (`resolvedAt`, `resolvedByPersonId`) so a fixed defect stops surfacing as active. This is deliberately closer to `AuditEvent`'s shape (one durable table, operator-readable, a `GET` route with a cap) than to a hosted APM dashboard, because D1 chose not to add one.

### D2 — Feature usage: route and action level, per person

One model, `UsageEvent`, covers both levels the owner asked for:

- `kind`: `'PAGE_VIEW'` or `'ACTION'`.
- `route` (page path) for `PAGE_VIEW`; `actionName` (a short static label the calling code chooses, e.g. `'roadmap.sign_out'`) for `ACTION` — never a free-text label built from request data.
- `personId`, `sessionId` — the same identity a `Session` row already carries; no new identity concept.
- `occurredAt`.

**Two capture paths, both fire-and-forget:**

- **Page views**: a client hook mounted once in each shell (`PlatformControlShell`, and the Business shell in a later slice) reads `usePathname()` and posts on every route change.
- **Actions**: a small helper (`recordAction(name)`) any button handler can call. **This ships as an adoptable primitive, not a completed audit of every control in the product.** Instrumenting every click across the whole application is not one change; FR-249 below declares the mechanism and a first set of call sites, and adoption elsewhere happens incrementally, the same way `@req` annotation coverage or the route-anchor baseline grew — a shrink-only or grow-only list, never a claim of completeness on day one.

**Read surface:** operator-only (matching D1 and every other measurement surface in this lane), broken down by route/action and by person, the same shape ADR-086/ADR-087 already show for lane usage.

### D3 — Retention bounds the per-person exposure automatically

Raw, person-attributed `UsageEvent` rows live **90 days**, matching this codebase's existing default for person-adjacent content (`RawExternalRecord` payload text, MSP session content, `AgentTraceEvent` payload — ADR-091 §98–101). After 90 days a daily rollup keeps only `(date, route|actionName, count)` with no `personId` — the per-person question is answerable for 90 days, the aggregate trend forever, and nothing person-attributed is retained indefinitely by construction. `ErrorEvent` is not person-attributed at all, so it carries no equivalent window in this decision; its own retention is an operational question, not a privacy one.

### D4 — No consent gate; a stated privacy note instead

`UsageEvent` and `ErrorEvent` behave like `AuditEvent` and access history already do for every signed-in account today: no separate consent screen, no opt-out, because these are internal operational records of an internal tool's own signed-in users, not data collected from an external customer. The operator-facing page carries a stated privacy note (what is collected, at what level, for how long) so the boundary is visible rather than assumed. This is a design default from CR-020 §7, not something the owner was asked to confirm line by line; it is written here so it is easy to challenge and change rather than silently baked in.

### D5 — Owned by `platform-control`

Every existing measurement surface in this system — the usage meter (ADR-086), the harness plugin (ADR-087), the member view (ADR-092) — already lives in `platform-control`, reads through the same operator-only guard, and follows the same allowlist discipline this decision extends. `ErrorEvent` and `UsageEvent` join `ProgrammeUsageReport` as this lane's persistence models.

## Consequences

- The system gains a queryable, operator-visible error log for the first time — the exact gap that made diagnosing this session's own CI failures slower than it needed to be.
- `UsageEvent` is the first model in this codebase that exists specifically to record what a person *read*, not what they *wrote*. It sits in the same lane and under the same guard as everything else that already reports on individual people (ADR-086/D3, ADR-087/D4), so it does not introduce a new authorization pattern — but it is a new category of fact about a person, and D3/D4 exist because of that, not as boilerplate.
- Action-level coverage will be partial for a long time by design (D2); a reader of the usage dashboard must not read an absent action as "nobody does this" — it may mean "not instrumented yet." The dashboard states this explicitly.
- `logger.exception()` is new API surface; existing `logger.error()` call sites are unchanged and untouched by this decision.

## Alternatives rejected

**A third-party error tracking service (Sentry or similar).** Rejected by the owner (CR-020 §7, option A over option B): keeps error data inside this system's own database rather than a third party, no new billing dependency, consistent with how this codebase has built every other measurement surface itself.

**Aggregate-only feature usage, no `personId`.** This was CR-020 §3.3's proposed safe minimum. Rejected by the owner in favour of the more capable, more privacy-sensitive per-person option CR-020 §3.2 offered as an alternative — recorded here so the road not taken, and why, stays visible.

**Route-level only, deferring action-level.** Also rejected; the owner asked for both levels together (CR-020 §7: "เก็บทุกระดับ").

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-16 | accepted | `logger.exception()` + `ErrorEvent` (fingerprinted, deduped, resolvable); `UsageEvent` at route and action level, per person, 90-day raw retention then aggregate-only rollup; no consent gate, operator-only read surface; both models owned by `platform-control` | working-tree | Claude Sonnet 5 |
