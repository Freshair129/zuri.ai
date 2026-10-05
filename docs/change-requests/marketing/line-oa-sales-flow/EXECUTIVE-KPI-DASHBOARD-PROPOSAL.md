---
title: "zuri.ai — Executive LINE OA Sales KPI Dashboard"
version: "0.1.0"
status: draft
superseded_by: null
date: "2026-10-04"
audience: "ทีมผู้บริหาร"
scope: "ข้อกำหนดข้อเสนอสำหรับการทบทวน Funnel รายสัปดาห์; ยังไม่ใช่การยืนยันว่าแหล่งข้อมูลพร้อมใช้จริง"
---

# ข้อเสนอ Dashboard ผู้บริหาร: จาก Ads ถึงเงินรับที่ยืนยันแล้ว

เอกสารนี้ต่อยอดจาก [คู่มือ Flow ทีมปฏิบัติงาน](README-flow.md) และ [ภาพ Flow ฉบับผู้บริหาร](README.md) เพื่อกำหนดว่าผู้บริหารควรเห็นตัวเลขอะไร ตัดสินใจอะไรได้ และข้อมูลส่วนใดยังต้องพัฒนาก่อนแสดงเป็นผลจริง

**สถานะ:** ร่างเพื่อทบทวนก่อนจัดทำ requirement และเริ่มพัฒนา ไม่มีการเปลี่ยน application code, schema, API, enum หรือ canonical registry ในขั้นนี้

ทุกมุมมองต้องจำกัดอยู่ใน Business ที่ผู้ใช้มีสิทธิ์อ่าน แสดงข้อมูลรวมที่จำเป็นต่อการตัดสินใจ และไม่แสดงเบอร์โทรหรือข้อความส่วนตัวบน Dashboard

## เป้าหมายและคำถามที่ต้องตอบ

ในการประชุมรายสัปดาห์ ผู้บริหารต้องตอบได้ว่า:

1. เงินรับที่ยืนยันแล้วและออเดอร์เปลี่ยนแปลงอย่างไร โดยแยกข้อมูลที่ยืนยันแล้วออกจากยอดรอตรวจและคืนเงิน
2. ลูกค้าหลุดหรือค้างตั้งแต่ Ads → LINE → งานติดตาม → ออเดอร์ → เงินรับ ตรงช่วงใด
3. ค่า Ads และผลขายผูกกับแคมเปญหรือ A/B variant ได้จริงเพียงใด
4. สัปดาห์หน้าจะขยาย ทดสอบต่อ แก้ Funnel หรือหยุดอะไร ใครเป็นเจ้าของ และทบทวนเมื่อไร

Dashboard เป็น read-only สำหรับการตัดสินใจ ไม่ซื้อ ปรับงบ หรือหยุดโฆษณาแทนผู้บริหาร

## รูปแบบหน้าเดียว

| ส่วนบนหน้า | แสดงอะไร | การตัดสินใจที่ช่วยได้ |
|---|---|---|
| ผลลัพธ์ | เงินรับสุทธิที่ยืนยันแล้ว, ผู้ซื้อ/ออเดอร์ที่ชำระครบ, สถานะ cash ROAS | ผลลัพธ์ทางการเงินดีขึ้นหรือยัง และข้อมูลพอจะผูกกับ Ads หรือไม่ |
| Funnel | Ads → ข้อความ LINE ใหม่ → พร้อมโทร → ส่งงานให้แอดมิน → ติดต่อได้ → ออเดอร์ → เงินรับที่ยืนยัน | ขั้นตอนไหนมีอัตราไปต่อหรือจำนวนงานค้างผิดปกติ |
| สุขภาพการปฏิบัติงาน | งานยังไม่มอบหมาย, งานเกินกำหนด, เงินรอตรวจ, coverage ของ attribution และเวลาปรับปรุงข้อมูล | ต้องแก้การติดตาม งานตรวจเงิน หรือคุณภาพข้อมูลตรงไหน |
| มติสัปดาห์หน้า | ขยาย / ทดสอบต่อ / แก้ / หยุด พร้อมเหตุผล เจ้าของงาน และวันทบทวน | ใครทำอะไรต่อและจะใช้หลักฐานใดประเมินผล |

