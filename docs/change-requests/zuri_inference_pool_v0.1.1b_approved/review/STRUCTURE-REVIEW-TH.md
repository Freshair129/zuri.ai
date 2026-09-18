# ตรวจโครงสร้างเอกสาร Zuri ก่อนร่าง Inference Pool

วันที่ตรวจ: 17 กันยายน 2026  
Repository: `Freshair129/zuri.ai`  
Snapshot: `cfd5521e7d004e63ffead1e07f46045f1cdc06f2`  
สถานะ: ตรวจเฉพาะส่วนโครงสร้าง เทมเพลต เจ้าของ domain และจุดเชื่อม LINE/LLM ที่เกี่ยวข้อง ไม่ใช่ audit ทั้งรีโป

## ข้อสรุป

Zuri ใช้โครงสร้างเอกสารตาม domain พร้อมทะเบียน requirement กลาง ไม่ใช่สร้าง PRD/SRS/TDD ชุดใหม่แยกจากของเดิมทุกครั้ง การเปลี่ยน execution/provider policy ครั้งนี้ควรมี ADR หนึ่งฉบับ ข้อกำหนดใหม่แยกตามเจ้าของงาน แผน handoff รายเฟส และ runbook พร้อม acceptance evidence โดยเก็บแหล่งความจริงของ ID ไว้ในทะเบียนเดิม [G01] [G05] [G14]

## โครงสร้างที่ตรวจพบและต้องใช้ต่อ

| ตำแหน่ง | บทบาท | วิธีใช้ในงานนี้ |
|---|---|---|
| `AGENTS.md`, `CLAUDE.md`, `llms.txt` | กฎและทางเข้ารีโป | ตรวจทุกครั้งก่อนนำเข้าจริง |
| `docs/PRODUCT.md` | ขอบเขตผลิตภัณฑ์ | ไม่สร้างผลิตภัณฑ์ใหม่เพราะเพิ่ม GPU |
| `docs/PRD-SDD-v1.0.md` | ทะเบียน FR/NFR/BR/SEC/SDD กลาง | เพิ่มแถวที่อนุมัติ ห้ามแทนที่ไฟล์ทั้งฉบับ |
| `docs/FEATURES.md` | FEAT รวมหลาย FR | เพิ่ม bundle ใหม่ ไม่ดึง FR-149/150 ออกจาก FEAT-019 |
| `docs/.id-ledger.json` | ตรึงความหมายของ ID | ใช้ writer ที่โครงการกำหนด ห้ามแก้เองให้ CI เขียว |
| `docs/decisions/` | ADR | บันทึกการเปลี่ยนบทบาท Edge/Server และ trust boundary |
| `docs/domains/<domain>/CHARTER.md` | เจ้าของ model/code/route | ขยายเฉพาะส่วนที่จำเป็น ไม่สร้าง domain ใหม่โดยอัตโนมัติ |
| `docs/domains/<domain>/features/` | FR note และ phase note | วาง requirement ใน domain เจ้าของจริง |
| `docs/roadmap/` | แผนและหลักฐานการส่งมอบ | แยก docs/software/hardware/production gates |
| `docs/runbooks/` | ขั้นตอนใช้งานและ rollout | qualification, canary, drain, rollback |
| `docs/templates/` | ADR / FR / FR-PHASE | ใช้หัวข้อและ metadata ตามต้นฉบับ |

ตารางนี้อธิบายส่วนที่เกี่ยวข้อง ไม่ใช่รายชื่อโฟลเดอร์ทั้งหมดในรีโป [G01] [G24] [G25]

## เทมเพลตที่ใช้จริง

**ADR:** `Context` → `Decision` → `Alternatives and consequences` → `Verification` → `CHANGELOG` พร้อม `id`, version, status, author, attributes และ typed relations [G02]

**FR:** `Behavior and ownership` → `Input, output and failures` → `Acceptance criteria` → `CHANGELOG` พร้อม `feature`, domain, source และ relation กลับไป requirement/bundle [G03]

**FR-PHASE:** `Entry condition and predecessor` → `Input` → `Output and next handoff` → `Failure, retry and acceptance` → `CHANGELOG` พร้อม parent requirement, phase ID/order และ domain [G04]

Link metadata ใช้ namespace เช่น `ZAI:ADR-061` และชนิด relation เพียง `relates_to`, `references`, `supersedes`, `superseded_by`; phase ต้องเป็น ID เต็ม ห้ามตัดเหลือ parent อัตโนมัติ ส่วน backlink เป็นข้อมูล generated ไม่ใช่เขียนเอง [G05] [G06]

## เจ้าของงานที่ต้องรักษา

Integration เป็นเจ้าของ provider/connection/credential และการติดต่อภายนอก; Agent เป็น orchestration/provider consumer; LINE OA Studio เป็นเจ้าของ account/job/send lifecycle; Platform Control เป็นจอ operator-only ที่ถอดออกได้โดยไม่ทำระบบธุรกิจพัง ส่วน CRM/MSP/GKS มี authority ของตนเอง [G10] [G11] [G12] [G13]

