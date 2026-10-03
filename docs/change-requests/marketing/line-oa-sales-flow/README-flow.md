---
title: "zuri.ai — คู่มือ Flow จาก Ads ถึงยอดขายใน LINE OA"
version: "0.1.0"
status: draft
superseded_by: null
date: "2026-10-03"
audience: "ทีม Ads และแอดมินขาย"
scope: "ข้อเสนอกระบวนการและคู่มือภาพ ไม่ใช่การเปลี่ยนแปลงระบบ"
---

# คู่มือใช้ Flow หน้าเดียว

ภาพหลัก: `zuri-line-oa-sales-flow-v0.1.html` เปิดในเบราว์เซอร์และพิมพ์ A4 แนวนอนได้ ไฟล์ภาพ PNG เป็นภาพเดียวกันสำหรับส่งต่อให้ทีม

ข้อเสนอนี้เริ่มจาก Ads A/B → ลูกค้าทัก LINE OA → AI ตอบและขอเบอร์ → ส่งงานให้แอดมิน → โทร/ติดตาม → ออเดอร์/การรับเงิน → ทบทวนทุกสัปดาห์ ผู้ใช้เลือกให้เน้นสิ่งที่ทีม Ads และแอดมินต้องทำ สถานะ และ KPI

## วิธีเปลี่ยนคำอธิบายซ้ำให้เป็นคู่มือภาพด้วย AI

1. บอกเป้าหมาย จุดเริ่ม จุดจบ และคนที่จะใช้คู่มือ
2. เรียงแต่ละขั้นเป็น “ผู้รับผิดชอบ → สิ่งที่ทำ → เงื่อนไขส่งต่อ → สถานะ → หลักฐานที่ต้องเก็บ”
3. ระบุกรณีไม่สำเร็จด้วย เช่น ลูกค้าไม่ให้เบอร์ โทรไม่ติด ไม่ซื้อ และคืนเงิน
4. ใช้ Swimlane เมื่อมีหลายทีมส่งงานต่อกัน จำกัดภาพหลักให้เหลือขั้นที่จำเป็น และแยกสูตร/รายละเอียดไว้ในเอกสารประกอบ
5. ตรวจภาพกับคนทำงานจริง โดยลองเดินทั้งเคสขายสำเร็จและเคสค้าง/ไม่สำเร็จ แล้วปรับเวอร์ชัน

พรอมป์ต์ใช้ซ้ำใน Codex ที่ติดตั้งสกิลแล้ว:

> ใช้ diagram-design ทำคู่มือภาพหน้าเดียว A4 แนวนอน ภาษาไทย สำหรับ [ทีมผู้ใช้] เป้าหมายคือ [ผลลัพธ์] เริ่มจาก [จุดเริ่ม] ถึง [จุดจบ] แต่ละขั้นต้องเห็นเจ้าของงาน เงื่อนไขส่งต่อ สถานะ และ KPI แสดงกรณีไม่สำเร็จและวงจรปรับปรุงรายสัปดาห์ ใช้สี/ฟอนต์ของโครงการ แยกข้อเสนอออกจากฟีเจอร์ที่มีหลักฐานแล้ว ไม่ใส่ตัวเลขผลลัพธ์สมมติ

## หลักการปฏิบัติงาน

