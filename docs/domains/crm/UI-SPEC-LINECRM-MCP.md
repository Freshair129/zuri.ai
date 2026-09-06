---
id: ZAI:DOC-UI-SPEC-LINECRM-MCP
title: LineCRM-MCP UI Specification & Architecture
version: "1.0.0"
status: active
created_at: "2026-09-06T22:30:00+07:00,Antigravity"
last_update: "2026-09-06T22:30:00+07:00,Antigravity"
relations:
  - type: relates_to
    target: ZAI:DOMAIN-CRM
  - type: relates_to
    target: ZAI:DOMAIN-LINE-OA-STUDIO
---

# LineCRM-MCP UI Specification & Architecture Guide

## 1. Executive Summary & Product Scope

**LineCRM-MCP** is an AI-native Business Operating & Customer Relationship suite integrated into **Zuri AI**. It bridges LINE Official Accounts (Multi-OA), CRM Member Lifecycle 360°, Point/Loyalty Programs, Automated Broadcast Campaigns, Visual Rich Menu Design, Trigger-Condition-Action Automation Workflows, and real-time **Model Context Protocol (MCP)** AI Tool Orchestration.

This specification details the 12 primary application modules and the top-level Hub navigation based on the visual guidelines and screenshots in `screenshot/`.

---

## 2. Design System & Tokens (Zuri Heritage + Glassmorphism)

### 2.1 Color Palette & Theme Tokens

The UI employs modern **Glassmorphism** with subtle backdrop-blur, soft translucent white borders, gentle box-shadows, and high-contrast typography.

```css
:root {
  /* Brand Primary & Accents */
  --brand-primary: #E8820C;        /* Amber Citrus */
  --brand-hover: #F09420;          /* Brand Hover */
  --brand-dark: #B86A08;           /* Brand Dark */
  --brand-tint: #FDE8D0;           /* Brand Tint */
  --brand-surface: #FFF8F0;        /* Brand Light Surface */

  /* AI MCP & Accent Gradients */
  --mcp-purple-start: #9333EA;     /* Purple 600 */
  --mcp-purple-end: #DB2777;       /* Pink 600 */
  --gradient-mcp: linear-gradient(135deg, #9333EA 0%, #C026D3 50%, #E11D48 100%);
  --gradient-badge: linear-gradient(135deg, #E8820C 0%, #F59E0B 100%);

  /* UI Backgrounds */
  --app-bg: #F0F2F5;               /* Clean slate app canvas */
  --surface-card: rgba(255, 255, 255, 0.85); /* Glass card */
  --surface-card-solid: #FFFFFF;
  --surface-subtle: #F8FAFC;
  --border-glass: rgba(226, 232, 240, 0.8);
  --border-focus: rgba(147, 51, 234, 0.4);

  /* Tier Colors */
  --tier-bronze: #CD7F32;
  --tier-silver: #94A3B8;
  --tier-gold: #F59E0B;
  --tier-platinum: #38BDF8;

  /* Status Colors */
  --status-success: #10B981;
  --status-warning: #F59E0B;
  --status-danger: #EF4444;
  --status-info: #3B82F6;
  --status-purple: #8B5CF6;
}
```

### 2.2 Typography & Locale
- **Font Stack**: `IBM Plex Sans Thai`, `Prompt`, `Manrope`, `system-ui`, sans-serif.
- **Thai Buddhist Era (พ.ศ.)**: Default date format displays Thai Buddhist Year (e.g., `11 ส.ค. 2569`, `2569-08-11`).
- **Bilingual Context**: Primary labels in Thai, technical subtitles and developer attributes in English.

---

## 3. Top-Level Shell & Navigation Structure

### 3.1 Global Top Bar
- **App Brand Logo**: `LineCRM-MCP` with gradient badge.
- **Tenant & Workspace Selector**: `Tenant: Demo Workspace [Pro]` with avatar dropdown.
- **LINE OA Context Switcher**: Active LINE OA channel selector (e.g. `LineCRM-MCP Official`).
- **Global Search Bar**: Quick search for members, tags, campaigns, or messages (`⌘K`).
- **AI MCP Active Switch**: Real-time master toggle for autonomous AI agent intervention.
- **Notifications & Admin Profile**: Badge counter for pending events, Admin Demo profile avatar.

