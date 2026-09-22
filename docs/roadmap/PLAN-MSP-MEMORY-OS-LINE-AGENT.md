---
version: "0.1.3b"
created_at: "2026-09-14T09:00:00+07:00,Claude Opus 5"
last_update: "2026-09-22T00:00:00+07:00,Codex"
status: "beta"
superseded_by: null
attributes:
  domain: "agent-memory"
  doc_type: "implementation-plan"
  scope: "MSP as the memory OS of the LINE OA agent — ordered work plan, TASK-MEMOS-001..010"
---

# Implementation plan — MSP as the memory OS for the LINE agent

## สรุปภาษาไทย

เป้าหมายคือทำให้ MSP เป็นระบบความจำ (memory OS) ของ agent บน LINE OA จริง ได้แก่
ความจำต่อเนื่องภายในแชท การสรุป session และความจำถาวรรายบุคคลข้ามแชท โดยไม่ละเมิด
isolation ระหว่างผู้ใช้ งานเรียงตามลำดับที่ LINE agent ต้องการก่อน:

1. ตัดสินเรื่องการรวม branch `codex/msp-thread-memory` กับ design ของ MSP
2. ทำให้ thread memory ปลอดภัยพอ merge
3. จัดการ participant เมื่อบัญชี LINE ถูกผูกกับ Person ใหม่
4. การลบข้อมูลตาม PDPA
5. พิสูจน์ contract ผ่าน MSP จริง
6. เปิดใช้แบบ canary บน LINE หนึ่งบัญชี
7. สรุป session บน production
8. vault รายบุคคล
9. ความจำข้ามแชท

**มีการเปิด flag ใน controlled production candidate แล้ว แต่ยังไม่ถือว่า
TASK-MEMOS-006 ผ่าน** ตัวแปร `ZURI_MSP_THREAD_MEMORY_ENABLED` เปิดเพื่อพิสูจน์
activation/boundary เท่านั้น; authenticated memory canary, erasure, rollback
และ owner acceptance ยังไม่ผ่าน จึงห้ามประกาศว่า production memory พร้อมใช้งาน
เต็มรูปแบบ

## Controlled activation evidence — 2026-09-22

- Candidate production เปิด `ZURI_MSP_THREAD_MEMORY_ENABLED=true` พร้อม
  `agentId`/`workspaceId` binding และ explicit MSP private-grant/HMAC controls.
- Direct pinned-MSP process ผ่าน initialize, ping, resolve, human append และ
  context retrieval; forged agent/principal context ถูกปฏิเสธด้วย
  `thread_scope_denied`.
- Signed live loopback ถูก admit ด้วย `memorySyncOptIn=true` แต่ worker ยังสร้าง
  MSP delivery/context receipt ไม่ได้ เพราะ dedicated
  `zuri_line_smartgift_login` credential authentication ล้มเหลว (`28P01`) หลัง
  แก้ pooler username ให้มี project reference แล้ว
- ดังนั้น TASK-MEMOS-006 อยู่สถานะ **BLOCKED — production boundary proven,
  end-to-end memory canary not accepted**. ห้ามเปลี่ยนเป็น done จนกว่าจะมี
  multi-turn recall หลัง restart, erasure invalidation และ rollback receipt
  ครบถ้วน

## Why this plan exists

The LINE OA agent is not yet backed by MSP memory. The facts below come from zuri-ai `origin/main` and MSP `origin/main` as of 2026-09-14.

**What runs today.** Every LINE turn uses the in-memory port and public knowledge only. zuri-ai keeps conversation history itself, in `Conversation` and `Message`.

**What is written but not running.**
- The worker path already calls six `msp_thread_*` tools through `apps/server/src/modules/agent/msp-thread-memory-port.js`.
- Those calls run only when `ZURI_MSP_THREAD_MEMORY_ENABLED=true` and `ZURI_MSP_COMMAND` and `ZURI_MSP_THREAD_SERVICE_KEY` are also set. [GENESISRAG17-EDGE-DEPLOYMENT](../plans/GENESISRAG17-EDGE-DEPLOYMENT.md) keeps them unset.
- The API-009 and API-010 ports (`msp-memory-port.js`, `msp-vault-resolver.js`) are composed only in tests.

**What MSP actually has.**
- MSP `main` registers none of the six thread tools and no `msp_vault_resolve`.
- The thread tools exist only on the unmerged MSP branch `codex/msp-thread-memory` (commits `50859fb`, `e4303cb`, 2026-09-08).
- Over real stdio the feature is inert either way. Neither zuri-ai's MSP transport allowlist nor MSP's client allowlist passes `MSP_THREAD_SERVICE_KEY`, so every thread call is denied.

