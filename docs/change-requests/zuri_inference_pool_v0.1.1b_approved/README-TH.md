# Zuri Self-hosted Inference Pool — Approved Design

**0.1.1b · 18 กันยายน 2026 · Approved design / Pending repository integration**

เริ่มอ่านที่ [บันทึกการอนุมัติ](APPROVAL-TH.md) และ [ฉบับรวม](ZURI-INFERENCE-POOL-FULL-REVIEW.md)

แพ็กนี้มีเอกสารหลัก 12 ฉบับใน `drafts/docs/` ตามเทมเพลต Zuri เดิม เนื้อหาออกแบบไม่เปลี่ยนจาก v0.1.0b ที่เจ้าของอนุมัติ แต่เปลี่ยน metadata และบันทึกการอนุมัติให้ตรวจย้อนหลังได้

เลข ID ยังเป็นช่องแทนค่าที่ต้องจองใน registry จริง ไม่อ้างว่าจองหรือรัน governance แล้ว แผนทดสอบ runtime ทั้ง 52 กรณียังเป็น NOT_RUN

`handoff/APPLY-TO-ZURI.md` เป็นขั้นตอนนำเข้า `tools/render-drafts.mjs` เป็นเครื่องมือสร้างไฟล์ใน staging ใหม่เท่านั้น ไม่แก้ repo/ledger โดยตรง ใช้ Node.js 22 ขึ้นไป

`review/APPROVAL-RECORD.json` ตรึง hash ของเอกสารทั้งก่อนและหลังบันทึกอนุมัติ `review/PACKAGE-VALIDATION.json` เป็นผลตรวจแพ็กนี้เท่านั้น ผลตรวจรุ่นเก่าเก็บเป็นหลักฐานไว้แยกกัน

ไม่มี runtime, schema, credential, LINE OA, Edge device หรือ deployment ถูกเปลี่ยนโดยแพ็กนี้