### 3.2 Sidebar Navigation (12 Modules)
1. **แดชบอร์ด (Dashboard)** (`/customer/line-crm/dashboard`)
2. **แชทสด / Live Chat** (`/customer/line-crm/chat`) [Unread badge: 12]
3. **สมาชิก CRM (Members CRM)** (`/customer/line-crm/members`)
4. **แต้มสะสม (Loyalty)** (`/customer/line-crm/loyalty`)
5. **แคมเปญ (Campaigns)** (`/customer/line-crm/campaigns`)
6. **LINE OA (Multi-OA)** (`/customer/line-crm/line-oa`)
7. **Rich Menu** (`/customer/line-crm/rich-menu`)
8. **Automation** (`/customer/line-crm/automation`)
9. **AI MCP (Beta)** (`/customer/line-crm/ai-mcp`)
10. **Member Portal (LIFF)** (`/customer/line-crm/member-portal`)
11. **Audit Log** (`/customer/line-crm/audit-log`)
12. **ตั้งค่า (Settings)** (`/customer/line-crm/settings`)
- **Footer Widget**: Plan quota progress bar (`Pro Plan - API usage 62% - Valid to 31 Dec 2569`).

---

## 4. Detailed Module Specifications (12 Screens)

### Module 0: LineCRM-MCP Mockup Hub (Overview)
- **Target**: Visual launchpad grid displaying all 12 modules as interactive cards with icons, subtitles, and direct navigation links.
- **Header**: `LineCRM-MCP — Mockup` · `ชุด HTML mockup ครบ 12 เมนู · Prompt + Glassmorphism + Dark/Light + พ.ศ.`

### Module 1: แดชบอร์ด (Dashboard)
- **Banner**: Gradient banner summarizing CRM, LINE OA, Automation, and AI MCP real-time synchronization.
- **Stat Cards (Row 1)**:
  - สมาชิกทั้งหมด (Total Members): `2,458` (+12.4% vs last week)
  - ผู้ติดตามใหม่วันนี้ (New Followers): `128` (+18.7%)
  - ข้อความวันนี้ (Messages Today): `1,124` (+9.6%)
  - แต้มคงเหลือรวม (Remaining Points): `78,650` (+6.2%)
  - แคมเปญที่กำลังทำงาน (Active Campaigns): `7`
  - AI Tasks: `32` (Pending: 12)
- **Visual Analytics Grid**:
  - **ประสิทธิภาพแคมเปญ (Campaign Performance)**: Dual line chart (Sent vs Read vs Click) with time filter (7 days / 30 days).
  - **Webhook Activity (LINE OA)**: Daily bar chart breakdown (Total, Success, Failed, Pending).
  - **การสนทนาล่าสุด (Recent Conversations)**: Interactive list with customer avatars, tier tags, and timestamps.
  - **สรุปสมาชิกตามระดับ (Tier Breakdown)**: Donut chart displaying Bronze (50.6%), Silver (31.2%), Gold (13.3%), Platinum (4.9%).
  - **สมาชิกที่ใช้งานมากที่สุด (Top Active Members)**: Leaderboard ranked by messages and points.

### Module 2: แชทสด / Live Chat (3-Column Layout)
- **Column 1 (Chat Inbox)**:
  - Search box + Filter pills: `ทั้งหมด (32)`, `รอดำเนินการ (8)`, `ติดตามผล (5)`, `ปิดตัว (19)`.
  - Customer conversation cards showing avatar, name, tier badge, unread badge, last message preview, and time.
- **Column 2 (Active Conversation Stream)**:
  - Header: Customer profile link, LINE User ID, Online status indicator, action menu.
  - Message bubble stream supporting:
    - Text message (Inbound/Outbound with read ticks `✓✓`).
    - Flex Message cards (Interactive product/price quotation card).
    - File/PDF attachment card (`Pro_Plan_Overview.pdf`).
  - Composer bar with rich actions (Text, Image, Flex Message, Template, AI Emoji, Send button).
- **Column 3 (Member 360° & AI Assist)**:
  - **Member 360° Card**: Points balance (`1,245 แต้ม`), Total spend (`฿8,650`), Contact info (Phone, Email, LINE User ID), Tags (`VIP`, `สนใจสินค้า: CRM`, `ใช้งานประจำ`).
  - **Recent Activity Ledger**: Order records, points credited, reward redemptions.
  - **AI Assist Action Switchboard**:
    - `สรุปบทสนทนา` (Summarize conversation)
    - `แนะนำคำตอบ` (Suggest smart reply)
    - `เพิ่มแท็ก` (Auto-tag customer)
    - `สร้างงานติดตาม` (Create follow-up task)
    - `เพิ่มแต้ม` (Grant bonus points)
    - `ดูโปรไฟล์เต็ม` (Full 360 profile)
    - `AI MCP ช่วยตอบอัตโนมัติ` Master toggle.