| ขั้น | เจ้าของ | ทำอะไรและส่งต่อเมื่อไร | สถานะปฏิบัติงาน | ข้อมูลที่เก็บ |
|---|---|---|---|---|
| 1 ตั้ง A/B | ทีม Ads | เลือกสินค้า กลุ่มลูกค้า ข้อเสนอ KPI และเงื่อนไขจบการทดสอบ เปลี่ยนหนึ่งตัวแปร สุ่มแบ่งกลุ่มที่ไม่ทับกันเมื่อแพลตฟอร์มรองรับ | ร่าง / พร้อมทดสอบ | experiment_id, variant A/B, ตัวแปร, เกณฑ์พร้อมโทร, งบ, วันเริ่ม/จบ, เจ้าของ |
| 2 ยิง Ads | ทีม Ads | เปิดในผู้ให้บริการ Ads เก็บผลแยกชุด ไม่สรุปผู้ชนะจาก CTR เพียงอย่างเดียว | กำลังทดสอบ / หยุด / รอข้อมูล / สรุปผล | campaign/ad ID, spend, impressions, link_clicks, link/source code, source_as_of |
| 3 รับ LINE | LINE OA / CRM | ลูกค้าส่งข้อความจริงจึงนับเข้าขั้น แยกการเพิ่มเพื่อนหรือการคลิกลิงก์ออกจากการทัก | Lead ใหม่ | first_inbound_at, lead_id, customer_id ถ้ามี, conversation_id, account_id, business_id, แหล่งที่มาและหลักฐาน |
| 4 AI ตอบ | AI / คนรับช่วงแชต | ตอบจากข้อมูลสินค้าที่เผยแพร่แล้ว คัดความสนใจ ขอเบอร์พร้อมขออนุญาตให้แอดมินโทร ถ้าตอบไม่ได้หรือขอคนให้ส่งคนรับช่วงแชต | กำลังคุย / รอข้อมูล / พร้อมโทร / ปิดไม่สนใจ | first_reply_at, สินค้า/ความต้องการ, phone, call_permission พร้อมเวลา, ready_at, เหตุผลส่งคน |
| 5 ส่งงานโทร | CRM / หัวหน้าแอดมิน | พร้อมโทร = สนใจสินค้า + เบอร์ติดต่อได้ตามที่ลูกค้าให้/ยืนยัน + อนุญาตให้โทร ต้องมีผู้รับผิดชอบและ due_at ก่อนถือว่าส่งต่องานสำเร็จ | รอจัดสรร / จัดสรรแล้ว | sales_task_id, assignee_id, assigned_at, due_at, สรุปแชต, conversation_id |
| 6 โทรติดตาม | แอดมินที่ได้รับงาน | บันทึกทุกความพยายาม โทรไม่ติด/ขอนัดใหม่ต้องมี next_action_at; ไม่ซื้อบันทึกเหตุผล; ตอบรับข้อเสนอจึงเปิดออเดอร์ | โทรติด / ไม่รับสาย / นัดใหม่ / ไม่ซื้อ / ตกลงซื้อ | attempted_at, reached_at, call_outcome, lost_reason, next_action_at, actor |
| 7 ออเดอร์/รับเงิน | ฝ่ายขาย / ผู้ตรวจเงิน | สร้างออเดอร์ ยืนยันรายการ ตรวจการชำระ และส่งมอบตามกระบวนการสินค้า เงิน PENDING ยังไม่เป็นยอดยืนยัน แยกคืนเงินและยกเลิก | ออเดอร์และการจ่ายเงินแยกกัน | order_id, lines, payment_id, payment_status, paid_at, verified_at, refund, delivery evidence |
| 8 ทบทวน | ทีม Ads + แอดมิน + ผู้ตรวจเงิน | สรุปทุกจันทร์ด้วยข้อมูลถึงวันอาทิตย์ที่ผ่านมา พร้อมเวลาตัดยอด แก้จุดที่หลุด/ค้างก่อนขยายงบ บันทึกผู้รับผิดชอบการปรับรอบหน้า | ขยาย / ทดสอบต่อ / หยุดพร้อมเหตุผล | week_start, cutoff_at, A/B table, backlog, decision, owner, due_at |

สถานะ Lead และ call_outcome ข้างต้นเป็นคำศัพท์ของคู่มือที่เสนอ ไม่ใช่การประกาศเพิ่ม enum/API ในระบบ หากระบบยังไม่มีข้อมูลหรือการส่งต่ออัตโนมัติ ให้ใช้การส่งต่อและบันทึกโดยคนในช่องทางที่ทีมอนุมัติ พร้อมบอกแหล่งข้อมูล ห้ามแสดงว่าเชื่อมสำเร็จโดยไม่มีหลักฐาน

## การเชื่อมแหล่งที่มาและการนับซ้ำ