ตัวเลขแต่ละจุดใน Funnel ต้องมีจำนวน, ตัวหาร, conversion, cohort/window, เจ้าของข้อมูล และสถานะแหล่งข้อมูล เมื่อไม่มีแหล่งข้อมูลให้แสดงเหตุผล `UNAVAILABLE`; ห้ามแสดงเป็นศูนย์หรือสร้างกราฟตัวอย่างแทนข้อมูลจริง

## KPI ที่เสนอ

### ผลลัพธ์หลัก

| KPI | นิยาม | แหล่งข้อมูลและความพร้อมปัจจุบัน | ข้อจำกัด |
|---|---|---|---|
| เงินรับสุทธิที่ยืนยันแล้ว | VERIFIED PAYMENT − VERIFIED REFUND หน่วยบาท ตาม `paidAt` และเวลาตัดยอด | Commerce `getRevenueSummary`; มี read model ใน source ปัจจุบัน | ใช้เฉพาะรายการที่ยืนยันแล้ว; source code ระบุว่า migration ยังไม่ถูกนำไปใช้จริง จึงไม่ใช่หลักฐาน production |
| Paid conversion ของ Lead cohort | จำนวนลูกค้าไม่ซ้ำใน cohort ที่มีอย่างน้อยหนึ่งออเดอร์ซึ่งยอด `VERIFIED PAYMENT` สุทธิครบ ÷ จำนวน Lead พร้อมโทรไม่ซ้ำใน cohort | ยังไม่พร้อมเป็น KPI จริง: order ผูก conversation ได้ แต่การสร้าง order จากแชตยังอยู่นอก slice; readiness ยังเป็น vocabulary ของคู่มือ ไม่ใช่ lifecycle ที่ยืนยันในระบบ | Cohort ต้องใช้อายุสังเกตผลเดียวกัน; แสดง Pending จนพ้น conversion window |
| Cash ROAS | เงินรับสุทธิที่ยืนยันและผูกกับ Ads/variant ได้ ÷ ค่า Ads ของ Ads/variant เดียวกัน | `UNAVAILABLE`: Marketing paid-media read model คืน spend, impressions, clicks และ ROAS เป็น unavailable; Commerce มีเพียง origin CHAT/conversation ไม่ใช่ ad attribution | ห้ามยกยอด CHAT ทั้งหมดเป็น Ads; ไม่ใช้ผลที่ยังไม่ผูกแหล่งที่มาเป็นตัวตั้ง |

ไม่กำหนดเป้าหมายหรือเกณฑ์ A/B winner ในเอกสารนี้ เพราะยังไม่มี baseline, งบ, conversion window และ minimum detectable effect ที่เจ้าของธุรกิจอนุมัติ

### ตัวขับและ guardrails

| ตัวขับ/guardrail | นิยามที่ต้องใช้ | ความพร้อมปัจจุบัน |
|---|---|---|
| ค่า Ads, impressions, link clicks, CTR/CPC | ตาม report ของ provider และช่วงเวลา/สกุลเงินเดียวกัน | `UNAVAILABLE` จนมี approved provider reader หรือแหล่ง manual measurement ที่อนุมัติ |
| ข้อความ LINE ใหม่ | นับ conversation/customer ไม่ซ้ำจาก inbound message จริงใน Business และ cohort ที่ระบุ | มี Conversation/Message writer ใน CRM; ต้องยืนยันวิธี deduplicate และการอ่านแบบรวมก่อนประกาศเป็น executive KPI |
| พร้อมโทร / อัตราพร้อมโทร | ลูกค้าสนใจ + ให้/ยืนยันเบอร์ติดต่อ + มีหลักฐานอนุญาตให้โทร ÷ ข้อความ LINE ใหม่ | `UNAVAILABLE`: CRM consent ปัจจุบันเป็น owner attestation เรื่อง PDPA ที่บันทึกจากที่อื่น ไม่ใช่ customer-facing opt-in และไม่ยืนยัน permission-to-call; ต้องมีสัญญาณและหลักฐานเฉพาะก่อนนับ |
| งานติดตามเปิด/เกินกำหนด/ไม่มีผู้รับผิดชอบ | นับ SalesTask ที่ OPEN/IN_PROGRESS แยกตาม due state และ assignee ณ เวลาตัดยอด | มี SalesTask status, assignee และ due date; งานจากแชตยังไม่มี converter ที่ยืนยันใน FR-161 |
| โทรแล้ว/ติดต่อได้/ไม่รับสาย/ไม่ซื้อ | นับคนไม่ซ้ำและความพยายามโทรแยกกันจาก call attempt และ outcome ที่เป็นโครงสร้าง | `UNAVAILABLE` เป็นอัตรา: SalesTask มี outcome แบบข้อความและไม่มี per-call attempt record ที่ contract นี้รับรอง |
| Pending และ Refund | แยกยอด PENDING, VERIFIED และ VERIFIED REFUND | Commerce มี payment status; นำเสนอแยกจากเงินรับสุทธิ |
| Attribution coverage | Lead ที่มี Ads/variant reference ยืนยันได้ ÷ Lead ทั้งหมด | `UNAVAILABLE` จนมีวิธีเชื่อม provider entity กับ LINE conversation ที่ทดสอบแล้ว; UTM หรือ campaign name อย่างเดียวไม่พอ |
| Freshness/coverage | เวลา `source_as_of`, ช่วงข้อมูลที่ครอบคลุม, แหล่งที่ขาดและเหตุผล | ต้องเป็นข้อมูลกำกับทุก metric; source ที่ stale/partial ต้องแสดงสถานะ ไม่เติมค่าประมาณ |