### Module 3: สมาชิก CRM (Member 360 Directory)
- **Search & Filter Controls**: Text query, Tier filter (Bronze, Silver, Gold, Platinum), Tag filter, Date range.
- **Member Directory Table**:
  - Avatar + Name + LINE User ID
  - Tier Badge + Status
  - Total Points Balance & Lifetime Spend
  - Assigned Tags
  - Last Active Date
  - Action buttons (View 360 profile, Grant points, Direct Chat).
- **Interactive Slide-over Drawer**: Full customer audit trail, transaction history, and consent records (PDPA).

### Module 4: แต้มสะสม (Loyalty & Rewards)
- **Header Actions**: `ตั้งกฎการให้แต้ม` (Configure Earning Rules), `ปรับแต้มด้วยตนเอง` (Manual Adjustment).
- **Stat Cards**:
  - แต้มที่แจกทั้งหมด (`1,284,500`)
  - แต้มที่ถูกใช้แลก (`642,180` / 50.0% redemption rate)
  - แต้มคงเหลือรวม (`78,650` pts, Value: ฿78,650)
  - สมาชิกที่มีแต้ม (`2,102` / 85.5% of total)
- **Left Panel (ประวัติการเคลื่อนไหวแต้ม)**:
  - Real-time ledger of point transactions (Member, Type [ได้รับ/แลก], Description, Point delta [+250 / -450], Balance after, Timestamp).
- **Right Panel (กฎการให้แต้ม - Earning Rules)**:
  - Toggle switchboard for automatic earning rules:
    - ซื้อสินค้า (Every ฿25 = 1 point)
    - โบนัสวันเกิด (+500 points on birthday)
    - รีวิวสินค้า (+50 points per review)
    - แนะนำเพื่อน (+100 points per referral)
    - `+ เพิ่มกฎใหม่` (Add new earning rule).
- **Bottom Section (ของรางวัลแลกแต้ม - Reward Catalog)**:
  - Visual cards with reward icons, points required, and total redeemed count (e.g., ส่วนลด ฿100 [500 pts], เสื้อยืดพรีเมียม [1,200 pts], บัตรกาแฟ ฿150 [700 pts], ฟรีค่าจัดส่ง [300 pts]).

### Module 5: แคมเปญ (Broadcast & Marketing)
- **Header Action**: `+ สร้างแคมเปญใหม่` (Create Broadcast Campaign).
- **Stat Cards**:
  - แคมเปญทั้งหมด (`48`)
  - ส่งข้อความเดือนนี้ (`12,458` / Quota: 30,000)
  - อัตราเปิดอ่านเฉลี่ย (`62.9%` vs industry avg)
  - Conversion เฉลี่ย (`2.61%` / 325 conversions).
- **Filter Tabs**: ทั้งหมด (48), กำลังส่ง (7), ตั้งเวลา (5), ร่าง (12), เสร็จสิ้น (24).
- **Campaign Ledger Table**:
  - Campaign Name & Format (Flex Message, Carousel, Text + Image)
  - Status Badge (กำลังส่ง, ตั้งเวลา, เสร็จสิ้น, ร่าง)
  - Target Segment (e.g., สมาชิก VIP + Gold, แต้ม > 500, ทั้งหมด)
  - Delivered count, Open rate %, Click rate %
  - Scheduled send date (พ.ศ.)
  - Action dropdown.

### Module 6: LINE OA (Multi-OA Management)
- **Header Action**: `+ เชื่อมต่อ OA ใหม่` (Connect New OA).
- **Stat Cards**:
  - OA ที่เชื่อมต่อ (`3`)
  - ผู้ติดตามรวม (`18,942`)
  - Webhook สำเร็จ (`94.3%` / 3,512 / 3,726 today)
  - โควตา Push เดือนนี้ (`12,458` / 30,000).
- **Connected OA Cards**:
  - **Account Card 1: LineCRM-MCP Official**: Status: `ปกติ` (Active), Followers: `12,458`, Webhook: `Verified`, Channel ID masked, Access Token status, Last sync, Action buttons: `ตั้งค่า`, `ทดสอบ Webhook`.
  - **Account Card 2: Shop by LineCRM**: Status: `ปกติ`, Followers: `4,821`, Webhook: `Verified`.
  - **Account Card 3: Academy by LineCRM**: Status: `ต้องต่ออายุ` (Token Expiring in 3 days), Followers: `1,663`, Webhook: `3.8% Fail`, Action button: `ต่ออายุ Token`.

