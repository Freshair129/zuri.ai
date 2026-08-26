---
name: zuri-schedule
description: Use when work in Zuri needs dates — build an appointment/schedule artifact and apply it to milestones, gates, work items and containers so it appears on Zuri's Timeline and Milestones views. Also covers the honest limits - Zuri has no calendar or appointment entity, and mirroring to an external calendar is a separate, confirmed step. Triggers - "schedule this in zuri", "add dates/deadlines", "set the timeline", "book the review meeting", "ลงตารางนัดหมาย", "ใส่กำหนดการใน zuri".
---

# Put a schedule into Zuri

## Read this before you promise anything

**Zuri has no calendar object, no appointment record, and no calendar API.** There is no
`Meeting`, `Appointment` or `Event` model, and no endpoint that creates one. The LINE
appointment action (Phase 6 of the LINE OA agent roadmap, with its action gateway,
step-up approval and calendar provider) is *planned, not built*.

What Zuri does have is **dated work**, which its Timeline and Milestones views render:

| You want to represent | Put it on | Fields |
|---|---|---|
| a deadline / a dated checkpoint | Milestone | `targetAt` |
| a decision or review that gates progress | Gate | `targetAt`, `status`, `evidence` |
| a scheduled piece of work | WorkItem | `startAt`, `targetAt` |
| a sprint / stage / phase / operating period | WorkContainer | `startAt`, `targetAt` |

So: a review meeting becomes a dated **Gate** (it decides something) or a dated
**Milestone** (it is a checkpoint), with the attendees and the agenda in `evidence` or
`metadata`. Say that plainly to the human instead of implying Zuri booked a meeting.

## Step 1 — the work must exist first

The PlanEnvelope carries **no** dates (only `project.targetAt`). So the order is always:

1. [zuri-execution-plan](../zuri-execution-plan/SKILL.md) creates the structure and
   commits it, giving every record a stable `code`;
2. this skill dates it.

Never create work here to "hold a date" — items and containers are created through the
envelope, in one transaction, with one audit event.

## Step 2 — write the schedule artifact

`schedule.json` — see [references/example-schedule.json](references/example-schedule.json):

```json
{
  "artifact": "zuri.schedule/1",
  "projectId": "<project id from Zuri>",
  "entries": [
    { "kind": "milestone", "code": "MS-CHK-CODE-FREEZE", "targetAt": "2026-10-15T17:00:00+07:00" },
    { "kind": "gate", "code": "GATE-CHK-SECURITY", "targetAt": "2026-10-20T10:00:00+07:00" },
    { "kind": "item", "code": "CHK-101", "startAt": "2026-09-01T09:00:00+07:00", "targetAt": "2026-09-12T18:00:00+07:00" }
  ]
}
```

Rules:

- **`code` is the match key.** Re-running the same file updates the same rows; it never
  creates a second copy.
- **Timestamps are ISO 8601 with a real offset** (`+07:00` for Thailand). A bare local
  time is a bug waiting to move by seven hours.
- One project per artifact. Dates that cross projects are separate artifacts.
- `startAt` applies to items and containers only; milestones and gates carry `targetAt`.

## Step 3 — plan, then apply

```bash
node skills/zuri-schedule/scripts/zuri-schedule.mjs plan  schedule.json
node skills/zuri-schedule/scripts/zuri-schedule.mjs apply schedule.json
```

`plan` writes nothing: it resolves every code against the project and prints `PATCH` /
`UNCHANGED` / `SKIP`. Read it before applying. `SKIP` means the code does not exist —
go back to the plan envelope; do not invent the record here. `apply --create` may create
**milestones** only, and only when the human asked for a new checkpoint.

## Step 4 — verify, do not assume

After applying, re-run `plan` (everything should read `UNCHANGED`) and open the project's
Timeline / Milestones view. Report the dates you set, in the business's own timezone.

## Mirroring to an external calendar

If the human wants the schedule in Google/Outlook, that goes through **your harness's own
calendar connector**, never through Zuri, and only under these rules:

- ask first, per batch, and show the exact events (title, start, end, attendees) before
  creating anything — creating a calendar event notifies other people;
- one way only: Zuri stays the system of record; never write a calendar id back into Zuri
  as if it were an approved external ref unless the human asked for that mapping;
- if no calendar connector is authorized in this harness, say so and hand the human the
  list of dates — do not improvise a workaround.

## Never

- Never claim Zuri "created an appointment" — it dated a milestone, gate or item.
- Never park a date in a description string because no field exists for it.
- Never re-create dated records that already exist; match by `code` and PATCH.