## รอบเวลารายสัปดาห์และการทดลอง

- ใช้สัปดาห์ `[จันทร์ 00:00, จันทร์ถัดไป 00:00)` ตาม `Asia/Bangkok` พร้อม `cutoff_at` และ `source_as_of` ของแต่ละแหล่ง
- แยก **activity week** (กิจกรรม/เงินที่เกิดในสัปดาห์นั้น) ออกจาก **Lead cohort** (Lead ที่เริ่มในสัปดาห์เดียวกันและติดตามถึงอายุเท่ากัน)
- ระบุ conversion/observation window ก่อนเริ่มรอบทดลอง ห้ามใช้รายได้จาก Lead เก่าหารต้นทุนของ Lead ใหม่
- ถ้า cohort ยังไม่ครบช่วงสังเกตผล ให้ `PENDING`; ตัวหารเป็นศูนย์ให้ `N/A`; แหล่งไม่มีหรืออ่านไม่ได้ให้ `UNAVAILABLE` หรือ `UNKNOWN` ตามสัญญาแหล่งข้อมูล
- การทดสอบที่ไม่สุ่มแบ่งกลุ่มอย่างเหมาะสมให้รายงานเป็น comparison เชิงสังเกต ไม่เรียกผล causal A/B winner
- ทุกมติขยาย/ปรับ/หยุดต้องเก็บเหตุผล ผู้รับผิดชอบ สิ่งที่จะเปลี่ยน วันครบกำหนด และวันทบทวน โดย Dashboard ไม่ดำเนินการแทนมนุษย์

## ขอบเขตระบบและช่องว่างที่ต้องปิด

| เจ้าของ | มีหลักฐานใน source ปัจจุบัน | ช่องว่างก่อนทำ Funnel dashboard ให้ครบ |
|---|---|---|
| Marketing / Integration | Campaign planning, หน้า Results ที่แสดง unavailable อย่างชัดเจน และ paid-media read model ที่ไม่สร้างตัวเลขแทน | Approved ad provider/manual measurement reader, entity/variant metrics และ freshness/quality contract |
| CRM / LINE | LINE inbound ถูกบันทึกเป็น Conversation/Message; SalesTask เก็บ assignee, due date, status และ outcome; consent ปัจจุบันเป็น owner attestation เรื่อง PDPA | Lead/readiness lifecycle, หลักฐาน permission ให้โทรแยกจาก PDPA attestation, การสร้าง task จากแชต และ structured call attempts/outcomes |
| Commerce | SalesOrder ผูก customer/conversation ได้; payment verification และรายได้สุทธิอ่านจาก VERIFIED payment/refund | สร้าง order จากแชต; เชื่อม customer/order กับ lead cohort และ Ads variant โดยไม่เดาจาก origin CHAT |
| Dashboard / Reporting | Marketing มี read model ที่อ่าน Marketing, Integration และ Commerce owner reads พร้อมสถานะ unavailable | Approved cross-domain read contract สำหรับ CRM funnel และสรุปผล cohort โดยไม่ query ตารางของ domain อื่นตรง ๆ |