### Module 7: Rich Menu Designer
- **Visual Canvas**:
  - 2x3 Grid visual representation (`หน้าแรก`, `สินค้า`, `แต้มของฉัน`, `แลกรางวัล`, `ติดต่อเรา`, `โปรไฟล์`).
  - Layout template selector (`2x3`, `1x3`, `2x2`, `1x2`).
  - Action Configurator Panel: Configures selected tile (Type: `เปิด LIFF (Member Portal)`, `ส่งข้อความ`, `เปิด URL`, Destination: `/portal/points`).
  - Buttons: `บันทึกร่าง` (Save Draft), `เผยแพร่เมนู` (Publish to LINE).
- **Rich Menu Library (Right Sidebar)**:
  - Cards showing published and draft menus (`เมนูหลัก 6 ช่อง [ใช้งาน]`, `โปรโมชั่น 2 ช่อง [ร่าง]`, `สมาชิก VIP 3 ช่อง [ร่าง]`).

### Module 8: Automation Engine
- **Header Action**: `+ สร้าง Flow ใหม่` (Create Flow).
- **Stat Cards**:
  - Flow ทั้งหมด (`14`, Active: 9)
  - ทำงานวันนี้ (`1,284` times)
  - อัตราสำเร็จ (`98.6%`)
  - เวลาตอบเฉลี่ย (`1.2 วินาที`).
- **Visual Flow Pipeline Cards**:
  - **Flow 1: ต้อนรับสมาชิกใหม่**: `Follow OA` → `ส่งข้อความต้อนรับ` → `ติดแท็ก New` → `+50 แต้ม` [Active Toggle].
  - **Flow 2: ยืนยันคำสั่งซื้อ**: `สร้างออเดอร์` → `Flex ใบสั่งซื้อ` → `ให้แต้มตามยอด` [Active Toggle].
  - **Flow 3: ดึงลูกค้าที่หายไป (Win-back)**: `ไม่ซื้อ 60 วัน` → `ส่งคูปองส่วนลด` → `ติดแท็ก Win-back` [Active Toggle].
  - **Flow 4: แบบสอบถามหลังบริการ**: `ปิดเคส 1 ชม.` → `ส่งแบบสอบถาม` [Inactive Toggle].
- **Sidebar**: Prebuilt Templates library & Live Execution Feed.

### Module 9: AI MCP Control Plane (Beta)
- **Header**: Master status banner + `+ เชื่อม MCP Server` (Connect MCP Server).
- **Stat Cards**:
  - MCP Tools (`18`, Enabled: 15)
  - AI Tasks วันนี้ (`32`, Pending: 12)
  - ความแม่นยำตอบ (`92.4%`)
  - Token ใช้เดือนนี้ (`1.24M` / 5M).
- **Connected MCP Tools Switchboard**:
  - `crm.lookup_member` (ดึงข้อมูลสมาชิก 360°) [Toggle ON]
  - `loyalty.get_points` (เช็ค/ปรับแต้มสมาชิก) [Toggle ON]
  - `line.push_message` (ส่งข้อความผ่าน LINE OA) [Toggle ON]
  - `order.get_status` (ตรวจสถานะคำสั่งซื้อ) [Toggle ON]
  - `crm.add_tag` (ติดแท็กอัตโนมัติ) [Toggle ON]
  - `reward.redeem` (แลกของรางวัล) [Toggle OFF].
- **System Prompt Editor (AI Persona)**:
  - Editable system prompt box with real-time token count and save prompt action.
- **Task Queue Monitor (Right Column)**:
  - Real-time queue items with status badges (`สรุปบทสนทนา [กำลังทำ]`, `แนะนำสินค้าที่ใช่ [รอคิว]`, `วิเคราะห์ความรู้สึก [เสร็จ]`, `จัดหมวดหมู่ tickets [เสร็จ]`).

