---
id: ZAI:ERP-ORGANIZATIONAL-HIERARCHY
title: Canonical ERP organizational hierarchy and data architecture
version: "1.0.0"
status: approved
created_at: "2026-09-12T12:45:00+07:00,Antigravity"
last_update: "2026-09-12T12:45:00+07:00,Antigravity"
author: Antigravity
attributes:
  doc_type: architecture-spec
  domain: platform
relations:
  - type: relates_to
    target: ZAI:ADR-076
  - type: relates_to
    target: ZAI:ADR-011
  - type: relates_to
    target: ZAI:ADR-008
---

# Canonical ERP Organizational Hierarchy & Data Architecture

## 1. Executive Summary

In enterprise business operations (ERP), modeling corporate structure accurately is critical to data security, consolidated reporting, cross-branch fulfillment, and unified customer relationship management (CRM).

This document establishes the canonical **5-level organizational hierarchy** of Zuri-AI, resolves previous UI naming ambiguities (where Portfolio was called "Workspace" and Workspace was called "Space"), and explains why **`tenant_id` is an isolation boundary, not a branch**.

---

## 2. The 5-Tier Canonical Hierarchy

```text
Level 1: Portfolio / Group (pfl_id)
  ↓
Level 2: Tenant / Security Boundary (tenant_id)
  ↓
Level 3: Business / Operating Company (bus_id)
  ↓
Level 4: Workspace / Operational Unit (workspace_id)
  ↓
Level 5: Branch / Physical Location (branch_id)
```

### Level 1: Portfolio / Group (`pfl_id`)
- **ERP Concept**: Corporate Holding / Conglomerate / Group of Companies (เครือธุรกิจ / กลุ่มบริษัท)
- **Role**: Top-level executive and investment umbrella.
- **Functions**:
  - Consolidated financial roll-up and multi-business governance.
  - Strategic portfolio oversight across unrelated or allied industries (e.g. Retail, Engineering, Real Estate).
- **UI Label**: **Group** (e.g. `Wannapa Group`).

### Level 2: Tenant / Security Boundary (`tenant_id`)
- **ERP Concept**: Client / Data Boundary / Security Boundary (ขอบเขตความปลอดภัยและการแบ่งแยกข้อมูล)
- **Role**: Cryptographic and logical security wall (AGENTS.md Rule 3, BR-001).
- **Functions**:
  - Absolute data isolation (Row-Level Security boundary). Users from Tenant A can never view or access Tenant B.
  - Hosts shared master data across affiliated operating businesses:
    - **Single Customer Master (Unified CRM)**: Customer identity, unified phone/email lookup, loyalty points.
    - **Shared Product Master / Catalog**: Base catalog definitions that businesses subscribe to.
    - **Identity & Access Management (IAM)**: Unified user credentials and multi-tenant federation.
- **UI Label**: **Organization** (e.g. `Wannapa Org`).

### Level 3: Business / Operating Company (`bus_id` / `business_id`)
- **ERP Concept**: Operating Company / Company Code / Subsidiary (บริษัทหรือหน่วยธุรกิจที่ดำเนินงานจริง)
- **Role**: Commercial, legal, and operational trading entity.
- **Functions**:
  - Independent tax invoicing, general ledger (GL), balance sheet, and P&L.
  - Dedicated operational scopes (e.g. SmartGift = e-commerce & retail; EMC = engineering & maintenance).
  - Business-scoped inbox and workflow routing (preventing cross-business inbox leakage).
- **UI Label**: **Business** (e.g. `SmartGift`, `EMC`).

### Level 4: Workspace / Operational Unit (`workspace_id`)
- **ERP Concept**: Operational Container / Project Division / Department (พื้นที่ทำงานปฏิบัติการ)
- **Role**: Execution container for projects, initiatives, tasks, and team collaborations.
- **Functions**:
  - Houses projects, workstreams, milestones, task boards, and sprints.
  - Allows a single business to segregate operations (e.g. `SmartGift Marketing Workspace`, `SmartGift Operations Workspace`).
