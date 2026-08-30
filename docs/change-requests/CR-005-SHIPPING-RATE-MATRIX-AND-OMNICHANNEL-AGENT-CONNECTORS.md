---
doc_type: change-request
id: CR-005
status: proposed
version: "1.0.0"
created_at: "2026-08-30T07:45:00+07:00"
updated_at: "2026-08-30T07:45:00+07:00"
owner: "SmartGift Data Architecture Team"
impacted_domains:
  - pricing
  - shipping-logistics
  - agent
  - connectors
  - line-oa
  - ui
proposed_domains:
  - logistics-engine
  - omnichannel-connectors
---

# CR-005 — Shipping Rate Matrix Settings & Omnichannel Agent Connectors (LINE OA / Plugins)

## 1. Change Summary

Introduce configurable **Shipping Rate Matrix Settings** in `zuri-ai` UI supporting 4 Logistics Member Tiers (**`ELITE`**, **`GOLD`**, **`SILVER`**, **`MEMBER`**) and establish an **Omnichannel Multi-Agent Connector Architecture (LINE OA Webhook + Tool Plugins)** enabling AI Agents to generate real-time Landed Cost & Ladder Quotations directly into client chats.

---

## 2. Logistics Matrix & Member Tiers Specification

Based on official logistics rate sheets from Guangzhou/Shenzhen and Yiwu (`LK-กวางโจว.jpg` & `LK-อี้อู.jpg`):

| Member Tier | CBM Threshold | Weight Threshold | Guangzhou Sea (General) | Guangzhou Truck (General) | Yiwu Truck (General) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`ELITE`** | $\ge 10$ CBM | $\ge 3$ ตัน (3,000 kg) | 3,900 THB/CBM (10 THB/kg) | 5,900 THB/CBM (15 THB/kg) | 6,400 THB/CBM (16 THB/kg) |
| **`GOLD`** | $\ge 5$ CBM | $\ge 1.5$ ตัน (1,500 kg) | 4,400 THB/CBM (11 THB/kg) | 6,400 THB/CBM (16 THB/kg) | 6,900 THB/CBM (18 THB/kg) |
| **`SILVER`** | $\ge 1$ CBM | $\ge 300$ kg | 4,900 THB/CBM (13 THB/kg) | 6,900 THB/CBM (18 THB/kg) | 7,400 THB/CBM (19 THB/kg) |
| **`MEMBER`** | $\ge 0.01$ CBM | $\ge 1$ kg | 5,400 THB/CBM (14 THB/kg) | 7,400 THB/CBM (19 THB/kg) | 7,900 THB/CBM (20 THB/kg) |

* **Density Switch Rule:** If Density $\ge 400$ kg/CBM, charge by Weight (`THB/kg`); otherwise charge by Volume (`THB/CBM`).

---

## 3. Target Repositories & Action Items

### A. `D:\zuri-ai` (Prisma Model Extension: `prisma/schema.prisma`)
```prisma
model ShippingRateMatrix {
  id               String    @id @default(uuid())
  workspaceId      String
  warehouse        String    // "guangzhou" | "yiwu"
  shippingMethod   String    // "sea" | "truck"
  categoryType     String    // "general" | "electronic_tis" | "cosmetic_fda" | "others"
  tier             String    // "ELITE" | "GOLD" | "SILVER" | "MEMBER"
  cbmRateThb       Float
  kgRateThb        Float
  densityThreshold Float     @default(400.0)
  updatedAt        DateTime  @updatedAt
}

model AgentConnectorConfig {
  id               String    @id @default(uuid())
  businessId       String
  connectorType    String    // "LINE_OA" | "WEBHOOK" | "MCP_PLUGIN"
  channelSecret    String?
  channelToken     String?
  webhookUrl       String
  status           String    // "ACTIVE" | "INACTIVE"
  createdAt        DateTime  @default(now())
}
```

---

### B. `D:\zuri-ai` (UI Settings & Connector Architecture)

1. **Shipping Matrix Settings Page (`/platform/workspaces/[id]/settings/shipping`):**
   * Editable interactive grid allowing administrators to update CBM/KG rates across warehouses, categories, and tiers.
   * Toggle for Auto-Density threshold ($400$ kg/CBM) and Seasonal peak multiplier.

2. **LINE OA Multi-Agent Webhook Connector (`/api/connectors/line-oa/[businessId]`):**
   * Integrates LINE Messaging API webhook with `SmartGiftAutoQuoteService`.
   * Automatically recognizes customer intents ("ขอใบเสนอราคา", "คำนวณราคา TDD03-2 จำนวน 100 ชิ้น") and generates interactive **LINE Flex Messages** with ladder quotes.

3. **Agent MCP Tool Plugin (`smartgift_calculate_ladder_quote`):**
   * Exposes standard MCP Tool allowing conversational agents in Zuri-AI to dynamically invoke the pricing engine during buyer discussions.

---

## 4. Non-Negotiable Invariants

1. **Deterministic Margin Floors:** Floor profit $\ge 5,000$ THB (small orders) or $\ge 3,000$ THB must always be enforced before returning quotations to external channels.
2. **Rounding Invariant:** Quotations presented to customers must always be rounded up to the nearest 10 THB (`math.ceil(price / 10) * 10`).