- เก็บ `tenant/business/LINE OA account` ให้ตรงขอบเขตข้อมูลเดียวกัน รหัสจาก Ads เป็น external reference ไม่ใช่ primary key
- เส้นทางที่ต้องพิสูจน์คือ `experiment/variant/ad → lead → conversation → sales_task → order → payment` ใช้ UUID ภายในและรหัสอ้างอิงของแต่ละเจ้าของข้อมูล
- แยกลิงก์/รหัส/หน้าเข้าถึงตาม variant แต่ UTM หรือลิงก์คลิกเพียงอย่างเดียวไม่รับประกันว่าจะเชื่อมกับผู้ส่งข้อความ LINE ได้ ต้องมีวิธีส่งและยืนยัน reference เช่น เส้นทาง LIFF/หน้า landing หรือรหัสที่ลูกค้าส่งกลับ ซึ่งต้องออกแบบและทดสอบก่อนใช้จริง
- ไม่มีหลักฐานเชื่อมให้เป็น `Unknown` แยกจาก `Organic` ที่ยืนยันได้ และแยกจาก source ที่ลูกค้าบอกเอง ไม่เดาให้เป็น Ads อัตโนมัติ
- การกลับมาทักหลายครั้งไม่สร้าง Lead ใหม่ซ้ำในการวัด cohort เดียวกัน ใช้ลูกค้าที่ระบุตัวได้ใน Business นั้นเป็นหลัก ถ้ายังระบุข้าม account ไม่ได้ให้แสดงข้อจำกัด ไม่รวมคนด้วยเบอร์เพียงอย่างเดียว
- การจัด Lead ลง A/B ใช้ assignment ที่พิสูจน์ได้ ถ้าสัมผัสทั้งสองชุดโดยไม่มี assignment ชัดเจน แยกเป็น Mixed และไม่นำไปตัดสินผู้ชนะ
- ผูกออเดอร์และเงินเพียงครั้งเดียวกับ Lead/variant ตามกติกาที่ประกาศไว้ ไม่รวม conversion ตัวเลขจากผู้ให้บริการ Ads กับจำนวน Lead ใน CRM เป็นก้อนเดียว
- ออเดอร์ `origin=CHAT` หรือมี conversation_id ไม่ใช่หลักฐานว่าเกิดจาก Ads; source/variant ยังต้องพิสูจน์แยก

## ข้อมูลขั้นต่ำของประวัติสถานะที่เสนอ

`event_id, business_id, lead_id, object_type, object_id, previous_status, new_status, occurred_at, recorded_at, actor_id, owner_id, reason, next_action_at, source_ref`

เก็บเหตุการณ์ย้อนหลังแบบเพิ่มรายการ เพื่อคำนวณเวลาค้างแต่ละขั้นและดูว่าใครส่งต่อให้ใครได้ เก็บทั้ง occurred_at และ recorded_at สำหรับข้อมูลเข้าช้า เก็บเท่าที่จำเป็นสำหรับทำงาน และแสดงรายงานรวมโดยไม่เผยเบอร์โทร

นี่เป็นข้อกำหนดข้อมูลสำหรับการออกแบบต่อ ไม่ใช่ schema migration ที่อนุมัติแล้ว

## นิยามรายงานรายสัปดาห์

ใช้ Asia/Bangkok ช่วงครึ่งเปิด `[จันทร์ 00:00, จันทร์ถัดไป 00:00)` ระบุเวลา snapshot และ freshness ของทุกแหล่ง ค่าไม่มีหลักฐาน = `Unavailable`; ตัวหาร 0 = `N/A`; ยังไม่ถึงช่วงสังเกตผล = `Pending` ห้ามแทนทั้งหมดด้วย 0

ต้องมีสองมุมแยกกัน:

1. **Activity week:** ค่า Ads, Lead ที่ทัก, งานที่โทร, งานค้าง และกระแสเงินของเหตุการณ์ที่เกิดในสัปดาห์นั้น รายได้ใช้วัน paid_at ตามสัญญาปัจจุบัน แต่รวมเฉพาะรายการที่ VERIFIED ณ เวลาตัดยอด จึงต้องเก็บ cutoff และแก้ย้อนหลังพร้อมเหตุผลเมื่อมีการตรวจยืนยันช้า
2. **Lead cohort:** กลุ่ม Lead ที่ทักครั้งแรกในสัปดาห์เดียวกัน ติดตามผลของกลุ่มนั้นถึงอายุที่เท่ากัน พร้อมจำนวนที่ยังค้าง ห้ามใช้รายได้จาก Lead เก่ามาหารต้นทุน Lead ใหม่เพื่อตัดสิน A/B

กำหนด conversion/observation window ร่วมกันก่อนยิง Ads ตามวงจรสินค้าจริง เอกสารนี้ไม่สมมติ 7 หรือ 30 วันให้เอง และไม่กำหนดงบที่ยังไม่ได้รับจากผู้ใช้

