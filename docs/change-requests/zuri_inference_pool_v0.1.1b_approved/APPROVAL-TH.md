# บันทึกการอนุมัติ — Zuri Self-hosted Inference Pool

**สถานะเอกสาร: Approved design · 0.1.1b · 18 กันยายน 2026**  
**สถานะนำเข้า repository: Pending — ยังไม่ประกาศ ID หรือรัน governance สำเร็จ**

เจ้าของตอบ `approve` หลังได้รับชุดเอกสาร 12 ฉบับ v0.1.0b จึงบันทึกการอนุมัติแบบไว้ในรุ่นนี้ โดยไม่เปลี่ยนเนื้อหาข้อกำหนดทางเทคนิค

## ขอบเขตที่อนุมัติ

ใช้ `Zuri Server → Router → vLLM A/B` โดยไม่บังคับใช้ Edge ในเส้นทางตอบ LINE นี้; GPU 12 GB กับ 16 GB รันโมเดลแยกกัน ไม่รวม VRAM; ใช้คิว LINE และขอบเขต CRM/MSP/GKS เดิม เพิ่มการลงทะเบียน node, credential qualification, capacity routing และ monitoring ตามแบบ

## สิ่งที่บันทึกแล้ว

เอกสารหลักทั้ง 12 ฉบับเปลี่ยน metadata เป็น `approved`, เพิ่มแถว CHANGELOG และสถานะนำเข้าที่แยกจากสถานะอนุมัติ `review/APPROVAL-RECORD.json` ตรึง SHA-256 ของต้นฉบับที่อนุมัติและฉบับบันทึกการอนุมัติ เนื้อหาด้านพฤติกรรมและขอบเขตไม่เปลี่ยน

## สิ่งที่ยังไม่เสร็จ

เลข ID ทั้ง 13 ช่องยังไม่จอง; registry/ledger/charter ใน repository ยังไม่เปลี่ยน; `npm run docs:ids -- --write`, `npm run govern` และ `npm run verify` ยังไม่รันบน checkout จริง; การทดสอบ runtime 52 กรณียังคง `NOT_RUN`; ไม่มี implementation, migration หรือ production activation

ตรวจ `main` ผ่าน GitHub ได้ที่ `cfd5521e7d004e63ffead1e07f46045f1cdc06f2` ซึ่งตรงกับฐานเดิม แต่สภาพแวดล้อมทำงานดึง Git checkout ไม่สำเร็จเพราะติดต่อ GitHub ทางเครือข่ายไม่ได้ จึงไม่แก้ ledger ด้วยมือหรืออ้างว่าได้ผ่าน governance แล้ว

พบ PR #450 ระบุว่าใช้ `FR-254` อยู่ จึงใช้เลขท้าย main มาจองเลขต่อทันทีไม่ได้ ผลตรวจนี้ไม่ใช่การยืนยันว่าได้ตรวจทุก branch ครบแล้ว

## การส่งต่องาน

ใช้ `handoff/APPLY-TO-ZURI.md` ใน worktree แยก ตรวจ main และงานขนานอีกครั้ง จอง ID ผ่านทะเบียนจริง แล้วเรียก sanctioned writer และ governance ก่อนเริ่มงานตามเฟส แพ็กนี้ไม่อนุญาตให้ข้าม gate หรือเปิดใช้ production อัตโนมัติ

ไฟล์หลักยังลงท้าย `.md.template` เพราะเลข ID ยังไม่ประกาศ ไม่ใช่เพราะแบบยังไม่อนุมัติ การบันทึกนี้เป็นข้อความถอดจากการอนุมัติในแชต ไม่ใช่ลายเซ็นดิจิทัลหรือผล GitHub review
