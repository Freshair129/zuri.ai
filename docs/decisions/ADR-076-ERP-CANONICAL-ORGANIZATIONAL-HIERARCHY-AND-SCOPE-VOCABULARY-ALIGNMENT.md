---
id: ZAI:ADR-076
title: ERP-canonical organizational hierarchy and scope vocabulary alignment
version: "1.0.0"
status: accepted
created_at: "2026-09-12T12:45:00+07:00,Antigravity"
last_update: "2026-09-12T12:45:00+07:00,Antigravity"
author: Antigravity
attributes:
  doc_type: architecture-decision
  domain: platform
relations:
  - type: relates_to
    target: ZAI:ADR-011
  - type: relates_to
    target: ZAI:ADR-008
  - type: references
    target: ZAI:ERP-ORGANIZATIONAL-HIERARCHY
---

# ADR-076 — ERP-Canonical Organizational Hierarchy and Scope Vocabulary Alignment

**Status:** Accepted  
**Date:** 2026-09-12  
**Decided by:** Executive instruction ("ปรับปรุงให้ได้มาตฐานตาม erp เขียน adr กับ เอกสารอธิบายด้วย")  

This decision amends ADR-011 and ADR-008, enforcing AGENTS.md Rule 2 & 3, BR-001, FR-001, FR-020, FR-033, FR-039, FR-044, SDD-012, SDD-018, and is documented in [ERP-ORGANIZATIONAL-HIERARCHY](../architecture/ERP-ORGANIZATIONAL-HIERARCHY.md).

---

## Context

In [ADR-011](ADR-011-CONTEXT-BAR-AND-BUSINESS-SCOPE-CEILING.md) (2026-08-13), the shell context bar was structured as:
```text
Workspace (Portfolio) > Organization (Tenant) > Business (Business)
```
At that time, ADR-011 acknowledged:
> *"The shell mixed two meanings of 'Workspace': Portfolio is the PM-style top container, while schema Workspace is a lower operating container."*

To accommodate this, the system compromised by:
1. Labeling the topmost `Portfolio` entity as **"Workspace"** in the topbar chrome (e.g. `Workspace: Wannapa Workspace`).
2. Demoting the actual database entity `Workspace` (which sits underneath `Business`) to be called **"Space"** (e.g. on `/workspaces`).

This overloading created immediate confusion in real-world operations:
- Users saw "Workspace" on the very top bar, but then discovered 5 different "Workspaces" in the database/spaces list under specific businesses (e.g. `SmartGift Workspace`, `EMC Workspace`).
- It obscured the true ERP multi-entity hierarchy: Conglomerate / Group ➔ Tenant Boundary ➔ Operating Company / Business ➔ Operating Workspace ➔ Branch / Location.
- Questions also arose regarding whether a branch could be modeled via `tenant_id`, which directly threatens data isolation and cross-branch customer sharing.

---

## Decision

### D1 — Rename Context Bar Level 1 to `Group`
The Base Context Bar in the top navigation is aligned with standard ERP vocabulary:
```text
Group  >  Organization  >  Business
```

| UI Label | Schema Entity | ERP Concept Equivalent | Role & Meaning |
|---|---|---|---|
| **Group** | `Portfolio` | Corporate Group / Holding / Conglomerate | ระดับกลุ่มบริษัท/เครือธุรกิจ สำหรับรวมงบและการบริหารระดับนโยบาย |
| **Organization** | `Tenant` | Tenant / Isolation Boundary | ขอบเขตความปลอดภัยและการแบ่งแยกข้อมูลสูงสุด (Security Boundary) |
| **Business** | `Business` | Operating Company / Company Code / Subsidiary | บริษัทหรือหน่วยธุรกิจที่ดำเนินงานจริง (เช่น SmartGift, EMC) |

### D2 — Restore `Workspace` as the Operating Entity under Business
The database entity `Workspace` is officially restored to its true identity: **Workspace (พื้นที่ทำงานปฏิบัติการ)** under a Business or shared platform.
- The UI term "Space" is retired in favor of **Workspace**.
- Each Business can own one or more operational Workspaces (e.g. `WS-SMARTGIFT`, `WS-EMC`) to organize its projects, workflows, and execution teams.

### D3 — Absolute Separation: Branch is Location, Tenant is Isolation
Reaffirm non-negotiable **Rule 3** and **BR-001**:
- **`tenant_id` is NEVER a branch.** A branch is an operational location (`branch_id`), not a tenant.
- A Tenant represents the complete multi-business data boundary. Businesses and branches within the same Tenant share the single customer master (CRM), loyalty points, and cross-branch fulfillment.
- Modeling a branch as a Tenant fragments customer data, breaks unified accounting, and creates severe RBAC authorization holes.

### D4 — Canonical 5-Level ERP Organizational Hierarchy
The authoritative 5-tier organizational hierarchy of Zuri-AI is codified as:

```text
1. Portfolio / Group (pfl_id)
   ↓
2. Tenant / Security Boundary (tenant_id)
   ↓
3. Business / Operating Company (bus_id)
   ↓
4. Workspace / Operating Unit (workspace_id)
   ↓
5. Branch / Location (branch_id)
```

---

## Consequences

- **Clarity:** Eliminates vocabulary conflicts. The user sees "Group" at the top and "Workspace" where workspaces actually live.
- **Standards-Compliant:** Conforms to SAP (Client ➔ Company Code ➔ Plant), NetSuite (Holding ➔ Subsidiary ➔ Location), and Dynamics 365.
- **Preserved Invariants:** IDs (`portfolioId`, `tenantId`, `businessId`, `workspaceId`, `branchId`) and API data contracts remain unchanged. Only user-facing display mappings in `scope-views.js` and top navigation chrome are updated.