| ตัววัด | สูตรและหน่วย | แหล่งข้อมูล / ความถี่ | สิ่งที่ต้องระวัง |
|---|---|---|---|
| Spend / impressions / link clicks | ผลรวมของแต่ละ ad/variant ในช่วงที่ระบุ | รายงานผู้ให้บริการ Ads; ดึง/นำเข้ารายวันก่อนสรุปรายสัปดาห์ | Integration/read contract ยังต้องยืนยัน; ใส่สกุลเงินและ source_as_of |
| CTR | link clicks ÷ impressions × 100% | Ads รายวัน | ใช้ link clicks แบบเดียวกันทั้ง A/B |
| CPC | Spend ÷ link clicks, บาท/คลิก | Ads รายวัน | ไม่แปลว่าได้ลูกค้าใน LINE แล้ว |
| New LINE leads | จำนวน Lead ไม่ซ้ำที่ first_inbound_at อยู่ใน cohort | บทสนทนา CRM; บันทึกตามเหตุการณ์ | เพิ่มเพื่อน/คลิกไม่เท่ากับส่งข้อความ |
| Attribution coverage | Lead ที่มี Ads reference ยืนยันได้ ÷ Lead ทั้งหมด × 100% | แหล่งอ้างอิง/CRM; ตามเหตุการณ์ | แสดง Organic, Unknown และ self-reported แยก |
| First reply time | p50(first_meaningful_reply_at − first_inbound_at) | Conversation/transport receipt; ตามเหตุการณ์ | รายงาน unanswered แยก; ระบุเวลาปฏิทินหรือเวลาทำการให้เหมือนกัน |
| Ready rate | Lead พร้อมโทรไม่ซ้ำ ÷ Lead ใหม่ใน cohort × 100% | Lead readiness evidence; ตามเหตุการณ์ | เป็นข้อเสนอข้อมูล: ไม่ยกระดับทุกเบอร์เป็น qualified lead |
| Handoff time | p50(assigned_at − ready_at) | CRM Sales task + readiness event | แสดง unassigned และเกิน SLA แยก; SLA ต้องกำหนดโดยทีม |
| Call attempt / reach rate | Lead ที่พยายามโทร ÷ Lead ที่ได้รับงาน; Lead ที่โทรติด ÷ Lead ที่ได้รับงาน | Call outcomes; ทุกครั้งที่โทร | ทั้งตัวตั้ง/หารเป็น cohort เดียวกัน; โทรซ้ำไม่เพิ่มจำนวนคน |
| Backlog / overdue | งานยังเปิด ณ cutoff; งานเปิดที่ due_at < cutoff | CRM Sales task snapshot | แยกงานรอข้อมูล รอคนรับ และรอโทร |
| Paid conversion | Lead ที่มีอย่างน้อยหนึ่งออเดอร์จ่ายครบ ÷ Lead พร้อมโทรใน cohort × 100% | Order/VERIFIED Payment + Lead reference | ไม่ใช้จำนวนออเดอร์หารจำนวนคน; แสดงซื้อซ้ำแยก |
| Confirmed net cash | VERIFIED PAYMENT − VERIFIED REFUND, บาท | Commerce payment/revenue reader; ตามเหตุการณ์ | แสดงเงินรอตรวจ/รอจ่าย/จ่ายบางส่วนแยก; ใช้คำนี้เพื่อแยกจากรายได้ทางบัญชี |
| CPLq | Spend ของ variant ÷ Lead พร้อมโทรที่ผูก variant ยืนยันได้, บาท/Lead | Ads + readiness/attribution | Cost และ Lead ต้องอยู่ใน experiment/cohort window ที่สอดคล้องกัน |
| Cash ROAS | ยอดสุทธิที่ยืนยันและผูกกับ Ads/variant ÷ Spend ของ Ads/variant, เท่า | Ads + Order + VERIFIED Payment/Refund | เป็น observed attribution ไม่ใช่การพิสูจน์ incremental lift; ไม่รวม Unknown เป็นผล Ads |

รายงาน A/B เสนอให้มีคอลัมน์ `variant | spend | impressions | link_clicks | leads | ready | assigned | attempted | reached | paid_customers | paid_orders | verified_net | CPLq | cash_ROAS | pending | source_as_of` แยก Unknown/Mixed ออกต่างหาก

