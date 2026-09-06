---
id: ZAI:SPEC-UI-LINE-STUDIO-ENTERPRISE
relations:
  - type: relates_to
    target: ZAI:DOMAIN-LINE-OA-STUDIO
  - type: relates_to
    target: ZAI:ADR-060
  - type: relates_to
    target: ZAI:ADR-061
domain_id: DOM-LINE-OA-STUDIO
domain: line-oa-studio
status: active
version: "1.0.0"
created_at: "2026-09-06T22:45:00+07:00"
updated_at: "2026-09-06T22:45:00+07:00"
---

# UI Specification: LINE Studio Enterprise Suite

## 1. Executive Summary & Design Mission

**LINE Studio Enterprise** is the centralized, enterprise-grade command center and visual design studio for building, deploying, and operating multi-account LINE Official Accounts (LINE OA) across an organization. Inspired by the architectural blueprints in `screenshot/01`, it unifies conversational automation, visual UI design (Flex Messages, Rich Menus, LIFF Apps), team access governance, and enterprise ERP integration (FlowAccount catalog code mapping) into a cohesive, glassmorphic Zuri-themed workspace.

---

## 2. Information Architecture & Navigation

The application is structured into high-level global navigation and project-level sub-studios:

```text
LINE Studio Enterprise
├── 📊 Dashboard (Global Analytics & KPIs)
├── 📁 โปรเจค / Projects (Multi-Account Portfolio Grid & Statuses)
├── 🎨 Design Studio (Active Project Workspace)
│   ├── ⚡ Flow Designer (Visual Node-Based Conversation Flow Graph)
│   ├── 🎴 Flex Message (Visual & JSON Builder + Live Mobile Simulator)
│   ├── 📱 Rich Menu (Multi-Zone Layout Grid & Action Dispatcher)
│   └── 🌐 LIFF App (Lightweight In-App Web App Registry & Scopes)
├── 📦 Templates (Industry Template Library & 1-Click Clone)
├── 📈 Analytics (Deep Dive Insights & Message Funnel)
├── 👥 ทีม / Team (Role-Based Access Control & Member Invitations)
├── 🖼️ Media (Asset Library & File Storage)
├── 🧾 FlowAccount Mapping (Product SKU & Accounting Integration)
└── ⚙️ Settings (Account Keys, Webhooks & Transport Configuration)
```

---

## 3. Screen Specifications (from `screenshot/01`)

### 3.1 Global Dashboard & Analytics (`782184716...`)
- **Top Metrics Strip**:
  - **โปรเจคทั้งหมด (Total Projects)**: 14 Active Projects
  - **ผู้ใช้งานทั้งหมด (Total Users)**: Total followers and active subscribers
  - **ข้อความที่ส่ง (Messages Sent)**: Monthly outbound dispatches and replies
  - **บรอดแคสต์ (Broadcasts)**: High-volume campaign dispatches
- **Projects Overview Chart**: Time-series visualization of engagement, active chats, and delivery rates.
- **Top 10 Popular Projects Table**:
  - Columns: `ชื่อโปรเจค` (Project Name & Code), `ผู้ติดตาม` (Followers), `Flows` (Active Flows count), `ข้อความ` (Message Volume), `อัปเดตล่าสุด` (Last Modified Date in Thai Buddhist Era `พ.ศ.`).
  - Search and filter bar for rapid account discovery.

### 3.2 Project Portfolio Grid (`784215115...`)
- **Card-Based Account Matrix**:
  - Displays enterprise LINE OA bots including:
    - *LINE OA Muay Thai Class Credit* (`p023-muaythai-credits`)
    - *Whocalled* (`p022-whocalled`)
    - *Disaster Relief* (`p021-disaster-relief`)
    - *LINE OA Rental Property Bot* (`p016-rental-property`)
    - *LINE OA Coffee Shop Loyalty* (`p015-coffee-loyalty`)
    - *LINE OA Condo Juristic Bot* (`p014-condo-juristic-bot`)
    - *LINE OA Beauty Salon Booking* (`p013-beauty-salon`)
    - *LINE OA Dental Clinic Appointment* (`p012-dental-clinic`)
    - *LINE OA Messager* (`p011-line-messager`)
    - *LINE OA Food Delivery* (`p010-food-delivery`)
    - *LINE OA Cafe Queue* (`p009-cafe-queue`)
    - *LINE OA Job Board* (`p008-job-board`)
    - *Restaurant Bot*, *Billing Bot*, *Finance Bot*.
- **Card Details**:
  - Status Tag: `ร่าง` (Draft), `เผยแพร่แล้ว` (Published), `ออนไลน์` (Live).
  - Metrics Counters: Followers, Flows, Messages.
  - Action: Click to enter Design Studio for that specific project.
  - Primary CTA: `+ สร้างใหม่` (Create New Project Modal).

### 3.3 Visual Flow Designer (`783507792...`, `image-1786583400809.png`)
- **Breadcrumb**: `← [Project Name] / Design Studio`
- **Node Types Palette (Left Rail)**:
  - ▶️ **เริ่มต้น (Start / Trigger)**: Follow Event, Message Keyword, Postback, Beacon, QR Scan.
  - 💬 **ข้อความ (Text Message)**: Auto-reply string with variable interpolation.
  - ⚡ **Quick Reply**: Action buttons anchored to message bottom.
  - 🎴 **Flex Message**: Rich interactive bubble/carousel templates.
  - 🔀 **เงื่อนไข (Condition)**: If/Else branching based on tags, variables, or user attributes.
  - 🌐 **LIFF**: Open registered mini-app modal inside LINE.
  - 📢 **Push**: Direct proactive message dispatch.
  - 🔌 **API Call**: Webhook execution or internal CRM connector.
  - 📝 **Variable**: Store session state (e.g. `user_intent`, `cart_total`).
  - ⏳ **Wait**: Timed delay (Minutes / Hours / Days).
  - ⏹️ **จบ (End Flow)**: Terminate session or handoff to Live Agent.