**Two sources that disagree.** MSP holds a merged design for session, episodic and passport memory: [`docs/DESIGN-SESSION-EPISODIC-INSTANCE-MEMORY.md`](https://github.com/Freshair129/Memory-and-Soul-Passport/blob/main/docs/DESIGN-SESSION-EPISODIC-INSTANCE-MEMORY.md), v0.2.3b. It was written without knowledge of that branch, and the two collide in three places:
- **API number.** The branch labels thread memory API-010. ADR-022 and the MSP design both use API-010 for `msp_vault_resolve`.
- **Migration numbers.** Both claim 0008.
- **`msp_thread_resolve` shape.** Each defines a different one.

The MSP tech-lead review (RKOI, 2026-09-14) compared the two clause by clause. Its conclusions:
- **The branch's tool shapes should become the canonical thread surface**, renumbered to API-011. It is the contract zuri-ai already calls, and it is stronger than the design in delivery receipts, injection receipts, cited CANDIDATE summaries, leased compaction and explicit coverage gaps.
- **The branch cannot merge as it stands.** It has two CRITICAL findings:
  - A second person who becomes a VERIFIED participant of a DIRECT thread can read the first person's history and inherit records planted about them. One way this happens is a LINE account relinked to another Person, which ADR-045 permits.
  - The authorization guard runs database reads inside MSP's contracts layer.
- **The fixes change no field zuri-ai sends.**

Priority here means what the LINE agent needs first in order to have safe memory at all, then what makes that memory useful across threads.

## Task id family

These tasks use their own family, `TASK-MEMOS-001..010`, not `TASK-ZAI`, and the choice is deliberate.

- **`TASK-ZAI` belongs to the 24-week programme.** Every TASK-ZAI id there carries a sprint (`SPR-ZAI-*`), a task container (`TC-TASK-ZAI-*`) and an entry in `apps/server/src/modules/platform-control/program-roadmap-data.js`.
- **This plan has not been scheduled into a sprint yet.** Borrowing the programme's next numbers would collide with its next allocation. That already happened on 2026-09-14: the data pipeline map took TASK-ZAI-060..063 while this plan was being written.
- **If the programme adopts this work later,** record the programme id against each row and keep `TASK-MEMOS-*` as the stable key. Do not renumber it.

## Ordered work

| Order | Task | Deliverable | Proof | Repos |
|---|---|---|---|---|
| 1 | TASK-MEMOS-001 | Reconciliation decision record: owner decisions below, MSP ADR (API-010 = `msp_vault_resolve`, API-011 = thread surface, migration order), MSP design v0.3.0b rewritten around API-011 | ADR merged in MSP; design sections 6–11 and 13 no longer contradict the branch contract | MSP (docs); zuri-ai comment/test-title rename of "API-010" on the thread port, optional |
| 2 | TASK-MEMOS-002 | MSP thread memory hardened and merged as one corrected migration 0008. Closes C-1: participation changes only under an explicit claim, `left_at IS NULL`, one human per DIRECT thread for life, non-HUMAN kinds never readable, assurance upgrade only by the principal, protected-record subject bound to the asserter. Closes C-2: guard lookups move out of `msp-contracts`. Also: caller `now` test-only, tenant-scoped uniqueness, raw ids out of the append-only journal, typed error codes, contract renamed to API-011. | MSP security suite reproduces and refuses each RKOI probe (second-participant read, UNKNOWN-kind bypass, PENDING self-upgrade, planted record, lease theft, cross-tenant resolve); `npm test` + integration green; RKOI approval | MSP; zuri-ai one line: `MSP_THREAD_SERVICE_KEY` added to the transport's env allowlist |
| 3 | TASK-MEMOS-003 | Participant lifecycle: an MSP tool to leave or relink a participant under an explicit claim; zuri-ai calls it on Person relink/merge and on Membership revocation (ADR-022 D8, ADR-045) | cross-repo test: relinked LINE account's new Person cannot read the old DIRECT thread; revoked Membership denies the next turn | MSP + zuri-ai |
| 4 | TASK-MEMOS-004 | Thread memory erasure and retention. Tombstones replace the blanket immutability triggers. Erasure covers messages, delivery and pending-delivery receipt text, summaries, protected records and journal pseudonyms. zuri-ai's PDPA erasure (FR-022) calls it. **Gate for any production opt-in.** | direct-database assertion after erase (no content of the erased person in any thread table) plus tool-level invisibility; idempotent erase | MSP + zuri-ai |
| 5 | TASK-MEMOS-005 | Real-process contract proof. A zuri-ai acceptance test spawns the real MSP and exercises all six thread tools with signed grants over stdio, including fail-closed without the key. Settles the items RKOI could not verify: whether `externalThreadId` is a raw LINE id (and HMAC-at-rest for room refs), and zuri-ai's handling of `PENDING_INBOUND` delivery results. | acceptance test green against MSP `main` after TASK-MEMOS-002; findings recorded | zuri-ai (+ MSP fixes if found) |
| 6 | TASK-MEMOS-006 | Controlled LINE canary. Opt in `ZURI_MSP_THREAD_MEMORY_ENABLED` for one DIRECT LINE OA account on the ADR-061 server runtime, with an MSP database, service key and rollback runbook. | evidence: multi-turn recall across worker restart; no cross-person read; erasure invalidates recall; rollback to public-knowledge-only verified | zuri-ai (operator step) |
| 7 | TASK-MEMOS-007 | Session summaries in production. The LINE worker hosts the MSP summary worker (sweep, claim, commit, retry with lease and source digest), so `threadSummaries` stop being empty and `coverageGap` is handled in the prompt. | long thread fixture: summary cited by source message refs; coverage gap surfaced, never silently truncated | zuri-ai + MSP |
| 8 | TASK-MEMOS-008 | Principal vaults and API-010 `msp_vault_resolve`: MSP design WP-E1 (vault types, access context on API-009, pinned passport vault); zuri-ai `msp-vault-resolver.js` request shape reconciled with MSP API-010 | MSP principal-vault scoping suite; zuri-ai resolver contract test against the real MSP | MSP + zuri-ai |
| 9 | TASK-MEMOS-009 | Cross-thread and permanent memory: confirmed protected records and summary items consolidate into the person's episodic and passport vaults under that person's own access context only; the LINE context assembler adds the passport slice with the FR-171-P2 evidence envelope | same person recalled in a second LINE thread; group-thread content never crosses into a private thread; erasure removes consolidated facts | MSP + zuri-ai |
| 10 | TASK-MEMOS-010 | MSP migration-runner follow-ups: merge MSP PR #19 (**done 2026-09-14, merge commit `ad83bc0`**), record the "no foreign key into FTS5/rtree shadow tables" migration policy, make the rtree runner test skip when the module is absent | MSP CI green; policy line in MSP `docs/MIGRATION.md` | MSP |

Deferred, no task yet: instances and an agent leg for interactive web/CLI clients (MSP design §7). Server channels use the signed per-room grant as the recorded relation instead.

## Owner decisions required before TASK-MEMOS-002

These are the ten decisions from the RKOI reconciliation. TASK-MEMOS-001 records the answers.

1. **API numbering:** API-010 stays `msp_vault_resolve` (ADR-022) and the thread surface becomes API-011.
2. **Canonical thread surface:** the branch's tools (recommended) or the MSP design's tools. Choosing the design means rewriting zuri-ai's thread port, context assembly and delivery scanner.
3. **Interactive clients:** instances and the agent leg are dropped for server channels (recommended) or kept.
4. **Identity changes reach MSP:** Person relink/merge and Membership revocation reach MSP through an explicit participant call. This is a cross-repo commitment that closes C-1.
5. **Erasure gates activation:** TASK-MEMOS-004 must land before any production opt-in.
6. **Room refs at rest:** stored as an HMAC in MSP, which makes an identity key a requirement.
7. **Migration order:** thread memory first as MSP 0008 (recommended), or vault types first.
8. **Where thread memory lives:** thread-scoped memory stays outside vaults, with MSP Gate A amended to "vault and thread isolation", or it must consolidate into principal vaults.
9. **Caller-supplied `now`:** test-only on every MSP tool.
10. **Extractive fallback:** whether the MSP design's fallback is still wanted alongside `coverageGap`.

## Exit gates for the phase

- A LINE DIRECT conversation on a server-enabled account recalls earlier turns across a worker restart, using MSP thread memory.
- No person can read another person's thread content or records, including after a LINE account is relinked. Group threads never leak into private context.
- Erasure removes a person's content from every MSP thread table, and recall stops on the next turn.
- The same person's confirmed facts are available in a second LINE thread, from their own vaults only.
- The rollback to public-knowledge-only has been exercised.

## Rollback

Unset `ZURI_MSP_THREAD_MEMORY_ENABLED` for the account. Jobs admitted after that point are not opted in and answer from public knowledge only. MSP data stays in place under its retention and erasure rules, and nothing in the Zuri CRM database changes.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.3b | 2026-09-22 | beta | Recorded controlled production activation and direct MSP boundary proof; TASK-MEMOS-006 remains blocked by the dedicated LINE runtime credential and incomplete canary gates | working-tree | Codex |
| 0.1.2b | 2026-09-14 | beta | Ordered MSP thread-memory and LINE-agent work; production opt-in held behind TASK-MEMOS-006 | working-tree | Claude Opus 5 |