จึงไม่เสนอ `Fastify + BullMQ` ซ้ำ ไม่สร้าง credential DB ชุดใหม่ และไม่เอาเงื่อนไขสุขภาพที่สำคัญไปฝากไว้ใน Grafana

## สิ่งที่ต้องระวังจากโค้ดและเอกสารเดิม

1. `SERVER + LOCAL_ONLY` เรียก deterministic model ไม่ใช่ vLLM จึงต้องเพิ่ม provider/policy อย่างชัดเจน [G16] [G17] [G18]
2. Edge มีทั้งตัวเรียกโมเดล tools/RAG/context ไม่ใช่ GPU runner ล้วน ๆ การเอา Edge ออกจาก LINE lane ต้องมี parity gate [G21] [G22] [G23]
3. Server worker มี parallel answer แล้ว แต่ send phase อาจรอ batch จบ จึงต้องทดสอบ slow-sibling/deadline ไม่ใช่แค่เพิ่ม concurrency [G19] [G20]
4. บาง charter ยังเขียนว่า context/grounding 'declared, not built' ขณะที่ code และ version history ใหม่บอกว่ามี implementation แล้ว ใช้ charter เป็น authority ของเจ้าของงาน ไม่ใช้คำว่า planned ที่ค้างอยู่เป็นหลักฐานว่าโค้ดไม่มี [G09] [G10] [G16]
5. AGENTS บางย่อหน้าพูดถึงการ commit corpus generated แต่ README/llms ปัจจุบันระบุ `llms-full.txt` ว่า build ไม่ commit ต้องยึดนโยบายล่าสุดของ branch ตอนนำเข้า ห้าม force-add ไฟล์เก่า [G01] [G24] [G25]
6. ทะเบียนมีประวัติเลข FR/ADR ชนระหว่างงาน parallel จึงไม่ใช้แค่เลขสูงสุดที่เห็นใน snippet มาจองเลขใหม่ [G07] [G09]

## รูปแบบไฟล์ที่ส่งมอบ

เอกสารหลัก 12 ฉบับเขียนเนื้อหาแล้วเป็น `.md.template` สถานะ candidate เว้นเฉพาะช่องเลข ID ที่ยังไม่ได้จอง พร้อมตัว render เป็น `.md` หลัง integrator ตรวจและกรอก mapping โดยไฟล์ต้นฉบับของทะเบียนจะไม่ถูกเขียนทับ

มีรายงานตรวจเอกสารภายในแพ็กและแผนทดสอบ 52 กรณี แต่ **ไม่ใช่ผลว่า 52 กรณีผ่านแล้ว** ทุกกรณี runtime ยังเป็น NOT RUN และยังต้องรัน `npm run govern`/verification บน checkout จริงหลังรวมเอกสารและประกาศ ID

## แหล่งอ้างอิงจากรีโป

[G01]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/AGENTS.md

[G02]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/templates/ADR.md.template

[G03]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/templates/FR.md.template

[G04]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/templates/FR-PHASE.md.template

[G05]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/GOVERNANCE-LINK-METADATA.md

[G06]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/contracts/doc-link-metadata.schema.json

[G07]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/.id-ledger.json

[G08]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/FEATURES.md

[G09]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/PRD-SDD-v1.0.md

[G10]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/domains/agent/CHARTER.md

[G11]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/domains/integration/CHARTER.md

[G12]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/domains/platform-control/CHARTER.md

[G13]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/domains/line-oa-studio/CHARTER.md

[G14]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/roadmap/PLAN-FEAT-019-DOMAIN-PHASES.md

[G15]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md

[G16]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/agent/server-line-answer.js

[G17]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/agent/model-provider.js

[G18]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/agent/phase1-runtime.js

[G19]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js

[G20]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/line-oa-studio/domain/line-execution-budget.js

[G21]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/edge/src/conversation/worker.ts

[G22]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/edge/src/conversation/executor.ts

[G23]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/edge/src/answer/providers/openai-compatible.ts

[G24]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/README.md

[G25]: https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/llms.txt

## เอกสาร upstream ที่ตรวจประกอบ

- [V1](https://docs.vllm.ai/en/stable/usage/security/) — API-key coverage, isolation and prefix-cache security; version-sensitive
- [V2](https://docs.vllm.ai/en/stable/serving/online_serving/openai_compatible_server/) — Inference HTTP compatibility; not a Zuri business/queue implementation
- [V3](https://docs.vllm.ai/en/stable/features/tool_calling/) — Model/template/parser-specific tool calling; application-side capability validation
- [V4](https://docs.vllm.ai/en/stable/usage/metrics/) — vLLM production metrics; KV usage is a ratio
- [V5](https://docs.vllm.ai/en/stable/examples/observability/prometheus_grafana/) — Optional official observability deployment example
- [V6](https://docs.nvidia.com/deploy/nvidia-smi/index.html) — Optional hardware monitoring interface; device-dependent values
