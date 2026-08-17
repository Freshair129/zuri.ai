---
id: METHODOLOGY-SSOT
version: 1.0.0
status: stable
title: "GoVibe Methodology SSOT: DDD & D2C Unified"
summary: เอกสารความจริงหนึ่งเดียว (SSOT) ที่รวมปรัชญา Doc-Driven Development (DDD) และทักษะการปฏิบัติงาน Doc-to-Code (D2C) เข้าด้วยกัน
tags:
  - methodology
  - ddd
  - d2c
  - ssot
last_update: 2026-06-06T10:45:00+07:00
---

# 📘 GoVibe Methodology SSOT (DDD & D2C)

เอกสารฉบับนี้คือ **Single Source of Truth (SSOT)** ที่กำหนดแนวทางการพัฒนาซอฟต์แวร์ของ GoVibe โดยการรวมเอา "ปรัชญาเชิงกลยุทธ์" (DDD) และ "ทักษะระดับปฏิบัติการ" (D2C) เข้าเป็นเนื้อเดียวกัน

---

## 📝 ส่วนที่ 1: ปรัชญา Doc-Driven Development (DDD)
*เดิม: [[CONCEPT--DOC-DRIVEN-DEVELOPMENT]]*

**"Document is the single source of truth (SSOT). Code is just a byproduct."**

### 1.1 ปัญหาของวิธีการเดิม (Code-First)
การเขียนโค้ดก่อน (Code-first) ทำให้เกิด Technical Debt และ AI เกิดอาการ "หลอน (Hallucination)" เพราะไม่รู้เจตนารมณ์ (Intent) ที่แท้จริง ทำให้โค้ดกลายเป็น Legacy อย่างรวดเร็ว

### 1.2 แนวคิดหลัก (The Core Concept)
ในระบบของ GoVibe **"เอกสารคือความจริง โค้ดคือผลพลอยได้"** เราจะใช้เอกสาร Markdown เป็นตัวกลางในการสื่อสารเจตนารมณ์ระหว่างมนุษย์และ AI อย่างชัดเจน

### 1.3 กฎการตรวจสอบ (Validation Rule)
- ห้ามเขียนโค้ดหากไม่มีเอกสารสเปกที่ได้รับอนุมัติแล้ว
- โค้ดต้องสะท้อนสเปก 100% หากสเปกเปลี่ยน โค้ดต้องเปลี่ยนตาม

---

## 🛠️ ส่วนที่ 2: ทักษะ Doc-to-Code (D2C)
*เดิม: [[SKILL--DOC-TO-CODE]]*

**ทักษะระดับปฏิบัติการ (Execution Skill) ของ AI Agent**

### 2.1 นิยามทักษะ (Capability Definition)
AI Agent ทำหน้าที่เป็น "Compiler" ที่รับ Input เป็นภาษามนุษย์ที่มีโครงสร้าง (Structured Markdown) และคาย Output ออกมาเป็นโค้ด (Code) ที่ทำงานได้จริงอย่างแม่นยำ

### 2.2 มาตรฐานการทำงาน (Execution Standard)
1. **Read SSOT**: อ่านสเปกอย่างละเอียดก่อนเริ่มงาน
2. **Constraint Check**: ตรวจสอบข้อห้ามและกติกาในเอกสาร
3. **Pure Generation**: เขียนโค้ดตามสเปกโดยตรง ห้ามคิดลอจิกเพิ่มเติมเองโดยไม่ได้รับอนุญาต (No Hallucination)

---

## 🔄 ส่วนที่ 3: ขั้นตอนการทำงานที่เป็นมาตรฐาน (SOP)

กระบวนการเปลี่ยน **ความตั้งใจ (Intent)** ให้กลายเป็น **ระบบ (System)**:

1. **Intent Extraction**: ผู้ใช้ระบุความต้องการ
2. **Spec Drafting (DDD)**: Agent ร่างเอกสารสเปก/Spec/Requirement
3. **Approval Gate**: ผู้ใช้ตรวจสอบและพิมพ์ "APPROVED"
4. **Code Generation (D2C)**: Agent แปลงสเปกที่ผ่านการอนุมัติให้เป็นโค้ด
5. **Verification**: ตรวจสอบโค้ดเทียบกับสเปก (Back-to-Spec Verification)

---

## 📌 บทสรุป (Summary)
การรวม DDD และ D2C เข้าด้วยกันทำให้ GoVibe สามารถรักษาคุณภาพของซอฟต์แวร์ได้ในระดับสูงสุด ลดความผิดพลาดจากการสื่อสาร และทำให้ AI สามารถทำงานร่วมกับมนุษย์ได้อย่างไร้รอยต่อในฐานะ **Expert Software Engineer**

## CHANGELOG

| Version | Date | Status | Summary |
|---------|------|--------|---------|
