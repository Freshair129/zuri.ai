---
doc_type: change-request
id: CR-003
status: proposed
version: "1.0.0"
created_at: "2026-08-30T07:30:00+07:00"
updated_at: "2026-08-30T07:30:00+07:00"
owner: "SmartGift Data Architecture Team"
impacted_domains:
  - data-pipeline
  - integration
  - flowaccount
  - catalog-governance
  - ui
proposed_domains:
  - pipeline-governance
---

# CR-003 — 5-Stage Data Pipeline Governance Dashboard, Ingestion Lanes & Approval Gates UI

## 1. Change Summary

Introduce an enterprise-grade **Data Pipeline Governance & Ingestion Dashboard** in `zuri-ai` (`/platform/workspaces/[id]/pipeline`), supporting multi-lane automated data intake (FlowAccount MCP + Factory Cost Uploads), immutable SHA-256 versioning, visual diff approval gates, and end-to-end provenance audit tracking.

---

## 2. Target Repositories & Action Items

### A. `D:\zuri-ai` (Prisma Model Extension: `prisma/schema.prisma`)
```prisma
model DataPipelineRun {
  id              String    @id @default(uuid())
  runId           String    @unique // e.g. "run-master-20260829T230036Z-xxxx"
  workspaceId     String
  tenantId        String    // e.g. "Org-EtohGroup"
  businessId      String    // e.g. "SmartGift"
  vaultId         String    // e.g. "vlt-catalog-product"
  status          String    // "PROCESSING" | "PENDING_APPROVAL" | "PUBLISHED" | "FAILED"
  catalogVersion  String    // e.g. "catalog-v2026.08.29-fe2bf21f"
  summary         Json      // { totalOffers: 357, added: 12, priceChanges: 3, bomDrifts: 0 }
  createdAt       DateTime  @default(now())
  approvedAt      DateTime?
  approvedBy      String?
}
```

---

### B. `D:\zuri-ai` (UI Dashboard: `/platform/workspaces/[id]/pipeline`)

1. **Lane 1: FlowAccount MCP & Ingestion Monitor:**
   * Connection monitor with FlowAccount MCP (`https://mcp.flowaccount.com/mcp`).
   * **"Trigger Sync FlowAccount"** button with run history, SHA-256 fingerprints, and row diffs (`+N` rows).
2. **Lane 2: Factory Cost & Supplier Upload Portal:**
   * Drag-and-drop file upload for procurement managers (Excel / CSV / PDF).
   * Selector for Supplier Tags (`P-xx`), Warehouses (Guangzhou/Yiwu), and Shipping Modes (Truck/Sea).
3. **Review & Approval Gate (Visual Diff Viewer):**
   * Visual table highlighting `Added Offers`, `Price Changes (Old vs New)`, and `BOM Drifts`.
   * **"Approve & Publish"** action button to push data to Supabase Cloud DB and trigger Edge Vault Substrate re-indexing.
4. **Traceability & Provenance Search:**
   * Real-time search by `event_id`, `product_id`, or `source_ref` for end-to-end auditability.

---

## 3. Non-Negotiable Invariants

1. **Immutable SHA-256 Archiving:** Every incoming export is hashed and archived in `data-pipeline/01_raw/archive/` before processing.
2. **Read-Only Source Files:** Raw upstream Excel exports must never be mutated in place. Normalization is strictly handled via extraction mappers.
