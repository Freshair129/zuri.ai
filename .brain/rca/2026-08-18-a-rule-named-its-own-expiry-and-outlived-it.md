---
version: "0.1.0b"
created_at: "2026-08-18T20:10:00+07:00,CLAUDE"
last_update: "2026-08-18T20:10:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "doc-governance"
  doc_type: "root-cause-analysis"
  scope: "a rule stated the condition that would make it false, the condition occurred, and nothing was watching"
---

# RCA — a rule named its own expiry date and then outlived it

## Symptom

An audit of the eleven rules with no code anchor found SEC-004 reading:

```
| SEC-004 | MVP ไม่มี customer PII ในระบบ | ✅ by scope — เป็นจริงเฉพาะวันนี้:
           ADR-003 พา LINE เข้ามาเป็น surface หลัก ข้อความลูกค้าคือ PII
           ต้องรื้อข้อนี้ก่อนงาน LINE เริ่ม (TASK-V2-LINE-INTENT) |
```

The row states the condition under which it stops being true, and instructs that
it be torn up *before* LINE work begins.

LINE work began, finished, and shipped: FR-047, FR-052, FR-053 and FR-079 are all
in the registry with code and tests. `prisma/schema.prisma` carries `Customer`,
`Conversation` and `Message`. Customer messages are PII and have been in the
system since.

Nobody tore it up. The row still read **✅**.

## Why this is worse than an unimplemented rule

A rule marked 🔜 advertises a gap and gets read as work. A rule marked ✅ ends
the conversation — the reader moves on. SEC-004 was a claim about the absence of
personal data, and it was answering "yes, handled" to anyone auditing PII scope,
including me until I read the third column.

The failure is not that the claim became false. Claims about scope are *supposed*
to become false as scope grows; SEC-004 knew that about itself. The failure is
that nothing connected the event to the row.

## Root cause

The registry has no notion of a **conditional rule**. A row can say "true until
X" in prose, but `X` is not a thing the system can watch. SEC-004 named its
trigger as a task string (`TASK-V2-LINE-INTENT`) and a narrative — neither is an
id the graph resolves, so no check could ever have compared the trigger's state
against the rule's state.

## Why nothing caught it

1. **The coverage metric hid it in a crowd.** `rules anchored in code` counted
   SEC-004 among eleven unanchored rules, alongside rules that are unanchorable
   by declaration and rules whose FRs are still 🔜. One number summed three
   unrelated states, so the list it produced was noise, and nobody read down it.
2. **Anchoring and truth are different questions.** A rule can be anchored by
   code and still be false, or unanchored and perfectly true. The only metric the
   repository keeps for rules measures the first.
3. **The status column is free text.** `✅ by scope` parses as `done` to the
   graph reader; the caveat that follows it is prose the parser never sees.

## This is a family, not one row

Grepping the registry for conditional validity found three more, and they show
the full range:

| Rule | Condition it waits on | State today |
|---|---|---|
| **SDD-037** | *"Until FR-067 ships:"* | **correct.** Names a requirement id, states both tenses explicitly, and FR-067 is still 🔜 — so the rule has not expired and its trigger is checkable |
| **NFR-008** | *"V1 module ที่ lift ยังคง parity boundary จนกว่าจะ cutover"* | waits on an event ADR-024 D1 decided will **never occur** (*"no module will be lifted… no tenant cutover will ever occur"*). Permanently suspended, not pending |
| **SDD-023** | *"until ZV2-CR-001 parity/rollback gates pass"* | **needs a human.** `TASK-FR-045`, which cites ZV2-CR-001, is `done (beta)` — which is not the same as "gates passed". Whether this clause has expired is a judgment call, not a lookup |

SDD-037 is the model: it names the trigger as an **id**, and it writes both
tenses in the row so the successor state is already drafted when the trigger
fires. SEC-004 named a task string and a paragraph.

## What was fixed

SEC-004 is retired, with SEC-005 (consent — still unbuilt), SEC-009 and FR-022
named as what governs customer PII now, and emitting real `supersedes` edges so
the successor is answerable from the graph. The id is burnt, never reused
(AGENTS.md §18).

The metric that hid it now excludes retired rules the same way it already
excluded 🔜 FRs, so the remaining list means one thing. NFR-008 and SDD-023 are
deliberately **not** touched here: retiring a rule is a decision about what
governs a subject, and making it as a side effect of an audit is how the wrong
thing gets burnt.

## Prevention

A conditional rule should name its trigger as an id the graph already resolves —
`FR-xxx`, `ADR-xxx` — rather than a task string or a sentence. That makes the
check mechanical and small:

- a rule whose row says *until/จนกว่า/ก่อน* must cite a resolvable id;
- if that id's status is `done`/✅, the rule's own status must not still be ✅
  without a revision date later than the trigger's.

That is a WARNING, not a CRITICAL: expiry is a prompt to re-read, and a human
decides what the row becomes. The failure this prevents is not "wrong status",
it is **nobody being told to look**.

Not implemented here. The audit that produced this RCA is the manual version of
it, and the three rows above are what it would have flagged.

## The transferable lesson

The repository is good at proving that a rule is *enforced* — annotations,
anchors, ratchets, planted defects. It has nothing that asks whether a rule is
still *true*. Those are different failures, and the second one is quieter,
because a false rule marked ✅ produces no error anywhere: not in tests, not in
the build, not in preflight. It produces a reader who stops asking.
