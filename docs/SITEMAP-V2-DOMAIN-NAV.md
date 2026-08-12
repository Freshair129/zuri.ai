# SITEMAP — V2 Domain Navigation (V1-style, Business-bound)

| Field | Value |
|-------|-------|
| **Version** | 0.1.0 (design draft — sitemap before build) |
| **Status** | Proposed |
| **Author** | Claude |
| **Date** | 2026-08-12 |
| **Relates to** | ADR-003 (V2 replaces V1 by reuse), ADR-006 (shell lift · URLs don't carry scope), FR-020 (adaptive shell), PARITY-INVENTORY.md, ROUTES-SITEMAP.md |

Adopts V1's information architecture — **top-level = domain, sidebar = the domain's
sub-features, the first sub-feature is always a Dashboard** — and binds it to V2's new
**Business** layer, adding a **second bar under the current topbar** for the domains.

## 1. The three navigation tiers

```
Tier 1  Scope      Portfolio → Tenant → Business → Workspace   (the topbar switcher)
Tier 2  Domain     Commerce · Customer · Growth · Operations · Projects · Platform
                   (a NEW bar under the topbar; the set is BOUND to the Business)
Tier 3  Sub-domain the active domain's sidebar; item #1 is ALWAYS "Dashboard"
```

- **Business binds the domain bar.** A Business exposes only the domains it has enabled
  (module registry per business). The culinary school (TVS) shows *Operations → Courses*;
  a pure-retail business hides it. This is FR-020's adaptive shell taken one level deeper:
  single business ⇒ no business switcher; the domain bar still shows.
- **First sub-domain = Dashboard, always.** Opening a domain lands on its dashboard
  (`/{domain}` → `/{domain}/dashboard`), mirroring V1's `LayoutDashboard` first entry.
- **URLs never carry scope (ADR-006).** Business/tenant come from the switcher (ambient
  context), not the path — so `/commerce/inventory`, never `/business/{id}/commerce/...`.
  Switching Business keeps you on the same domain+sub-domain where it exists.

## 2. Layout — two bars

```
┌──────────────────────────────────────────────────────────────┐
│ Zuri   [ธุรกิจ: The V School ▾] [Workspace ▾]      ⌘K   ◐  👤  │  Topbar (Tier 1: scope + global)
├──────────────────────────────────────────────────────────────┤
│  Commerce   Customer   Growth   Operations   Projects · Platform │  Domain bar (Tier 2, per-business)
├───────────────┬──────────────────────────────────────────────┤
│ ● Dashboard   │                                                │
│   หน้าร้าน POS │                                                │
│   คลังสินค้า    │              content                          │  Sidebar (Tier 3: sub-domains,
│   สินค้า       │                                                │  Dashboard pinned first)
│   ใบเสร็จ      │                                                │
│   จัดส่ง       │                                                │
│   จัดซื้อ       │                                                │
└───────────────┴──────────────────────────────────────────────┘
```

```mermaid
flowchart TD
  B[Business: The V School] --> D1[Commerce]
  B --> D2[Customer]
  B --> D3[Growth]
  B --> D4[Operations]
  B --> D5[Projects]
  B --> D6[Platform]
  D1 --> C0["Dashboard (always #1)"]
  D1 --> C1[POS] --> C2[Inventory] --> C3[Products] --> C4[Invoices] --> C5[Delivery] --> C6[Procurement]
```

## 3. Domain → sub-domain map (V2)

Legend: **lift** = reuse V1 UI per ADR-003 · **rebuild** = V1 defect, rebuild in V2 ·
**new** = V2-only (V1 never had workspace/business/project/product/B2B).

### Commerce — การค้า/ขาย  *(V1: commerce)*
1. **Dashboard** — ยอดขายวันนี้ · ออเดอร์ค้าง · สต็อกต่ำ *(new dashboard over lifted data)*
2. หน้าร้าน / POS — cashier *(lift)*
3. สินค้า / Products — catalog *(new)*
4. คลังสินค้า / Inventory — stock · lots · movements *(lift)*
5. วัตถุดิบ / Ingredients *(lift)*
6. ใบเสร็จ·ใบแจ้งหนี้ / Invoices *(lift)*
7. จัดส่ง / Delivery — zones · drivers *(lift, later)*
8. จัดซื้อ·รับของ / Procurement — GRN *(lift)*
9. B2B / ขายส่ง — quotes → orders *(new; B2B_SALES execution mode feeds here)*

### Customer — ลูกค้า  *(V1: customer — deepest PII surface)*
1. **Dashboard** — ลูกค้าใหม่ · active · สถานะ PDPA
2. CRM 360 *(lift)*
3. Leads *(lift)*
4. Segments *(lift)*
5. Inbox — LINE · Facebook *(rebuild — per-tenant routing; runs through the P3 identity gate)*
6. Consent · PDPA — the only consent writer *(lift; erase-revoke wired to FR-022)*
7. Notifications *(lift)*

### Growth — การตลาด  *(V1: growth — existing AI surface)*
1. **Dashboard** — spend · ROAS · KPI attainment
2. Campaigns *(lift)*
3. Ads Audit *(lift)*
4. Daily Brief *(lift; fix V1 date-only key → per-business)*
5. Automations *(lift)*
6. Broadcasts *(lift; consent-checked)*
7. AI Copilot — chat over business data *(new; the ADR-007 agent stack: Gate E read now, Gate F actions later)*

### Operations — ปฏิบัติการ  *(V1: operations — culinary-school core)*
1. **Dashboard** — คิวครัว · คลาสวันนี้ · พนักงานเข้ากะ
2. ครัว / Kitchen *(lift)*
3. จอครัว / Runner — tablet display *(lift)*
4. คอร์ส / Courses — list · enrollments *(lift; core, must-have)*
5. เช็คชื่อ / Attendance — QR class check-in *(lift)*
6. ใบรับรอง / Certificates — BASIC_30H · PRO_111H · MASTER_201H *(lift)*
7. ทีมงาน / Team — employees · roles · schedule *(lift)*

### Projects — โปรเจกต์/แผนงาน  *(new — the module V2 already shipped, FR-001…020)*
1. **Dashboard** — weighted roll-up · gates ค้าง · หมุดหมายถัดไป *(= today's `/overview`)*
2. Workspaces
3. Projects
4. All Work
5. Execution — 7 modes (sprint · migration · b2b-sales · b2c-campaign · product-launch · operations · expansion)
6. Timeline
7. Dependencies
8. Milestones & Gates
9. Repositories

### Platform — ระบบ/ตั้งค่า  *(V1: platform + gaps)*
1. **Dashboard** — สุขภาพระบบ · integrations status
2. Integrations — accounting · FlowAccount *(lift)*
3. ธุรกิจ·องค์กร / Business & Tenant config *(rebuild — V1 PATCH is 403 for all roles)*
4. ผู้ใช้·สิทธิ์ / Users & Roles — Membership *(rebuild — V1 auth is per-tenant Employee)*
5. Identity / LINE linking *(new — the P3 gate: account linking, staff/customer split)*
6. Audit log *(lift/new — append-only)*
7. Backup — snapshot export/import *(new — already shipped)*
8. API keys *(lift)*
9. Settings *(lift)*

## 4. Business-binding rules (which domains appear)

| Business kind | Commerce | Customer | Growth | Operations | Projects | Platform |
|---|---|---|---|---|---|---|
| Culinary school (TVS) | ✓ | ✓ | ✓ | ✓ (Courses) | ✓ | ✓ |
| Retail / F&B (no courses) | ✓ | ✓ | ✓ | ✓ (no Courses) | ✓ | ✓ |
| Services / B2B only | ✓ (B2B) | ✓ | ✓ | – | ✓ | ✓ |
| Internal / holding | – | – | – | – | ✓ | ✓ |

- The enabled set is a per-Business module registry (Platform → Business config edits it).
- A domain with zero enabled sub-domains is hidden from the bar entirely.
- **Portfolio landing** (no business selected) shows only the group **Overview** + Projects
  roll-up across businesses — today's `/overview`. Picking a business reveals the domain bar.

## 5. URL scheme (scope-free, ADR-006)

```
/                         → group overview (portfolio landing)
/{domain}                 → 302 /{domain}/dashboard        (first sub is always the dashboard)
/{domain}/{subdomain}     → e.g. /commerce/inventory, /operations/courses, /customer/crm
/projects/...             → the existing project routes stay verbatim (Projects domain sidebar)
```

Business + workspace are ambient (switcher → cookie/context), never in the path. Deep-linking
a sub-domain resolves it inside the currently-selected business; if that business lacks the
domain, land on its group overview with a notice.

## 6. Mapping onto today's app (what changes)

- Today's single left "Modules" rail (Overview · Workspaces · Projects · …) **becomes the
  Projects domain's sidebar** — no route changes; it just moves under the Projects tab.
- A **new domain bar** is added under the existing topbar; the business switcher already
  present (`สลับธุรกิจ`) becomes the Tier-1 binder for it.
- Commerce / Customer / Growth / Operations / Platform domains are **lifted per module at
  that module's cutover** (ADR-003) — the sitemap reserves their slots now; each lands when
  its parity items (PARITY-INVENTORY) are met. Until a domain is lifted, its tab is hidden
  (business-binding), so the shell degrades cleanly to just Projects + Platform today.

## 7. Open decisions for the owner

1. **Domain order & labels** — proposed: Commerce · Customer · Growth · Operations · Projects
   · Platform. Thai labels above are drafts.
2. **Is Projects a peer domain or folded into Platform?** Proposed: a peer domain (it is the
   cross-cutting delivery view).
3. **B2B & Products** — placed under Commerce; could be their own domain if they grow.
4. **Per-business module registry storage** — a `BusinessModule` table vs a JSON field on
   Business. (Recommend a small table so Platform can toggle without a migration.)
5. **AI Copilot placement** — under Growth (marketing lens) vs a global top-level launcher.
