---
id: ZAI:EDGE-DESKTOP-UI-INVENTORY
title: Zuri Edge Desktop — sidebar interface inventory
parent_requirement: FR-150
domain: agent
source: v2-native
version: "0.3.1b"
status: beta
approval: "Owner approved sidebar delta in section 11 on 2026-09-09"
created_at: "2026-09-08T22:00:02+07:00,RWANG,base b17e7258"
last_update: "2026-09-09T14:15:00+07:00,RWANG"
relations:
  - type: references
    target: ZAI:FR-150
  - type: references
    target: ZAI:FR-144
  - type: references
    target: ZAI:FR-141
  - type: relates_to
    target: ZAI:FR-150-P2
  - type: references
    target: ../../../UI-DESIGN-SYSTEM.md
---

# Zuri Edge Desktop — inventory และ wireframe แบบ sidebar

**สถานะ: เจ้าของงานอนุมัติ sidebar ใน §11 เมื่อ 2026-09-09; อยู่ระหว่าง implementation และตรวจรับ แอปที่ติดตั้งไม่ได้อัปเดตตามเอกสารโดยอัตโนมัติ**

§1–10 เก็บเหตุผลและสัญญาของ baseline เดิม; §11 ระบุเฉพาะส่วนต่างการนำทางตามคำขอใหม่
§11 ที่อนุมัติแล้วแทนข้อกำหนดแท็บแนวนอนใน §2/§7 ส่วนสัญญาสถานะและ controls เดิมยังใช้ต่อ

ขอบเขต C-2 / MEDIUM: เปลี่ยนโครงสร้างหน้าและการนำทางของ Desktop ใน FR-150-P2
ใช้ pairing, provider และ worker contracts เดิม เพิ่ม local read-only diagnostics ตามคำขอชื่อเครื่อง/สเปค
ไม่เพิ่ม requirement ID หรือเปลี่ยนสิทธิ์
เจ้าของงานขอให้ไม่มีการเลื่อน และเปลี่ยนไปเป็นหน้าในแท็บที่แสดงทีละหน้า
Inventory ในเอกสารนี้หมายถึงหน้าจอ ข้อมูล ปุ่ม สถานะ และเส้นทางใช้งานของ Desktop

## 1. ปัญหาและหลักการออกแบบ

หลักฐานก่อนออกแบบ baseline 0.1 จาก `apps/edge/public/index.html`, `desktop.css`, `desktop.js` และคำสั่ง native:
หน้าเดิมวาง Connect, AI, Worker, Device status และ Advanced ต่อกันในแนวตั้ง
QR กับ Advanced ใช้ details ขยายลงด้านล่าง; รายการโมเดลใช้ select ที่มีรายการยาว
ปุ่ม Start/Stop และข้อผิดพลาดบางส่วนจึงอยู่นอกจอเมื่อเปิดการตั้งค่าอื่น

แบบใหม่ใช้หลักต่อไปนี้:

1. แบ่งตามงาน: ดูสถานะ / เชื่อมต่อ / ตั้ง AI / ดูแลแอป แยกจากลำดับ onboarding
2. แสดงทีละ panel: หน้าใหม่แทนหน้าปัจจุบัน ไม่เพิ่มความสูงต่อท้าย
3. ตำแหน่งคงที่: native title, แถบแท็บ และพื้นที่ปุ่มท้ายหน้าคงตำแหน่ง
4. งานหลักชัด: หนึ่ง primary action ต่อหน้า; Stop ยังเข้าถึงได้เมื่อมี process ที่แอปเป็นเจ้าของ
5. เปิดรายละเอียดเมื่อจำเป็น: ตั้งค่าขั้นสูงและผลตรวจยาวเปิดเป็นหน้าย่อยพร้อม Back
6. สถานะมีข้อความ: แยกจับคู่แล้ว / ยืนยันกับ Server / บันทึก AI / Login / รับงานจริง
7. ไม่มี scroll ภายใน Desktop: ใช้ค้นหา แบ่งหน้า และขั้นตอนย่อย แทนการตัดข้อมูล

