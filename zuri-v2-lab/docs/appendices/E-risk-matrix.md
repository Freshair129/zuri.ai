# Appendix E — Risk Matrix

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Draft |
| **Last Updated** | 2026-08-11 |

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| RSK-001 | วาง tenant ผิดตอน onboarding (แยก tenant แล้วอยากแชร์ CRM ทีหลัง — ย้ายยาก) | M | H | คำถาม onboarding "ใช้ฐานลูกค้าร่วมไหม" ตัดสิน tenant placement (BR-001); เอกสาร UX-SINGLE-VS-MULTI-BUSINESS |
| RSK-002 | PDPA: ใช้ข้อมูลลูกค้าข้ามแบรนด์โดย consent ไม่ครอบคลุม | M | H | SEC-005: consent ต่อธุรกิจใน CustomerBusinessProfile (เฟส CRM); ห้าม backdoor ข้าม tenant |
| RSK-003 | Enterprise เอา external ID มาใช้เป็น code ตรง ๆ แล้ว ID ชนข้าม system | M | M | ExternalRef แยก namespace + `labelAs` (ENTERPRISE-API-SURFACE) |
| RSK-004 | Migration ค้าง: ข้อมูล validate ไม่ผ่านแต่ทีมเดินงานต่อ | M | M | GATE-DATA-ID + dependency BLOCKS ปลดล็อกงานเมื่อผ่านเท่านั้น (seed เป็นตัวอย่าง) |
| RSK-005 | Restore snapshot ทับข้อมูลโดยไม่ตั้งใจ | L | H | BR-008 preview+confirm บังคับ; audit RESTORED |
| RSK-006 | ~~Spec conflict AGENTS.md §1~~ **ปิดแล้ว 2026-08-11** — เจ้าของยืนยัน standalone, แก้ต้นทาง + ฝัง resolution note ใน spec-pack AGENTS.md | ปิด | — | done |
| RSK-007 | Playwright pinned chromium ดาวน์โหลดไม่ได้บนเครื่องนี้ | เกิดแล้ว | L | fallback executablePath ใน playwright.config.js; เครื่องปกติ `npx playwright install chromium` |
| RSK-008 | Doc drift: เอกสารสองชั้น (spec pack vs lab docs) แก้ไม่ตรงกัน | M | M | `.doc-graph.json` + rwang:doc-preflight ตรวจ; PRD-SDD ระบุ source docs ชัด |
| RSK-009 | SQLite writer lock เมื่อรัน parallel tests | L | L | vitest fileParallelism:false + test.db แยก |