### Module 10: Member Portal (LIFF Mobile Emulator)
- **Header**: Member Portal configuration + `พรีวิว` (Preview) + `เผยแพร่` (Publish) + Copyable LIFF URL bar (`liff.line.me/1657xxxxxx`).
- **Left Column (Live Mobile Phone Frame Simulator)**:
  - Realistic smartphone bezel with status bar.
  - Member header (Avatar, Name, `สมาชิก Gold`).
  - Gradient Loyalty Card (`1,245 แต้ม`, Value: ฿1,245).
  - Quick action grid (`แลกรางวัล`, `ประวัติ`, `คูปอง`, `โปรไฟล์`).
  - Recommended rewards carousel (`ส่วนลด ฿100`, `บัตรกาแฟ ฿150`).
- **Right Column (Portal Controls)**:
  - Menu visibility toggles (`แลกของรางวัล`, `ประวัติแต้ม`, `คูปองของฉัน`, `สแกน QR รับแต้ม`).
  - Usage Metrics (`เข้าใช้วันนี้ 642`, `แลกรางวัลวันนี้ 38`, `คูปองใช้แล้ว 124`, `คะแนน UX 4.8★`).
  - Theme color picker (Purple gradient, Emerald, Amber, Sapphire).

### Module 11: Audit Log (PDPA & ISO 27001 Compliance)
- **Header Action**: `ส่งออก CSV` (Export CSV).
- **Stat Cards**:
  - เหตุการณ์วันนี้ (`1,842`)
  - การเข้าสู่ระบบ (`248`, Failed: 3)
  - แก้ไขข้อมูล (`526`)
  - เหตุการณ์เสี่ยง (`3` flagged for review).
- **Filter Bar**: Action type, User filter, Date selector (วันนี้), Status filter, Search input.
- **Audit Ledger Table**:
  - เวลา (Timestamp พ.ศ.)
  - ผู้ใช้ (User Name + Role Badge)
  - Action Badge (`UPDATE`, `CREATE`, `EXPORT`, `LOGIN`, `DELETE`)
  - รายละเอียด / Object (e.g., `ปรับแต้มสมาชิก CUST-0001 +250`, `ส่งออกข้อมูลสมาชิก 2,458 รายการ`, `พยายามเข้าสู่ระบบ user admin`)
  - IP Address (Masked)
  - สถานะ (`สำเร็จ` / `ล้มเหลว`).

### Module 12: ตั้งค่า (Settings & Security)
- **Navigation Tabs**:
  - `ทั่วไป` (General Settings)
  - `ผู้ใช้ & สิทธิ์ (RBAC)` (Team & Roles)
  - `การแจ้งเตือน` (Notification Webhooks)
  - `ความปลอดภัย` (Security & PDPA Erasure).
- **General Settings Form**:
  - ชื่อ Workspace & Workspace ID (`@demo_workspace`)
  - เขตเวลา (`Asia/Bangkok (GMT+7)`)
  - รูปแบบวันที่ (`พุทธศักราช (พ.ศ.) · 11 ส.ค. 2569`)
  - สกุลเงิน (`บาท (฿ THB)`) & ภาษาเริ่มต้น (`ไทย`)
  - Dark/Light Theme Master Switch (`ให้ผู้ใช้สลับรื่นได้เอง`)
  - Action buttons: `ยกเลิก`, `บันทึกการเปลี่ยนแปลง`.

---

## 5. Technical Implementation & Integration Architecture

### 5.1 Route Mapping
- Primary Entry: `src/app/(pm)/customer/line-crm/page.jsx` (Interactive Hub and multi-tab controller).
- Submodules: Supports deep-link queries e.g. `?tab=dashboard`, `?tab=chat`, `?tab=loyalty`, `?tab=line-oa`, `?tab=rich-menu`, `?tab=automation`, `?tab=ai-mcp`, `?tab=member-portal`, `?tab=audit-log`, `?tab=settings`, etc.

### 5.2 State Management & Reactive Interactions
- Unified in-memory reactive state controller allowing immediate interactivity (switching rules, toggling MCP tools, sending chat messages, filtering audits, changing LIFF theme).
- Seeded with comprehensive demo data representing real-world business scenarios.

---

## 6. Verification & Acceptance Criteria
1. **Visual Fidelity**: All 12 modules accurately reflect the layout, color accents, typography, and card hierarchy in `screenshot/`.
2. **Interactive Live Demonstrations**:
   - Working tab navigation across all 12 modules.
   - Working 3-column Live Chat with AI Assist prompt reactions.
   - Interactive Rich Menu grid selector.
   - Real-time responsive Member Portal LIFF phone simulator.
   - Toggle switchboard for Automation flows and MCP tools.
3. **Build & Quality Gates**: Code builds with zero TypeScript/JSX errors, clean tests, and valid documentation metadata.