- **UI Label**: **Workspace** (e.g. `SmartGift Workspace`, `EMC Workspace`).

### Level 5: Branch / Location (`branch_id`)
- **ERP Concept**: Branch / Plant / Store / Warehouse / Fulfillment Center (สาขา / คลังสินค้า / หน้าร้าน)
- **Role**: Physical or localized sales and logistics node.
- **Functions**:
  - Point of Sale (POS) terminals, branch inventory stock, local fulfillment.
  - Local tax branch code (e.g. `00000` for Head Office, `00001` for Siam Paragon Branch).
  - Employees assigned to physical shifts and cash drawers.
- **UI Label**: **Branch** (e.g. `Head Office (สำนักงานใหญ่)`, `Mega Bangna Branch`).

---

## 3. Deep Dive: Why `tenant_id` is NOT a Branch

A common antipattern in multi-tenant SaaS is mistaking a physical branch for a tenant. In Zuri-AI, **`tenant_id` must never represent a branch** (AGENTS.md Rule 3):

```text
tenant_id   = security/data isolation boundary
business_id = operating business
branch_id   = branch/location
```

### Architectural Pitfalls of Using `tenant_id` as a Branch:

| Aspect | Incorrect: Branch as Tenant | Correct: Branch as Location under Business |
|---|---|---|
| **Customer CRM & Loyalty** | Customer visiting Branch B cannot be found; points accumulated at Branch A cannot be redeemed at Branch B. | Single Customer Master across all branches in the Tenant; points and history shared seamlessly. |
| **Cross-Branch Inventory & Transfer** | Moving stock from Branch A to Branch B requires complex inter-tenant API migrations and cross-boundary exports. | Standard inventory transfer order (`TransferOrder`) within the same Tenant and Business database. |
| **Financial Consolidation** | Inability to run a single General Ledger or VAT report for the Business without stitching multiple disconnected tenant DBs. | Normal GL aggregation grouped by `business_id` and filtered or segmented by `branch_id`. |
| **Security & RBAC** | Branch managers require multi-tenant credentials or cross-tenant tokens, creating severe authorization holes. | Standard Role-Based Access Control: User assigned to Tenant with scope `branchId: "branch-001"`. |

---

## 4. Industry Standard Comparison

Zuri-AI's 5-level hierarchy directly matches global tier-1 ERP systems:

| Zuri-AI Hierarchy | SAP S/4HANA Equivalent | Oracle NetSuite Equivalent | Microsoft Dynamics 365 F&O |
|---|---|---|---|
| **Portfolio / Group** | Corporate Group (Konzern) | Holding Company | Enterprise Group |
| **Tenant** | Client (Mandant) | Customer Account Boundary | Tenant (Entra ID / Dataverse) |
| **Business** | Company Code (Buchungskreis) | Subsidiary | Legal Entity / Company Code |
| **Workspace** | Profit Center / Project Area | Division / Department / Project | Operating Unit / Department |
| **Branch** | Plant / Storage Location (Werk) | Location / Store / Warehouse | Warehouse / Retail Store |

---

## 5. UI Vocabulary Alignment (ADR-076)

In earlier versions (ADR-011), the UI topbar displayed:
```text
Workspace (Portfolio) > Organization (Tenant) > Business (Business)
```
While the database entity `Workspace` was demoted to "Space" on `/workspaces`.

**ADR-076 corrects this alignment:**

1. **Top Context Bar**:
   - `Group` ➔ Displays the Portfolio (e.g. `Group: Wannapa Group`).
   - `Organization` ➔ Displays the Tenant (e.g. `Org: Wannapa Org`).
   - `Business` ➔ Displays the active operating company (e.g. `Business: SmartGift`).
2. **Operational Workspaces**:
   - The `/workspaces` view is restored to its proper name: **Workspaces** (not "Spaces").
   - Each workspace clearly shows its parent Business and operational role.

This brings complete harmony between database entity definitions, business semantics, and user interface navigation.