## กติกาตัดสิน A/B

- เลือก primary KPI ก่อนเริ่ม เช่น CPLq ภายใต้เงื่อนไขคุณภาพและ cash ROAS หลังครบช่วงสังเกตผล
- คงสินค้า ราคา ข้อเสนอ ช่วงเวลา และกติกาติดตามให้เทียบกันได้ เปลี่ยนตัวแปรเดียวในรอบนี้ เช่นภาพหรือข้อความ ใช้การแบ่งกลุ่มไม่ทับกันหากเครื่องมือรองรับ
- ถ้าใช้สองแคมเปญที่ไม่ได้สุ่มแบ่งกลุ่มให้เรียกว่าการเปรียบเทียบเชิงสังเกต ห้ามอ้างเป็น causal A/B winner
- ข้อมูลยังน้อยหรือ cohort ยังไม่สุก ให้ผล “ยังสรุปไม่ได้ / ทดสอบต่อ” ไม่เลือกผู้ชนะเพราะตัวเลขสัปดาห์เดียวดูดีกว่า
- จำนวนตัวอย่างและ confidence/power ขึ้นกับ baseline และ minimum detectable effect ที่ทีมเลือก จึงยังไม่ตั้งเกณฑ์ตัวเลขสมมติ
- การทบทวนรายสัปดาห์ใช้ดูความพร้อมและปัญหางานได้ แต่การตัดสินผู้ชนะต้องเป็นไปตามแผนทดลองที่ประกาศไว้
- ทุกข้อสรุปมีเหตุผล ผู้รับผิดชอบ และวันทบทวนถัดไป คู่มือนี้ไม่ได้อนุมัติการเพิ่มงบหรือสั่งซื้อ Ads

## ความสอดคล้องกับโครงการและขอบเขตหลักฐาน

ตรวจเอกสารและ source ที่เกี่ยวข้องใน checkout ซึ่งอิง `origin/main` ที่ `32e02e5cbe526f8c9ab1d53e11da9a0558bbc320` วันที่ 2026-10-04 ไม่มีการอ้างอิงว่า production เปิดใช้งานตาม Flow นี้แล้ว

| ประเด็น | สิ่งที่ตรวจพบ | ขอบเขต |
|---|---|---|
| LINE เป็นช่องทางหลัก | `docs/PRODUCT.md` ข้อความ current authority, `AGENTS.md`, ADR-024 | ใช้หลักปัจจุบัน ไม่ใช้ข้อความ legacy replacement ในเอกสารเก่า |
| Runtime | `docs/decisions/ADR-110-RETIRE-EDGE-DEVICE-AND-HARNESS-SURFACES.md` | LINE Server/Conversation Runtime; ไม่วาด Edge Device ที่ถูกเลิกใช้ |
| เจ้าของข้อมูล | Marketing / CRM / LINE OA Studio / Commerce charters | เป็นบริบทการจัดเลน ไม่ใช่ผล UAT |
| งานติดตามขาย | `docs/domains/crm/features/FR-161-sales-tasks.md`; `apps/server/src/modules/crm/sales-task-domain.js` | source มี OPEN → IN_PROGRESS → DONE; CANCELLED และ REOPEN แยกกัน ไม่เท่ากับสถานะ Lead |
| ออเดอร์ | `docs/domains/commerce/features/FR-166-sales-orders.md`; `apps/server/src/modules/commerce/domain/commerce.js` | source มี DRAFT → CONFIRMED → COMPLETED / CANCELLED |
| เงิน | `docs/domains/commerce/features/FR-163-payments-and-revenue.md`; commerce domain source | Payment PENDING → VERIFIED / REJECTED; payment state UNPAID/PARTIAL/PAID/OVERPAID/REFUNDED; VERIFIED net เป็นเกณฑ์รวมเงิน |
| Ads results | `docs/domains/marketing/CHARTER.md`; `apps/server/src/modules/marketing/components/campaigns/CampaignResultsTab.jsx` | UI มี explicit unavailable สำหรับไม่มี approved provider/manual measurement source ใน slice นี้ ไม่ยืนยันว่า Ads integration พร้อม |
| ส่ง chat ไป sales task/order | ขอบเขต “Not in this slice” ของ FR-161/FR-166 | เป็นช่องต่อที่ต้องตรวจ current implementation เพิ่มก่อนทำระบบจริง; คู่มือเสนอพฤติกรรม ไม่ประกาศว่า converter ทำงานแล้ว |
| Lead lifecycle/Ads attribution/weekly A/B | คำขอของผู้ใช้ + ข้อเสนอฉบับนี้ | ต้อง review contract, แหล่งข้อมูลและ acceptance tests ก่อนเขียนระบบ |