- **Interactive Visual Canvas**:
  - Infinite draggable canvas with dot-grid pattern.
  - Bezier curve connection wires linking output ports to input ports.
  - Controls: Zoom in (`+`), Zoom out (`-`), Reset zoom (`1:1`), Fit canvas.
  - Top Action: `💾 บันทึก Flow` (Save & Validate Graph).

### 3.4 Flex Message Studio & Live Mobile Simulator (`783028336...`, `783255544...`, `783685954...`)
- **Template Drawer (Left Rail)**:
  - *Hero Card* (Banner image, heading, body text, primary CTA button).
  - *Product Card* (Product image, title, price tag `฿ 599`, description, Dual buttons: "สอบถาม" & "สั่งซื้อ").
  - *Order Status* (Tracking code, delivery timeline, item summary, support button).
  - *Receipt & Invoice* (Itemized checkout details with FlowAccount barcode).
- **Dual-Mode Editor**:
  - **🎨 Visual Mode**: Interactive form controls to change images, titles, subtitle, button colors, and action URLs.
  - **`{ }` JSON Mode**: Monospace raw Flex Message JSON editor with real-time validation.
- **Central Canvas**:
  - Flex Message Preview container with type selector (`bubble` / `carousel`).
- **Right Rail: Live LINE Chat Mobile Frame**:
  - Ultra-realistic smartphone preview rendered in LINE brand style (`#06C755`).
  - Live conversational bubble displaying the real-time compiled Flex Message as users will see it in the LINE mobile app.
- **Top Actions**:
  - `💾 บันทึก` (Save Template).
  - `🚀 ส่งทดสอบ` (Send Test Message to Developer LINE UID).

### 3.5 Rich Menu Visual Builder (`782905876...`)
- **Layout Templates**:
  - `1x1` (Single full-width card)
  - `2x1` (Top & Bottom split)
  - `2x2` (4 Quad tiles)
  - `2x3` (6 Classic tiles)
  - `3x1` (3 Columns)
  - `1x2` (Left & Right halves)
- **Interactive Zone Configurator**:
  - Visual coordinate mapper for zones A, B, C, D, E, F.
  - Action types: `URI Link`, `Message Text`, `Postback Data`, `Switch Rich Menu` (Nested sub-menu navigation).
- **Chat Bar Configuration**:
  - Menu Bar Title (e.g. `เมนูหลัก`, `บริการของเรา`).
  - Default Open state (`เปิดเมนูอัตโนมัติ` / `ปิดเมนู`).
- **Top Actions**: `💾 บันทึกแบบร่าง` & `🚀 Deploy to LINE OA`.

### 3.6 LIFF Application Hub
- **LIFF Registry Table**:
  - LIFF ID (`165789...`), Name, App Type (`Full`, `Tall`, `Compact`), Endpoint URL, BLE/QR Scanner enabled flags.
  - Permissions Scopes: `profile`, `openid`, `chat_message.write`.
  - Integrated QR Code generator for on-device mobile testing.

### 3.7 Template Library (`783374860...`)
- **Categories & Filter Badges**:
  - `All Types`, `⚡ Flow`, `🎴 Flex`, `📱 Rich Menu`, `🌐 LIFF`.
  - Industry Badges: `Welcome (1)`, `E-Commerce (1)`, `Restaurant (1)`, `Healthcare (1)`, `Emergency (1)`.
- **Card Details**:
  - Visual icon thumbnail, category pill, `Official` verification badge.
  - Title, subtitle, usage statistics (`ใช้ 0 ครั้ง`), and `ใช้งาน ->` (Instant instantiate).

### 3.8 Team & RBAC Management (`783126196...`)
- **Team Roster**:
  - Avatar, Name, Email, Role badge (`OWNER`, `ADMIN`, `DEVELOPER`, `EDITOR`, `VIEWER`), Joined date (Buddhist Era `พ.ศ.`), Last login.
- **Invite Modal**:
  - Email input, Role selection dropdown, `ส่งคำเชิญ` (Send Invite).

### 3.9 FlowAccount ERP Code Mapping (`flowaccountcodemapping.csv`)
- **Enterprise Accounting Bridge**:
  - Maps 1,337+ product catalog items, SKU codes, pricing tiers (100, 50, etc.), supplier codes (`P-xx`), and categorization (`แฟลชไดร์ฟ`, `Gift Set`, `วัสดุแพ็กเกจ`, `บริการ`) into LINE OA shopping, invoicing, and quotation automated flows.
  - Status indicators: `ตรงแคตตาล็อก`, `สินค้า ไม่มีรหัส — ต้องออกรหัส`, `บริการ/ค่าใช้จ่าย`, `เลิกใช้งาน`.

---

## 4. Design System Tokens & Heritage Consistency

- **Primary Brand Amber**: `#E8820C`
- **Brand Hover**: `#F09420`
- **Brand Tint / Glow**: `#FDE8D0` / `rgba(232, 130, 12, 0.15)`
- **LINE Official Green**: `#06C755`
- **Surface**: Glassmorphism with `rgba(255, 255, 255, 0.85)` and backdrop blur `12px`
- **Typography**: `IBM Plex Sans Thai`, `Manrope`, sans-serif
- **Dates**: Thai Buddhist Era (`23 ส.ค. 2569`)
- **Icons**: `lucide-react`