หลัก progressive disclosure อ้างอิง [NN/g](https://www.nngroup.com/articles/progressive-disclosure/)
และ keyboard/focus ของแท็บอ้างอิง [WAI-ARIA Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
ใช้ร่วมกับ [Zuri design system](../../../UI-DESIGN-SYSTEM.md) โดยข้อกำหนด no-scroll
ของเจ้าของงานมีผลเหนือรูปแบบตารางเลื่อนแนวนอนทั่วไปใน design system

## 2. Sitemap และ shell

```text
Native title: Zuri Edge Device v<package version> — Control & Zero-Trust Pair
App header: Zuri Edge Device | ชื่อคอมพิวเตอร์จริง / ธุรกิจ | สถานะการเชื่อมต่อ
Tabs: [ภาพรวม] [เชื่อมต่อ] [ตัวช่วย AI] [ตั้งค่า]
                       ↓ แสดงเพียง panel ที่เลือก
ภาพรวม      → สถานะ worker / prerequisites / heartbeat / สรุป CPU-RAM-GPU
            → สเปคเครื่อง: ระบบและ CPU / RAM และ GPU / พื้นที่จัดเก็บ (แบ่งหน้า)
เชื่อมต่อ    → ยังไม่จับคู่ | รอยืนยันผ่าน Browser/QR | จับคู่แล้ว | ล้มเหลว
ตัวช่วย AI   → เลือก Ollama / Codex / Claude → แบบฟอร์มเฉพาะตัวที่เลือก
            → เลือกโมเดล Ollama: ค้นหา + รายการแบ่งหน้า
ตั้งค่า      → เมนู 3 รายการ
            → การเชื่อมต่อขั้นสูง: Server URL / import JSON
            → ตรวจโปรแกรม: เลือก CLI / ตรวจเวอร์ชัน
            → เวอร์ชันและอัปเดต: เวอร์ชันจริง / ตรวจอัปเดต / ข้อจำกัด
Panel footer: ข้อความช่วยเฉพาะงาน | Back / Cancel / Save / Start / Stop ตามหน้า
```

เปิดแอปครั้งแรกที่ยังไม่จับคู่ → แท็บเชื่อมต่อ; มี identity แล้ว → ภาพรวม
อ่านสถานะไม่ได้ → ภาพรวมแบบ unavailable พร้อม Retry ไม่มีการเดาว่าไม่ได้จับคู่
หลังจับคู่สำเร็จแสดงผลในหน้าเดิมพร้อมปุ่ม “ตั้งค่าตัวช่วย AI”; ไม่กระโดดหน้าเอง
หลัง Save ใช้ปุ่ม “ไปภาพรวม” ชัดเจน ไม่ Start หรือเปลี่ยน provider อัตโนมัติ
Back เปลี่ยนหน้าภายใน panel เท่านั้น ไม่ใช่ browser history

## 3. Interface inventory ใหม่

คีย์ UI ด้านล่างเป็นชื่อ anchor ภายในเอกสาร ไม่ใช่ global FR/FEAT ใหม่

| หน้า | เป้าหมาย / ข้อมูลที่แสดง | ปุ่มและคำสั่งเดิมที่ใช้ | สถานะสำคัญ |
|---|---|---|---|
| UI-OV ภาพรวม | worker state, process ownership, business/device, provider/model ที่บันทึก, เวลายืนยัน heartbeat | `get_edge_status`, `get_worker_status`, `get_provider_settings`, `start_worker`, `stop_worker`, `send_heartbeat_now`; ลิงก์ไปแก้ prerequisite | UNKNOWN, STOPPED, STARTING, RUNNING, DEGRADED, STOPPING, FAILED, EXTERNAL_UNVERIFIED |
| UI-CON เชื่อมต่อ | ธุรกิจ/เครื่อง/Server, identity ที่บันทึก, ผลยืนยันล่าสุด; ก่อนจับคู่แสดงคำอธิบายสั้น | `connect_zuri`, `get_edge_status`, `send_heartbeat_now`; ไปตั้ง Server / import | missing origin, unpaired, configured/unverified, verified, read error |
| UI-PAIR รอยืนยัน | รหัสตรวจสอบ, เวลาหมดอายุ, Browser และ QR ใน panel เดียวที่จอปกติ; จอ compact เปิด QR เป็นหน้าเฉพาะ | `open_pairing_browser`, `poll_pairing` retry/cancel; จับคู่สำเร็จแล้วไป AI ด้วยปุ่ม | pending, browser-open failed, denied/cancelled, expired, polling error, handover error, paired |
| UI-AI ตั้ง AI | radio choice 3 providers, เฉพาะฟอร์มตัวที่เลือก, model ต่อ provider, สถานะ Login; cloud permission แสดงเฉพาะ CLI | `get_provider_settings`, `save_provider_settings`, `get_provider_status`, `start_provider_login`, `cancel_provider_login` | loading, clean, dirty, saving, error; MISSING, LOGGED_OUT, AUTHENTICATING, READY, FAILED, BLOCKED |
| UI-MODEL เลือกโมเดล | Ollama URL, คำค้น, ผลลัพธ์และจำนวน, โมเดลที่เลือก; สูงสุด 5 แถวต่อหน้าในขนาดปกติ | `discover_ollama`; filter/pagination ทำที่ UI จากรายการที่ได้; Back / เลือกโมเดลนี้ | unavailable, empty, no matches, selected model missing, loading |
| UI-SET ตั้งค่า | ทางเข้าการเชื่อมต่อขั้นสูง / ตรวจโปรแกรม / เวอร์ชันและอัปเดต | การนำทางใน UI เท่านั้น | read-only เมื่อ worker ทำงาน; badge updater unavailable |
| UI-ADV การเชื่อมต่อขั้นสูง | Server origin และ import file; ตัวช่วยระบุ format โดยไม่แสดง key | `connect_zuri` ใช้ URL เมื่อเริ่มจับคู่; `import_pairing_payload`; Back | invalid URL, oversized/invalid JSON, persistence failure, locked while active |
| UI-CLI ตรวจโปรแกรม | เลือก Codex หรือ Claude; เวอร์ชัน/ผลตรวจและข้อความว่าการพบ CLI ไม่ได้ยืนยัน Login | `check_headless_cli`; Back / ตรวจอีกครั้ง | missing, timeout, nonzero, found; ไม่แสดง READY จาก --version |
| UI-ABOUT เวอร์ชันและอัปเดต | package version, updater availability, ผล check แยกจากการติดตั้ง | `get_app_version`, `check_app_update`; Back / ตรวจอัปเดต | unavailable, checking, check failed, update found, no newer release; ไม่มี install-success state ปลอม |
| UI-DETAIL รายละเอียดผลตรวจ | ข้อความปลอดภัยฉบับเต็มที่แบ่งหน้า พร้อมชื่อหัวข้อและ Back | UI pagination เท่านั้น; ไม่โหลด/คัดลอก token หรือ raw CLI output | คงข้อความที่อ่านอยู่เมื่อ status polling เปลี่ยน |
| UI-HW สเปคเครื่อง | ชื่อเครื่องจาก OS, Windows/build/architecture, CPU/cores/threads, RAM, GPU/VRAM, fixed volumes และเวลาที่ตรวจ | เสนอ `get_machine_inventory` แบบ local read-only; ตรวจตอนเปิดแอป / ตรวจอีกครั้ง / Back / ก่อนหน้า / ถัดไป | loading, ready, partial, unavailable; แยกผลรายแหล่ง ไม่แทน unknown ด้วยศูนย์ |

UI-ADV **ไม่มีปุ่ม Save Server ที่อ้างว่าบันทึกสำเร็จ**: ปัจจุบันมีเพียง input ให้
`connect_zuri` ใช้เมื่อเริ่มคำขอ ไม่เพิ่ม API บันทึก Server แยกโดยไม่ออกแบบ contract
การนำเข้า JSON เป็นทางเลือก compatibility; คงไว้ใน settings ไม่แข่งขันกับ Connect

## 4. ย้ายรายการเดิมไปที่ใด — ไม่ทำ control หาย

| รายการ/DOM เดิม | ตำแหน่งใหม่ | วิธีจัดการ |
|---|---|---|
| brand, version, statusBadge | native title + app header + UI-ABOUT | title ใช้ package metadata; badge แสดงสถานะการเชื่อมต่อเท่านั้น |
| business, device, server | context header + UI-CON / UI-ADV | แยก OS computer name กับ registered device UUID/label; header ย่อชื่อได้ แต่เปิดรายละเอียดเต็มได้โดยไม่ใช้ hover อย่างเดียว |
| heartbeat, workerState | UI-OV | แยกเวลายืนยันของ shell กับ worker; ค่าเก่าเป็นประวัติ ไม่ใช่สัญญาณว่ายัง online |
| connect, retryStatus, verify | UI-CON; Retry/ตรวจการเชื่อมต่อใน UI-OV ตามสถานะ | ไม่ duplicate primary action; native เป็นผู้ยืนยันผล |
| pending, checkCode, expiry, openBrowser, qr, retryPair, cancel | UI-PAIR | pending แทน landing panel; QR อยู่ข้าง instructions ที่จอปกติ หรือเป็นหน้าเฉพาะที่จอ compact ไม่ขยายลงท้าย |
| provider, providerModel, providerAuth, providerLogin, cancelLogin, providerCheck | UI-AI | แสดง provider เดียว; กดเปลี่ยน provider ไม่ใช่กด Login; Login ยกเลิกได้แม้เปลี่ยนแท็บ |
| ollamaUrl, discoverModels, ollamaModel | UI-AI / UI-MODEL | ค้นหา + pagination แทน dropdown ที่เลื่อนรายการ |
| allowCloud, saveProvider, providerMessage | UI-AI + panel footer | มี checkbox เฉพาะ external; บันทึกไม่ได้เท่ากับพร้อม inference |
| startWorker, stopWorker, workerStatus, workerReason | UI-OV + action footer | Stop คงเข้าถึงได้จากทุกแท็บเมื่อ `active=true` รวม FAILED; ไม่เริ่มซ้ำ |
| settings, baseUrl, pairingFile | UI-SET → UI-ADV | ไม่มี accordion; file picker ของ OS เป็น external surface |
| cli, checkCli | UI-SET → UI-CLI | diagnostic มีที่เดียว ไม่สับสนกับเลือก provider ใช้งาน |
| checkUpdate | UI-SET → UI-ABOUT | แจ้ง auto update ยังไม่พร้อมตาม RCA ไม่เสนอว่า check คือ install |
| error, message | feedback area ของแต่ละ panel + UI-DETAIL | สั้นพออ่านจบในหน้า; ข้อความเต็มเปิดหน้ารายละเอียดแบ่งหน้าได้ |

## 5. No-scroll และขนาดหน้าต่าง

เป้าหมายเริ่มต้น: client area ประมาณ 1050×680 logical px แล้ว clamp ตามพื้นที่จอ
ไม่ใช้ค่าความสูง 780 แบบเดิมโดยสมมติว่าทุกจอมีพื้นที่พอ พื้นที่ title bar/taskbar
ต้องหักจาก monitor work area ก่อนกำหนดขนาดหน้าต่าง

| พื้นที่ใช้งานจริง | Layout |
|---|---|
| ตั้งแต่ 960×600 | header 56, tabs 48, footer 64; panel ใช้สองคอลัมน์ได้; model 5 แถวต่อหน้า |
| 800×560 | ลดช่องว่างเป็น 16; เนื้อหา 1–2 ส่วน; model 3 แถวต่อหน้า |
| 640×480 | compact: หนึ่งกลุ่มข้อมูล/ขั้นตอนต่อหน้า; model 2 แถว; QR หน้าเฉพาะ |
| ต่ำกว่า 640×480 | ต้องประเมิน monitor/DPI ก่อน implement; ไม่อ้างว่ารองรับโดยซ่อนเนื้อหา ขนาดนี้เป็น open acceptance constraint ของแบบ |

ทุกขนาดใช้ page/panel สูงเท่าพื้นที่ที่เหลือ ไม่ซ้อน scrollbar, scrollable modal,
accordion ขยายสูง, horizontal tab-strip scrolling หรือ infinite list
ถ้าข้อความ/font scaling ทำให้กลุ่มเกินพื้นที่ ให้แยกเป็นอีกขั้นด้วย Back/Next;
จำนวนแถวต้องปรับลงตามความสูงจริง ไม่ล็อก 5 แถวที่ทุกขนาด
ห้ามใช้ `overflow:hidden` อย่างเดียวเพื่อทำให้ test ดูว่าไม่มี scrollbar
fields, consent, error recovery และปุ่มสำคัญต้องไม่ถูกตัดหรือหาย
ชื่อโมเดลยาวเปิดหน้าเลือก/ยืนยันชื่อเต็มและแบ่งบรรทัด ไม่ใช้ ellipsis เป็นข้อมูลเดียว
รายละเอียดแบบยาวแบ่งตามย่อหน้า/บรรทัดด้วย “ก่อนหน้า / ถัดไป” ไม่ใช้การเลื่อน

ขอบเขต no-scroll คือ UI ที่ Desktop ควบคุม; Browser login, กล้องมือถือ และ file picker
ของ OS เป็น external surfaces ซึ่งแอปไม่ได้ควบคุมพฤติกรรม scroll

## 6. Navigation, state และ error recovery

- แท็บเป็น navigation ที่ไม่ทำ side effect; ไม่อนุญาตให้ focus/เปลี่ยนแท็บ trigger Login, Save, Start หรือยกเลิก pairing
- การสลับแท็บคง pairing/auth polling และ draft settings ในหน่วยความจำ; unmount view ไม่ยกเลิกงาน
- dirty draft มีจุดเตือนบนแท็บ AI; เปลี่ยนแท็บได้; กลับมาข้อมูลยังอยู่
- เปลี่ยน provider ภายในหน้า AI เก็บ draft แต่ละ provider แยกกัน; backend ใช้ชุดที่บันทึกเท่านั้น
- ปุ่มบันทึกระบุสิ่งที่จะบันทึก เมื่อสำเร็จจึง clear dirty; ล้มเหลวเก็บค่าที่ผู้ใช้กรอก
- ขณะ active ล็อก mutation ของ identity/provider แต่ยังดูสถานะ ตรวจผล และกด Stop ได้
- ความล้มเหลวของการอ่าน worker status ไม่ทำให้ลืม process ownership หรือเปิดให้เริ่มซ้ำ
- error ระบุสาเหตุและการแก้ เช่น “ไม่พบ Ollama — เปิด Ollama แล้วค้นหาอีกครั้ง”; ไม่ใช้โค้ด error เป็นคำอธิบายเพียงอย่างเดียว
- หน้าอื่นมี pending badge ให้กลับไปดู pairing/Login ได้; ไม่ปิดคำขอเพราะผู้ใช้ไปดูภาพรวม
- เมื่อ pairing หมดอายุ ปิดการเปิดลิงก์/QR เดิมและเสนอ “เริ่มเชื่อมต่อใหม่”; สร้างคำขอใหม่ผ่านคำสั่งเดิม ไม่ต่ออายุ capability เก่าใน UI
- การปิดหน้าต่างยังใช้ lifecycle ที่อนุมัติแล้ว; การเตือน draft ก่อนปิดไม่เปลี่ยนสิทธิ์หรือขัดขวาง Stop
- เปลี่ยนแท็บแล้ว focus อยู่ที่แท็บ; เปิดหน้าย่อยแล้ว focus heading; Back กลับปุ่มที่เปิดหน้านั้น

## 7. Visual และ accessibility contract

คงเอกลักษณ์ Desktop ปัจจุบัน: dark neutral surfaces กับ Amber Citrus ไม่เปลี่ยนเป็นธีมอื่น
ใช้ tokens ของ Zuri, spacing บนกริด 4px, body 14–16px, label อย่างน้อย 13px,
control สูงอย่างน้อย 44px ในแบบนี้; หนึ่งขอบ/ระดับพื้นหลังต่อกลุ่ม ไม่ซ้อน card หลายชั้น
เลือกสีตัวอักษรบนปุ่มส้มให้ contrast ผ่านจริง ไม่ถือว่าสีขาวผ่านอัตโนมัติ
สถานะใช้ข้อความ + icon/tone, focus ring มองเห็น, ไม่ใช้ hover เป็นทางเข้าข้อมูลเดียว

Tabs ใช้ tablist/tab/tabpanel, selected state และ roving tabindex;
Left/Right เปลี่ยน focus, Home/End ไปปลาย, Enter/Space เปิด panel,
Tab เข้า controls ของ panel; panel ที่ซ่อนต้องไม่อยู่ใน keyboard/assistive tree
เลือก manual activation เพื่อไม่ให้แค่เลื่อน focus trigger การอ่านหรือเปลี่ยนหน้าที่ยังไม่ต้องการ
provider choices ใช้ radio group แยกจาก navigation tabs
Feedback ปกติเป็น polite status; blocking error แจ้ง alert ครั้งเดียว ไม่อ่านซ้ำทุก polling tick
ไม่ disable browser/text zoom; การรองรับ text scaling ต้องทดสอบก่อนอ้าง accessibility pass

## 8. ชื่อคอมพิวเตอร์จริงและตรวจสเปคอัตโนมัติ — เพิ่ม 2026-09-08

คำขอเจ้าของงาน: แสดงชื่อคอมพิวเตอร์ตามจริงและตรวจสเปคอัตโนมัติ
ขอบเขต C-2 / MEDIUM เพิ่ม collector อ่านอย่างเดียวใน native layer;
เจ้าของงานอนุมัติแบบรวมในข้อความถัดจากข้อเสนอฉบับ 0.2.0b

**หลักฐานปัจจุบัน:** `commands.rs::connect_zuri` อ่าน `COMPUTERNAME` เฉพาะตอนส่ง
label เพื่อจับคู่ (มี fallback `Zuri Desktop`); `status_value` ยังไม่คืนชื่อ OS หรือสเปค
และเมื่อ enumerate command registry ใน `src-tauri/src/lib.rs` ยังไม่มี hardware inventory command
ชื่อใน header ของแบบก่อนเป็นข้อมูลตัวอย่าง ไม่ใช่ข้อมูลที่ตรวจจากเครื่อง

**การแสดงผลและตัวตน**

- header แสดง computer name ที่อ่านจาก OS; ชื่อธุรกิจอยู่แยกกันและต้องมาจาก pairing จริง
- computer name เป็นชื่อแสดงผล ไม่ใช่ UUID, ไม่ใช่ชื่อบัญชี Windows และไม่ใช้เป็นหลักฐานสิทธิ์
- registered label เก่ากับชื่อเครื่องปัจจุบันอาจต่างกัน; แสดงแยกในรายละเอียด ไม่เปลี่ยน binding หรือสร้าง device ใหม่เมื่อ rename เครื่อง
- อ่านชื่อไม่ได้แสดง “อ่านชื่อเครื่องไม่ได้” พร้อมตรวจอีกครั้ง ไม่ใส่ชื่อเครื่องตัวอย่างแทน
- ภาพรวมมีบรรทัด CPU/RAM/GPU และปุ่ม “สเปคเครื่อง”; รายละเอียดแทน panel เดิม
  โดยใช้หน้าระบบและ CPU / RAM และ GPU / พื้นที่จัดเก็บ และ pagination ตามขนาดจอ
  ไม่เพิ่มการ์ดยาวจนต้องเลื่อนหรือย้าย Stop ออกนอกจอ

**ข้อมูลที่ตรวจและหน่วย**

| ข้อมูล | แหล่งบน Windows / วิธีแสดง |
|---|---|
| ชื่อเครื่อง | OS computer name เช่น `Win32_ComputerSystem.Name`; อ่านใหม่ทุกครั้งที่เปิดแอป |
| ระบบ | `Win32_OperatingSystem`: Caption, Version, OSArchitecture |
| CPU | `Win32_Processor`: Name, NumberOfCores, NumberOfLogicalProcessors; หลาย socket เป็นรายการ |
| RAM | ผลรวม `Win32_PhysicalMemory.Capacity` เป็น installed; `TotalPhysicalMemory` เป็น OS-visible; ไม่เรียกค่าหลังว่า RAM ว่าง |
| GPU | `Win32_VideoController.Name`, DriverVersion; หลาย adapter ต้องแสดงครบด้วย pagination |
| VRAM | ใช้แหล่งที่คืนความจุได้ถูกต้อง เช่น NVIDIA `nvidia-smi` เมื่อมี; ต้องจับคู่ adapter ได้แน่นอน มิฉะนั้นแสดง unavailable รายการนั้น |
| พื้นที่จัดเก็บ | fixed logical volumes: drive letter, total bytes, free bytes; เป็นพื้นที่ volume ไม่อ้างเป็นจำนวน physical SSD |
| เวลาและแหล่งข้อมูล | capturedAt ต่อผลตรวจ; bytes เก็บเป็นตัวเลข, แสดง GiB/MiB และ label ชัดเจน |

[Microsoft ระบุ AdapterRAM เป็น uint32](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-videocontroller)
จึงไม่ใช้ field นี้ยืนยัน VRAM ของการ์ดเกิน 4 GiB; หากแหล่งที่ถูกต้องอ่านไม่ได้ให้แสดง unknown
ไม่เดาจากชื่อ GPU และไม่รายงาน shared system memory เป็น dedicated VRAM
[ComputerSystem](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-computersystem)
เป็นแหล่งสำหรับชื่อเครื่องและหน่วยความจำที่ OS มองเห็น

**พฤติกรรม collector ที่เสนอ**

1. เพิ่ม native IPC `get_machine_inventory` แบบไม่มี arbitrary command/path arguments
   คืนเฉพาะ allowlisted fields ด้านบน พร้อม `capturedAt`, `status` และ safe field errors
2. ตรวจหนึ่งครั้งอัตโนมัติเมื่อเปิด Desktop แม้ยังไม่จับคู่; ทำ async มีเวลารวมไม่เกิน 10 วินาที
   ต่อรอบและคืน partial results ได้ ไม่บล็อก shell, pairing หรือ worker
3. ปุ่ม “ตรวจอีกครั้ง” อ่านใหม่; coalesce คำขอซ้อน ใช้ snapshot เดียวในหน่วยความจำเมื่อสลับแท็บ
   ไม่มี polling GPU/CPU usage, benchmark หรือ periodic background scan ในขอบเขตนี้
4. query ใช้ Windows APIs/CIM แบบอ่านอย่างเดียว; helper ที่จำเป็นใช้คำสั่งคงที่, จำกัด output,
   ซ่อนหน้าต่าง, ไม่ขอ admin และจบ process เมื่อ timeout; ไม่ใช้ script จาก server/user
5. ค่าที่อ่านไม่ได้เป็น null + error ราย field; แยก stale snapshot จากค่าที่เพิ่งอ่านได้
   ไม่มี IPC ใน browser preview ให้ unavailable ไม่ส่งค่าตัวอย่างเป็นผลตรวจจริง
6. เก็บเพื่อแสดงใน Desktop เท่านั้น; ไม่เพิ่ม hardware payload ใน heartbeat, LINE หรือ provider context
   ไม่เก็บ serial number, MAC/IP, Windows username, license key หรือรายการไฟล์
7. สเปคเป็นข้อมูลประกอบ ไม่ยืนยันว่า Ollama ใช้ GPU ได้หรือโมเดลรันได้จริง และไม่เปลี่ยน provider/model อัตโนมัติ

**Acceptance เพิ่มเติมหลังอนุมัติ:** เปรียบเทียบผล native กับ Windows ในเครื่องจริง,
ทดสอบชื่อเปลี่ยน/อ่านไม่ได้โดย UUID คงเดิม, RAM installed ต่างจาก OS-visible,
GPU หลายตัว/ไม่มี NVIDIA tool/VRAM เกิน 4 GiB, timeout/permission/partial result,
offline/unpaired, ไม่มีหน้าต่าง helper โผล่, ไม่ส่ง hardware ออก network และ no-scroll
ที่ขนาดจอเดิมรวมรายการ CPU/GPU/volume ยาว

ผลตรวจจริงในรอบออกแบบนี้เป็นหลักฐานว่าเครื่องอ่านข้อมูลได้ผ่านเครื่องมือ Windows
ยังไม่ใช่หลักฐานว่า collector ภายในแอปทำงานแล้ว

## 9. Wireframe ที่ให้ตรวจ

ภาพเป็น design artifact; ข้อมูลสเปคและ computer name ในฉบับ 0.2 มาจากการตรวจเครื่องจริง
ส่วนธุรกิจและสถานะจับคู่/worker เป็นข้อมูลตัวอย่าง ไม่ใช่ผลจากแอปที่ติดตั้ง

- [ภาพรวม](assets/edge-desktop-ui-v0.1/overview.svg)
- [เชื่อมต่อ — รอยืนยัน](assets/edge-desktop-ui-v0.1/connect.svg)
- [ตัวช่วย AI — Claude](assets/edge-desktop-ui-v0.1/ai.svg)
- [ตั้งค่า](assets/edge-desktop-ui-v0.1/settings.svg)
- [ภาพรวมทั้งสี่แท็บ](assets/edge-desktop-ui-v0.1/board.png)
- [สเปคเครื่อง — ระบบและ CPU](assets/edge-desktop-ui-v0.1/hardware.png)

## 10. Acceptance / implementation หลังอนุมัติ

1. ย้าย controls ตาม inventory โดย reuse IPC handlers; เพิ่มเฉพาะ local diagnostics command ตาม §8
2. ทดสอบทุกหน้าและ error/pending/dirty state ว่า document, panel, list และ dialog ไม่มี scroll ทั้งสองแกน และ bounds ของปุ่ม/ข้อความสำคัญอยู่ใน viewport
3. ทดสอบ effective client sizes 1050×680, 960×600, 800×560, 640×480; Windows scaling 100/125/150/200%; text zoom 200%; เก็บ actual viewport ทุกครั้ง
4. ทดสอบชื่อธุรกิจ/URL/model ยาว, 0/1/25/100 models, error ยาว และ QR expiry โดยไม่มี control ถูกตัด; Back/Next เข้าถึงข้อมูลครบ
5. Keyboard-only เดินทุก control ได้, focus ไม่หลุดไป panel ซ่อน, screen reader ระบุ active tab/state ถูก และ polling ไม่รบกวน focus
6. เปลี่ยนแท็บระหว่างจับคู่/Login/Start/Stop แล้วงานเดิมดำเนินต่อ; dirty draft ไม่หาย; FAILED+active ยังกด Stop ได้
7. Desktop browser preview ยังคง fail closed; pairing key ไม่เข้าหน้า/URLผิดสัญญา; provider/account/local-only boundaries เดิมไม่เปลี่ยน
8. ตรวจ native title และขนาดหน้าต่างจริงบน Windows; browser mock pass ไม่เท่ากับ native GUI pass
9. Rust/Edge/UI regressions และ package smoke ตามขอบเขตที่แก้, build + governance ผ่าน แล้วค่อยส่งแพ็กเกจใหม่

Implementation refinement หลังตรวจรับ: จอเล็กแสดงทีละกลุ่มงาน;
เมื่อขยายตัวอักษรจะแบ่ง prerequisite/ข้อมูลสเปคและขั้นตอนตั้งค่า AI เพิ่มเติม
โดยทุก field และปุ่มบันทึกยังเข้าถึงได้ผ่านก่อนหน้า/ถัดไป ค่ายาวเปิดหน้าอ่านเต็ม
และแบ่งตามพื้นที่ที่วัดได้จริง เมื่อเปลี่ยนขนาดหน้าต่างยังเก็บข้อความครบทุกตัวอักษร
การอ่านสถานะ Worker ล้มเหลวต้องยกเลิกความพร้อม Start แต่คง Stop ตาม ownership
และผลตรวจ hardware ครั้งก่อนต้องติดป้ายข้อมูลเก่าเมื่ออ่านซ้ำไม่สำเร็จ

ผลทดสอบ UI, native และแพ็กเกจแต่ละประเภทบันทึกที่
[runtime repair acceptance](../../../../apps/edge/docs/EDGE-DESKTOP-TAURI-RUNTIME.md#14-repair-acceptance--2026-09-09)
การผ่าน browser fixtures ไม่ยืนยันว่าเครื่องที่ติดตั้งได้รับการอัปเดต
ไม่รวมการทำ auto updater ให้เสร็จ, provider ใหม่, live login, migration หรือ production deploy

## 11. Sidebar delta — 0.3.0b approved

### ขอบเขตและหลักฐาน

เจ้าของงานขอแถบนำทางแนวตั้งด้านซ้ายเหมือนภาพอ้างอิง โดยใช้ฟีเจอร์จริงของ Zuri Edge
ตรวจ baseline commit `e8c6b13eb2844272aa14a8ecc825a515fa17261c` แล้วมีสี่ panel
ใน `apps/edge/public/index.html` และ `TAB_ORDER`/`setTab` ใน `desktop.js` อยู่แล้ว
เปลี่ยนตำแหน่งการนำทางและจัดพื้นที่เนื้อหาใหม่ ไม่เพิ่มหน้า API, IPC หรือ provider

ความซับซ้อน **C-2**, ความเสี่ยง **MEDIUM**: sidebar ลดความกว้างใช้งานทุก panel
จึงต้องทดสอบการแบ่งหน้าและข้อความขยายอีกครั้ง แม้ใช้ handlers เดิม
สอดคล้อง FR-150-P2 และ runtime contract; inventory นี้เป็น peer ของข้อกำหนด Desktop
ส่วน design system ยังคงกำหนดสี ฟอนต์ และไอคอน Lucide

### เมนูจากฟีเจอร์จริง

| ตำแหน่ง / ชื่อ | ไอคอน | panel เดิม / งานที่เปิด |
|---|---|---|
| บน — ภาพรวม | LayoutDashboard | `panel-overview`: worker, heartbeat, prerequisites และสเปคเครื่องที่ตรวจอัตโนมัติ |
| บน — เชื่อมต่อ | Plug | `panel-connect`: จับคู่ผ่าน Browser/QR, ตรวจสถานะ และยกเลิก/ลองใหม่ |
| บน — AI (ชื่อเต็ม ตัวช่วย AI) | Bot | `panel-ai`: Ollama, Codex, Claude; ตั้งค่าโมเดลและ Login ตาม provider |
| ล่าง — ตั้งค่า | Settings | `panel-settings`: Server/import, ตรวจ CLI, เวอร์ชันและสถานะ updater |

สเปคเครื่องเป็นหน้าย่อยของภาพรวม; Codex/Claude/Ollama อยู่ในตัวช่วย AI ตามเดิม
ไม่มีการเพิ่ม Contacts, LINE chat, unread count หรือเมนูเลียนแบบภาพที่ Edge ยังไม่รองรับ
badge ใช้เฉพาะ pending/dirty/error ที่ได้จาก state เดิม พร้อมคำอธิบายที่อ่านได้

### โครงหน้าและการใช้งาน

1. Native title แสดงเวอร์ชันจริงตามแพ็กเกจ; sidebar เริ่มใต้ native title กว้างประมาณ 80 px
   มี Z ด้านบน, สามงานหลัก, ตั้งค่าชิดล่าง; ทุกเมนูมีไอคอนและชื่อสั้นให้เห็นเสมอ
2. ย้ายแถบแท็บด้านบนออก เนื้อหาด้านขวาจึงได้ความสูงคืน; header ยังแสดงชื่อเครื่องจริง
   ธุรกิจและสถานะตามข้อมูลที่อ่านได้ ไม่มีค่าตัวอย่างในแอปจริง
3. หน้าเลือกใช้พื้น amber tint และ indicator ด้านซ้าย พร้อม `aria-selected`;
   hover/focus tooltip เสริมชื่อเต็ม แต่ไม่ใช้ tooltip เป็นวิธีเดียวในการรู้ชื่อเมนู
4. ยังคงสี่ ARIA tabs: `aria-orientation="vertical"`, roving tabindex,
   Up/Down เลื่อน focus, Home/End ไปต้น/ท้าย, Enter/Space เปิดหน้าแบบ manual activation
   Settings เป็นรายการสุดท้ายในลำดับแป้นพิมพ์ แม้จัดชิดล่าง
   อ้างอิง [WAI-ARIA Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
5. สลับหน้าแล้ว draft, login, pairing polling และ worker ownership ไม่สูญหาย;
   หน้าย่อยและ Back ใช้ router เดิม ไม่เปิดหน้าต่างใหม่หรือเริ่มงานอัตโนมัติ
6. Footer ยังอยู่ทุกหน้า ปุ่มหยุดรับงานใช้ ownership guard เดิม รวม FAILED+active;
   disabled ได้เฉพาะตามสถานะจริง พื้นที่กดอย่างน้อย 44×44 px
7. จอเล็กแสดงทีละกลุ่มและใช้ก่อนหน้า/ถัดไป; คำนวณขนาดจากพื้นที่เนื้อหาที่เหลือหลัง sidebar
   ห้ามแก้ overflow ด้วยการซ่อน controls หรือข้อความที่ไม่มีทางเปิดอ่านครบ
8. เมื่อขยายตัวอักษร 200% ให้ rail ขยายเป็น 120 px และจัด pagination ใหม่
   โดยชื่อเมนูไม่ทับกันและเนื้อหาทุกส่วนยังเข้าถึงได้

### แบบให้ตรวจ

ภาพต่อไปนี้เป็น wireframe ของหน้าที่เลือก “เชื่อมต่อ”; สถานะยังไม่จับคู่เป็นตัวอย่าง
ชื่อเครื่องอ้างอิงผลตรวจจริงในรอบก่อน ตัวเลข v0.3.1 เป็นเวอร์ชันแพตช์ที่เสนอสำหรับงานนี้
ไม่ใช่หลักฐานว่ามี release v0.3.1 แล้ว; release ปัจจุบัน v0.3.0 คงเดิม

- [หน้าต่างปกติ 1080×720 — PNG](assets/edge-desktop-sidebar-v0.3/sidebar-wide.png)
  / [SVG](assets/edge-desktop-sidebar-v0.3/sidebar-wide.svg)
- [หน้าต่างเล็ก 640×480 — PNG](assets/edge-desktop-sidebar-v0.3/sidebar-compact.png)
  / [SVG](assets/edge-desktop-sidebar-v0.3/sidebar-compact.svg)

### Acceptance หลังอนุมัติ

1. เปลี่ยน navigation markup/CSS โดย reuse panel IDs, handlers และ state เดิม
2. ทดสอบสี่เมนูจริง การเลือกด้วย pointer/keyboard, focus/ชื่อเต็ม และ dirty/pending badge
3. ทดสอบทุกหน้า/หน้าย่อย รวม error, pending, QR, ชื่อยาว และ provider forms
   ที่ client sizes 1050×680, 960×600, 800×560, 640×480 และ text zoom 200%
   ต้องไม่มี scroll ทั้งสองแกนและทุก control เข้าถึงได้ด้วย pagination
4. ทดสอบเปลี่ยนหน้าระหว่าง pairing/login/save/worker transition; draft ไม่หาย
   และ Stop ยังใช้ได้ทุกหน้าเมื่อแอปเป็นเจ้าของ process
5. ตรวจ native window และ scaling ตาม §10 แยกจาก browser fixtures;
   รัน Edge/Rust/UI tests ที่เกี่ยวข้อง, build และ governance ตาม scope ก่อนส่งงาน
6. อัปเดต version จาก 0.3.0 เป็น 0.3.1 พร้อมกันตามแหล่ง version เดิมเมื่อ implement;
   การ build, publish และติดตั้งจริงต้องรายงานเป็นหลักฐานคนละขั้น

ไม่รวมการเปิด auto updater, provider login จริง, pairing กับธุรกิจ หรือแก้ฝั่ง Server
การอนุมัติส่วนนี้เปลี่ยนเฉพาะ layout/navigation ไม่เปลี่ยนขอบเขตระบบเดิม

### ผลตรวจ implementation 0.3.1b — 2026-09-09

Desktop package version เปลี่ยน **0.3.0 → 0.3.1**; four panels/IPC/worker ownership เดิม
ใช้ grid sidebar กว้าง 80 px, ขยายเป็น 120 px เมื่อ text zoom 200%
ตามผลวัด label จริง การแบ่งหน้าอ่านความกว้าง `appMain` หลังหัก sidebar
และกฎ AI เมื่อขยายข้อความใช้สถานะ compact เดียวกับตัวแบ่งหน้า

- Edge tests: 926 ผ่าน, 3 environment skips, 0 ล้มเหลว; TypeScript build ผ่าน
- Rust library: 36 ผ่าน, 4 ignored; Windows release build ผ่าน
- Browser mock IPC: 35 ผ่าน, 0 skipped, 0 retry, 0 flaky; รวม sidebar/keyboard/draft,
  สี่ viewport, ชื่อเมนูที่ 200%, Connect/Settings/AI Save และ Stop ownership
- Browser preview ผ่านการสลับหน้าและไม่มี page errors; ยังคง fail closed เมื่อไม่มี native IPC
- Portable runtime lifecycle จากแพ็กเกจรอบแรก: 1 ผ่าน บน synthetic loopback;
  ยังไม่ใช่ผลใช้งานกับธุรกิจจริงหรือผลติดตั้งผ่าน auto updater

ผลวัดและสาเหตุการปรับ text zoom อยู่ใน
[RCA](../../../../.brain/rca/2026-09-09-edge-sidebar-text-zoom-layout.md)
ผลแพ็กเกจสุดท้ายและ native acceptance แยกบันทึกใน
`apps/edge/dist-desktop/verification-tabs/SIDEBAR-ACCEPTANCE.md` (local evidence)
ผลชุดนี้ไม่ใช่ hosted CI, physical multi-DPI/clean-VM acceptance หรือ public release v0.3.1

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.3.1b | 2026-09-09 | beta | Implemented approved sidebar; 35 mock UI tests passed including measured Thai labels and AI steps at 200%; separate local native/package evidence | uncommitted | RWANG |
| 0.3.0b | 2026-09-09 | beta | Owner approved vertical sidebar using four existing panels, wide/compact wireframes and no-scroll regression criteria | uncommitted | RWANG |
| 0.2.2b | 2026-09-09 | beta | Recorded approved repair refinements, complete control reachability, measured detail pages and separate acceptance evidence | uncommitted | RWANG |
| 0.2.1b | 2026-09-08 | beta | Owner approved the combined tabbed UI and local hardware diagnostics; implementation acceptance tracked separately | uncommitted | RWANG |
| 0.2.0b | 2026-09-08 | candidate | Real OS computer name, automatic local hardware inventory, paginated details and partial-result acceptance | uncommitted | RWANG |
| 0.1.0b | 2026-09-08 | candidate | Initial four-tab inventory, no-scroll layout, state/keyboard contract and wireframes for owner review | uncommitted | RWANG |