ไม่ได้รัน application test/build/e2e หรือทดสอบ LINE, Ads, การส่งข้อความ, การโทร หรือการชำระเงินจริง: **NOT_RUN** ตรวจเฉพาะเอกสาร/source ที่เกี่ยวข้องและคุณภาพ artifact ที่สร้าง

## Acceptance สำหรับคู่มือ

- เห็น Ads/A/B, statistics, LINE inbound, AI reply, phone permission, admin handoff, follow-up, order/payment, weekly feedback ครบ
- งานโทรมี owner และกำหนดเวลา; มีทางออกไม่ให้เบอร์/โทรไม่ติด/ไม่ซื้อ/ยกเลิก/คืนเงิน
- ทุกขั้นมีสถานะและตัววัด; cohort และ activity week แยกกัน; missing data ไม่แสร้งเป็นศูนย์
- ระบุชัดว่าเป็น Flow ที่เสนอ และแยก enum ที่ยืนยันจาก source ออกจากสถานะธุรกิจที่เสนอ
- ภาพอ่านได้ ไม่มีข้อความชนกล่อง/หลุดกรอบ HTML ไม่มี JavaScript และใช้สี/ฟอนต์ Zuri

## Version diff

```diff
+ v0.1.0 — สร้างคู่มือภาพหน้าเดียว 8 ขั้น 4 เลนสำหรับทีม Ads/แอดมินขาย
+ เพิ่มเงื่อนไขพร้อมโทร เจ้าของงาน ทางติดตาม และการตรวจเงิน
+ เพิ่ม KPI รายสัปดาห์ cohort, A/B, attribution และสูตรที่ตรวจสอบได้
+ แยกข้อเสนอออกจากหลักฐานโครงการ พร้อมขอบเขต NOT_RUN
```

ไม่มีการแก้ application code, canonical registry, compatibility export หรือ generated governance views

## ผลตรวจ artifact

ตรวจวันที่ 2026-10-03:

- **PASS** — `diagram-design/scripts/self_check.py`: accessible SVG, HTML ไฟล์เดียว, ไม่มี JavaScript และไม่มี remote asset นอก Google Fonts
- **PASS** — ตรวจ geometry: 8 nodes / 9 flow edges / 2 จุดเน้น; ไม่มีข้อความซ้อน/ล้นกล่อง, label mask ทับ node หรือเส้นผ่านกล่องที่ไม่ใช่ปลายทาง
- **PASS** — Chromium โหลด IBM Plex Sans Thai สำเร็จและตรวจภาพที่ render แล้ว
- **PASS** — จอ 390px เลื่อนเฉพาะภาพในกรอบ ไม่ทำให้ทั้งหน้าเลื่อนแนวนอน
- **PASS** — print rendering เป็น A4 แนวนอน 1 หน้า; PNG ขนาด 3360 × 2376
- **NOT_RUN** — application tests/build/e2e, production, Ads account, LINE message และรายการเงินจริง ไม่อยู่ในขอบเขตการสร้างคู่มือ

หลักฐานสรุป geometry, mobile layout และ print CSS ที่เก็บใน repository อยู่ที่ [evidence/flow-validation-v0.1.json](evidence/flow-validation-v0.1.json); QA PDF อยู่ในโฟลเดอร์ artifact ภายนอกและไม่ได้รวมไว้ที่นี่

## สกิล

ใช้ `diagram-design` เวอร์ชัน 2.6 ที่มีอยู่แล้วใน `C:\Users\freshair\.codex\skills\diagram-design` ตรวจว่า `SKILL.md` ตรงกับ upstream `cathrynlavery/diagram-design` เมื่อ normalize line endings วันที่ 2026-10-03 จึงไม่ติดตั้งทับ การใช้สี Zuri มาจากคำสั่งผู้ใช้ใน AGENTS.md และใช้กับ artifact นี้เท่านั้น

Source: https://github.com/cathrynlavery/diagram-design