การพัฒนาต้องผ่าน owner read contracts ของ Marketing, CRM, Commerce และ Integration ตาม architecture boundary; dashboard เป็น read-only และห้ามเขียนข้อมูลธุรกรรมข้ามโดเมน

## ลำดับส่งมอบที่เสนอ

1. อนุมัตินิยาม KPI, ownership, สถานะข้อมูล และ scope ของ dashboard ฉบับนี้
2. ทำ contract/acceptance ของ read model ที่รวมเฉพาะ source ซึ่งเจ้าของโดเมนเปิดให้อ่าน; ระบุ `READY`, `PARTIAL`, `UNAVAILABLE`, `PENDING` และ freshness
3. ทำ read-only dashboard รุ่นแรกจาก source ที่ยืนยันได้: รายได้ VERIFIED, ออเดอร์ และสุขภาพ SalesTask; แสดงส่วน Ads/attribution/call funnel ว่า unavailable พร้อมเหตุผล
4. ทดลองเก็บข้อมูลกับ Business ที่ได้รับอนุญาต ตรวจ coverage และความตรงกันของยอด ก่อนเปิดใช้ในการประชุมผู้บริหาร
5. เพิ่ม Ads attribution, Lead readiness และ call outcomes หลัง owner contracts, privacy review, baseline และ conversion window ผ่านการทบทวน

ห้ามอ้าง production readiness จาก local tests, mock/seed data หรือเอกสารนี้ การเปิดใช้จริงต้องมีหลักฐาน source access, scope, freshness, reconciliation และการยืนยันจากเจ้าของ Business

## Risk และ complexity

- **Dashboard รุ่นแรก: C-2 / MEDIUM** — ต้องมีเอกสารและ contract ก่อน implementation; เป็น read-only cross-domain projection
- **Full Ads-to-cash funnel: C-3 / HIGH** — มี integration/provider evidence, attribution identity, CRM lifecycle/call events และ privacy/authorization boundaries เพิ่มเติม
- ไม่มี schema, API, enum, permission, provider, migration หรือ canonical requirement ใหม่ที่ได้รับอนุมัติในเอกสารฉบับร่างนี้

## Acceptance criteria สำหรับ requirement ที่จะตามมา

- แสดง KPI พร้อมนิยาม สูตร หน่วย ตัวตั้ง/ตัวหาร เจ้าของข้อมูล cohort/window, timezone, `source_as_of` และสถานะแหล่งข้อมูล
- VERIFIED money, PENDING money และ refunds แสดงแยกกัน; revenue ไม่ถูกเรียกว่า Ads-attributed หากไม่มี verified link
- activity week และ Lead cohort แยกกัน; conversion ใช้ denominator และ observation window ที่สอดคล้องกัน
- missing/partial/stale/unavailable ไม่กลายเป็นเลขศูนย์; denominator 0 เป็น `N/A`; cohort ที่ยังติดตามเป็น `PENDING`
- ผู้บริหารเห็นงานที่ยังไม่มอบหมาย/เกินกำหนด และมีพื้นที่ระบุมติ เจ้าของ และวันทบทวน
- ทุก cross-domain read ผ่าน owner contract; ไม่มี direct table access หรือ cross-domain write
- ไม่มีเป้าหมายหรือ A/B winner threshold ที่แต่งขึ้นโดยไม่มี baseline และการอนุมัติ

## Dependencies and review owners

- Marketing: นิยาม campaign/provider measurement, variant และ attribution coverage
- CRM / LINE OA: ความหมายของ Lead, readiness, permission-to-call, task handoff และ call outcomes
- Commerce: เงื่อนไข VERIFIED payment/refund, paid customer และการผูก order กับ conversation/Lead
- Integration: provider scope, report window, timezone/currency, pagination, freshness และ quality states
- ผู้บริหาร/Business owner: conversion window, KPI priority, baseline/targets และผู้มีอำนาจตัดสินงบ

## Version diff

```diff
+ 0.1.0 — เสนอ KPI dashboard สำหรับผู้บริหารแบบ read-only
+ แยก KPI ที่มี owner source ออกจาก Ads/Lead/call metrics ที่ยัง unavailable
+ กำหนด cohort, weekly cut-off, data-quality states, risk/complexity และ review gates
+ ไม่เปลี่ยน code, schema, API, permission, migration, enum, FR/FEAT registry หรือ production behavior
```
