# GoVibe Integration — zuri.ai under GoVibe governance

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Active |
| **Author** | Owen + Claude |
| **Created** | 2026-08-12 |
| **Last Updated** | 2026-08-12 |

## ความสัมพันธ์ของสองระบบ

| | **GoVibe** (`G:\govibe`) | **zuri.ai** (repo นี้) |
|---|---|---|
| บทบาท | Governance + interoperability layer สำหรับ multi-agent development (meta-layer) | ผลิตภัณฑ์ธุรกิจ: Zuri v2 Project Manager (product) |
| ความรู้ | Knowledge atoms + vault 3 ชั้น + compaction hierarchy | 3-layer docs (PRD-SDD) + doc-graph + @req annotations |
| Agent contract | AGENTS.md v1.11 (C/H/R/D/W axes, named agents LYRA/THESEUS/ATHER/GHOST) | AGENTS.md (กฎ 15 ข้อของ build) + PlanEnvelope contract |
| Zuri V1 | vendor ไว้ที่ `ref/` เป็น reference workspace + case study | อ้างเป็น read-only reference (`G:\zuri`) ตาม ADR-001 |
| ทดสอบ | 618 tests + 65 security | 75 Vitest + 20 Playwright |

**ทิศทาง governance**: GoVibe เป็น meta-layer — งานพัฒนา zuri.ai สามารถถูก plan/route/audit
ผ่านกลไกของ GoVibe (LYRA วาง roadmap, tiered SLM routing, impact engine) ในขณะที่
zuri.ai คงเป็นเจ้าของ product truth ของตัวเอง (doc-graph + acceptance ในรีโปนี้)

## สิ่งที่ลงทะเบียนเข้า GoVibe แล้ว (2026-08-12)

ผ่านช่องทาง intake ที่ถูกต้องของ GoVibe (`.brain/inbound/` — candidate รอ
decomposition gate; **ไม่**เขียนตรงเข้า knowledge block ตามกฎ vault):

| Candidate | เนื้อหา |
|---|---|
| `SYS--ZURI-V2-LAB.md` | ตัวตนระบบ, hierarchy เทียบ compaction model (`SYS--ZURI-GLOBAL → SYS--ZURI-V2-LAB → MOD--PROJECT-MANAGER → FEAT--*`), กฎสถาปัตยกรรม 5 ข้อที่ agent ต้องรู้, decision pending (v1 module vs v2 foundation) |
| `CONCEPT--UNIFIED-INTAKE-PIPELINE.md` | Pattern 4 surfaces → 1 envelope → validate/dry-run/commit — generalize ได้กับ intake ของ GoVibe เอง |

ขอบเขตที่**ไม่**แตะใน GoVibe (ตามกติกาของเขา): `.rwang/` (thin overlay, frozen),
`docs/` (governed โดย DOC-VERSION-REGISTRY), owner materials, canonical standards
(hash-locked ใน `.governance/`)

## Compaction ID mapping (สำหรับอ้างอิงข้ามระบบ)

```text
SYS--ZURI-V2-LAB
├─ MOD--PROJECT-MANAGER          = src/modules/project-manager/
│  ├─ FEAT--SCOPE-HIERARCHY      = FR-001..002 (+BR-001)
│  ├─ FEAT--EXECUTION-MODES      = FR-003..009 (+BR-003..004)
│  ├─ FEAT--PROGRESS-ENGINE      = FR-010..011 (+BR-005..006)
│  ├─ FEAT--PLAN-IMPORT          = FR-012 (+BR-007, BR-009)
│  ├─ FEAT--SNAPSHOT-BACKUP      = FR-013 (+BR-008)
│  └─ FEAT--INTAKE-SURFACES      = FR-017..019 (planned)
└─ CONTRACT--PLAN-ENVELOPE       = contracts/plan-envelope.schema.json
```

## งานที่เหมาะให้ GoVibe route (tiered SLM)

| งาน | Tier แนะนำ | Verify gate |
|---|---|---|
| แปลง xlsx→envelope (FR-018 converter) | T1 (local coder) | dry-run รายแถวต้อง valid |
| สร้าง PlanEnvelope จากเป้าหมายผู้ใช้ (planning agent) | T2–T3 | `zPlanEnvelope` + semantic validation ผ่าน |
| ตรวจ doc drift (doc-graph hashes) | T0–T1 | preflight report ไม่มี CRIT |
| Impact analysis ก่อนแก้ schema | impact-engine ของ GoVibe | traceability matrix อัปเดต |

## ขั้นถัดไป

1. รอ GoVibe gate ตัดสิน candidate ทั้งสอง (promote → knowledge block)
2. เมื่อเริ่ม FR-017 (wizard) — ให้ LYRA จัดเข้า roadmap ของ GoVibe ได้ถ้าต้องการ
   ให้การพัฒนา zuri.ai อยู่ใต้ masterplan เดียว
3. Zuri V1 `ref/` ใน GoVibe ควรเพิ่ม pointer มายัง repo นี้ (รอ owner เพราะ ref/ เป็น
   vendored area)
