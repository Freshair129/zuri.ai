<!-- Imported 2026-08-16 from the owner's change-request pack (Downloads/change-request/
     Zuri_Modular_Monolith_Shared_DB_Architecture_Spec.md), verbatim below the banner.
     Adopted by ADR-025 for its DOMAIN TAXONOMY and OWNERSHIP PRINCIPLE only —
     its runtime/database decisions (per-domain Postgres schemas, outbox, module
     contracts) are NOT accepted yet and need their own ADR when implementation
     starts. Status inside the document (Draft v0.1) stands. -->

# Zuri Modular Monolith + Shared Database Architecture Specification

| Field | Value |
|-------|-------|
| **Version** | 0.1.0b |
| **Status** | Draft |

**Document Type:** Architecture Specification  
**System:** Zuri Platform  
**Status:** Draft v0.1  
**Date:** 2026-08-16  
**Primary Style:** Domain-Driven Modular Monolith  
**Database Strategy:** Shared PostgreSQL with Strict Logical Ownership  
**Evolution Strategy:** Event-ready, selectively extractable to Microservices

---

## 1. Purpose

This document defines the target application and database architecture for Zuri as it evolves from a multi-domain business application into a broader ERP-capable platform.

The architecture is intentionally designed to:

- preserve simple deployment and operations while Zuri is still growing;
- keep cross-domain business transactions easy to rollback atomically;
- prevent domain modules from becoming tightly coupled through direct database access;
- support ERP-scale domain growth such as CRM, Sales, Inventory, Accounting, Procurement, HR, and Manufacturing;
- preserve clear boundaries between operational business data, episodic memory, and canonical knowledge;
- provide a controlled migration path from Modular Monolith to selected Microservices when scale or operational requirements justify it.

---

## 2. Architecture Decision

Zuri SHALL use:

> **Domain-Driven Modular Monolith + Shared PostgreSQL + Strict Schema/Table Ownership + Shared Transaction Context + Domain Events/Outbox**

Zuri SHALL NOT begin as a fully distributed microservices system.

The system SHALL optimize first for:

1. consistency;
2. rollback simplicity;
3. clear module ownership;
4. low operational complexity;
5. future extraction readiness.

---

## 3. High-Level Architecture

```text
                         ZURI PLATFORM
                              │
                    ┌─────────▼─────────┐
                    │  API / BFF / UI   │
                    │ Web / Mobile/LINE │
                    └─────────┬─────────┘
                              │
                    ┌─────────▼─────────┐
                    │ Identity / Policy │
                    │ Tenant / RBAC     │
                    └─────────┬─────────┘
                              │
                    ┌─────────▼─────────┐
                    │ Application Layer │
                    │ Use Case Orchestr.│
                    └─────────┬─────────┘
                              │
        ┌──────────────┬──────┼───────┬──────────────┐
        ▼              ▼      ▼       ▼              ▼
     CRM Module     Sales   Inventory Accounting  Procurement
        │              │      │       │              │
        └──────────────┴──────┴───────┴──────────────┘
                              │
                    Public Module Contracts
                              │
                    Shared Transaction Manager
                              │
                              ▼
                       PostgreSQL Cluster
                              │
        ┌──────────────┬──────┼───────┬──────────────┐
        ▼              ▼      ▼       ▼              ▼
      crm.*          sales.* inventory.* accounting.* procurement.*
```

---

## 4. Core Architectural Principle

The physical database MAY be shared.

The ownership of data MUST NOT be shared.

Each domain module owns its own data model and is the only module allowed to perform direct writes to its owned tables.

Example:

```text
PostgreSQL
│
├─ crm.*
│   ├─ customer
│   ├─ contact
│   └─ lead
│
├─ sales.*
│   ├─ quotation
│   ├─ sales_order
│   └─ sales_order_item
│
├─ inventory.*
│   ├─ item
│   ├─ stock_lot
│   └─ stock_movement
│
├─ accounting.*
│   ├─ invoice
│   ├─ journal_entry
│   └─ payment
│
└─ procurement.*
    ├─ supplier
    ├─ purchase_order
    └─ goods_receipt
```

---

## 5. Ownership Rules

### 5.1 Write Ownership

Only the owning module may directly write its tables.

```text
CRM Module
  ✅ INSERT / UPDATE / DELETE crm.*
  ❌ UPDATE sales.*
  ❌ UPDATE inventory.*
  ❌ UPDATE accounting.*
```

### 5.2 Transactional Read

A module SHOULD retrieve data owned by another domain through the owning module's application contract.

Example:

```text
Sales
  -> CRM.getCustomer(customerId)
```

Preferred over:

```text
Sales
  -> SELECT * FROM crm.customer
```

### 5.3 Reporting Read

Cross-domain read access MAY be permitted for:

- reporting;
- BI;
- analytics;
- read-only dashboards;
- approved materialized views/read models.

Reporting components MUST NOT write into operational domain tables.

---

## 6. Database Access Policy

```text
WRITE:
  Only owning module

TRANSACTIONAL READ:
  Prefer owning module contract

CROSS-DOMAIN READ:
  Allowed only through approved contract,
  view, projection, or reporting read model

CROSS-DOMAIN WRITE:
  Never direct

REPORTING:
  Read-only across approved views
```

---

## 7. Module Contract Rule

Every domain SHALL expose a public application contract.

Example:

```text
Inventory Module
├─ reserveStock()
├─ releaseReservation()
├─ checkAvailability()
└─ getAvailableQuantity()
```

Other modules SHALL call those contracts instead of manipulating inventory tables directly.

Example:

```text
Sales.createOrder()
  -> Inventory.reserveStock()
```

NOT:

```text
Sales.createOrder()
  -> UPDATE inventory.stock_item ...
```

---

## 8. Shared Transaction Context

Zuri SHALL allow multiple domain modules to participate in the same database transaction when a use case requires strong consistency.

Example:

```text
BEGIN

Sales.createOrder()
Inventory.reserveStock()
Accounting.createReceivable()

COMMIT
```

If any operation fails:

```text
ROLLBACK
```

All changes MUST be reverted atomically.

This is a major reason for using a shared database in the current architecture.

---

## 9. Cross-Domain Transaction Orchestration

Cross-domain workflows SHALL be coordinated by an application use-case orchestrator.

Example:

```text
CreateSalesOrderUseCase
        │
        ├─ Sales.createOrder()
        ├─ Inventory.reserve()
        └─ Accounting.createReceivable()

      <same transaction context>
```

The orchestrator SHALL NOT bypass module contracts and write directly to each domain table.

---

## 10. Why This Is Preferred Over Early Microservices

With a shared transaction:

```text
Sales          ✅
Inventory      ✅
Accounting     ❌

=> ROLLBACK ALL
```

With independent microservice databases:

```text
Sales DB       COMMIT ✅
Inventory DB   COMMIT ✅
Accounting DB  FAIL   ❌
```

The second case requires additional distributed-system patterns such as:

- Saga;
- compensation;
- retry;
- idempotency;
- message deduplication;
- distributed tracing;
- eventual consistency;
- recovery workflows.

Zuri SHALL avoid introducing this complexity before it is justified.

---

## 11. Domain Boundary Enforcement

Boundary enforcement SHOULD happen at multiple layers.

### Application Layer

Use imports/package boundaries and module interfaces.

### Repository Layer

Each domain repository can access only owned schema/tables.

### Database Layer

Future enforcement MAY use PostgreSQL roles:

```text
zuri_crm_role
  RW crm.*
  no write sales.*

zuri_sales_role
  RW sales.*
  no write crm.*

zuri_reporting_role
  R approved views
  no write operational schemas
```

---

## 12. Suggested Source Structure

```text
src/
├─ platform/
│  ├─ identity/
│  ├─ authorization/
│  ├─ tenancy/
│  ├─ audit/
│  ├─ events/
│  └─ transactions/
│
├─ domains/
│  ├─ crm/
│  │  ├─ domain/
│  │  ├─ application/
│  │  ├─ infrastructure/
│  │  └─ api/
│  │
│  ├─ sales/
│  ├─ inventory/
│  ├─ accounting/
│  ├─ procurement/
│  ├─ hr/
│  └─ manufacturing/
│
├─ agent/
│  ├─ runtime/
│  ├─ tools/
│  └─ orchestration/
│
└─ integrations/
   ├─ line/
   ├─ email/
   └─ external-api/
```

---

## 13. ERP Domain Growth Model

Zuri SHOULD grow by bounded business domains, not by arbitrary screens/features.

Recommended core domains:

```text
CRM
├─ Customer
├─ Contact
├─ Lead
└─ Interaction

Sales
├─ Quotation
├─ SalesOrder
├─ Pipeline
└─ Pricing

Inventory
├─ Item
├─ Warehouse
├─ StockLot
├─ Reservation
└─ StockMovement

Procurement
├─ Supplier
├─ PurchaseRequest
├─ PurchaseOrder
└─ GoodsReceipt

Accounting
├─ Invoice
├─ Payment
├─ Journal
├─ AccountsReceivable
└─ AccountsPayable

HR
├─ Employee
├─ Position
├─ Attendance
└─ Payroll

Manufacturing
├─ BOM
├─ ProductionOrder
├─ MaterialIssue
└─ WorkCenter
```

---

## 14. Event Architecture

Even while deployed as a monolith, Zuri SHOULD define domain events.

Example:

```text
SalesOrderCreated
        │
        ├──> Inventory
        │      reserve stock
        │
        ├──> Accounting
        │      create receivable
        │
        ├──> CRM
        │      update customer activity
        │
        └──> Agent
               notify / follow-up
```

Initially, events MAY be in-process.

Later:

```text
In-Process Event Bus
        ↓
Transactional Outbox
        ↓
NATS / Kafka / RabbitMQ
```

---

## 15. Transactional Outbox

When Zuri begins publishing asynchronous domain events, the preferred pattern SHALL be Transactional Outbox.

```text
Business Transaction
        │
        ├─ write domain state
        └─ write outbox event

        COMMIT
           │
           ▼
     Outbox Publisher
           │
           ▼
       Event Bus
```

This avoids:

```text
DB COMMIT ✅
Event Publish ❌
```

without a recoverable record.

---

## 16. MSP and GKS Are Separate Authorities

MSP and GKS SHALL NOT be treated as ordinary ERP modules.

They belong to the cognitive platform layer.

```text
                    ┌──────────────────┐
                    │  Agent Runtime   │
                    │  Orchestration   │
                    └───────┬──────────┘
                            │
       ┌────────────────────┼────────────────────┐
       │                    │                    │
       ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────┐    ┌────────────────┐
│     MSP      │    │     GKS      │    │ ERP Domains    │
│ Experiential│    │ Canonical    │    │ Operational    │
│ Memory      │    │ Knowledge    │    │ Business State │
└──────────────┘    └──────────────┘    └────────────────┘
```

---

## 17. Data Authority Model

Zuri SHALL distinguish at least three kinds of truth.

### 17.1 ERP Operational Truth

Answers:

> What is the business state now?

Examples:

- stock quantity;
- invoice status;
- outstanding balance;
- purchase order status;
- employee status.

Authority:

```text
ERP Domain Database
```

### 17.2 MSP Experiential Memory

Answers:

> What happened before, to whom, in what context?

Examples:

- previous conversation;
- user interaction;
- task history;
- thread/session context;
- episode;
- prior agent mistake/recovery.

Authority:

```text
MSP
```

### 17.3 GKS Canonical Knowledge

Answers:

> What does the system know as governed, canonical knowledge?

Examples:

- product identity;
- business rules;
- entity relationships;
- approved SOP;
- validated concepts;
- semantic relations.

Authority:

```text
GKS
```

---

## 18. Cognitive Data Flow

Example request:

> "What did this customer ask before, and is the product currently available?"

```text
Agent
  │
  ├─ MSP
  │    └─ recall previous interaction
  │
  ├─ GKS
  │    └─ resolve product/entity/relationship
  │
  └─ Inventory Domain
       └─ get current stock
```

The system MUST NOT confuse these sources.

---

## 19. MSP → GKS Promotion

Conversation data SHALL NOT become canonical knowledge automatically.

Correct flow:

```text
Conversation / Event
        │
        ▼
       MSP
     Episode
        │
        ▼
 Knowledge Candidate
        │
   validation/governance
        │
        ▼
       GKS
 Canonical Knowledge
```

Incorrect flow:

```text
Conversation
    ↓
   GKS
```

---

## 20. Physical Database Deployment

Initial deployment MAY use one PostgreSQL cluster.

Example:

```text
PostgreSQL Cluster
│
├─ zuri operational schemas
│  ├─ crm.*
│  ├─ sales.*
│  ├─ inventory.*
│  ├─ accounting.*
│  └─ procurement.*
│
├─ msp.*
│
└─ gks.*
```

Logical authority MUST remain separate even if physical infrastructure is shared.

MSP and GKS MAY later move to separate databases/storage engines without changing application semantics.

---

## 21. Agent Access Rule

The AI/Agent layer SHALL NOT bypass domain boundaries.

Agents MUST call explicit domain capabilities.

Preferred:

```text
sales.createQuotation()
inventory.checkAvailability()
accounting.getOutstandingBalance()
crm.getCustomerProfile()
```

Forbidden:

```text
Agent
  -> arbitrary SQL across ERP tables
```

The agent is an orchestration/interaction layer, not a database superuser.

---

## 22. Read Model and Reporting Strategy

For cross-domain dashboards and reporting, Zuri SHOULD use:

- SQL views;
- materialized views;
- reporting schema;
- read projections;
- analytics warehouse when scale justifies it.

Example:

```text
crm.*
sales.*
inventory.*
accounting.*
      │
      ▼
reporting.customer_360_view
```

Reporting models SHALL be read-only with respect to operational domain ownership.

---

## 23. Extraction to Microservices

A domain SHOULD be extracted only when there is a real operational reason.

Typical triggers:

- independently high load;
- separate deployment cadence;
- different scaling profile;
- stronger security/compliance isolation;
- independent ownership/team;
- different availability requirements;
- external integration boundary;
- database size/performance isolation.

Example:

```text
Before:

Zuri Modular Monolith
├─ CRM
├─ Sales
├─ Inventory
└─ Accounting

After:

Zuri Core
├─ CRM
├─ Sales
└─ Accounting

Inventory Service
      │
      ▼
Inventory DB
```

---

## 24. Extraction Strategy

Preferred evolution:

```text
Modular Monolith
      │
      ▼
Stable Module Contract
      │
      ▼
Domain Events / Outbox
      │
      ▼
Externalize One Module
      │
      ▼
Independent Service + DB
```

This is a Strangler-style extraction strategy.

---

## 25. Anti-Patterns

The following are prohibited architectural directions.

### Giant Shared Database Coupling

```text
Every module
  -> reads/writes every table
```

### Direct Cross-Domain Writes

```text
Sales
  -> UPDATE inventory.stock
```

### Agent Database Superuser

```text
LLM
  -> SQL any table
```

### Premature Microservices

Creating dozens of independent services before scale requires it.

### Automatic Conversation-to-Knowledge Promotion

```text
Raw chat
  -> canonical GKS fact
```

---

## 26. Architecture Invariants

1. Every operational table has exactly one owning domain.
2. Only the owning domain may directly write that table.
3. Cross-domain write operations go through module contracts.
4. Strongly consistent workflows MAY share one DB transaction.
5. The use-case orchestrator coordinates cross-domain transactions.
6. Domain events are explicit even when initially in-process.
7. Event publication SHOULD evolve toward Transactional Outbox.
8. Reporting may read across domains but MUST remain non-owning.
9. MSP owns episodic/contextual memory semantics.
10. GKS owns canonical knowledge/relation semantics.
11. ERP domain databases own current operational business state.
12. Agent runtime consumes capabilities; it does not bypass domain authority.
13. Physical database sharing does not imply logical ownership sharing.
14. Domain boundaries must remain extractable to future services.

---

## 27. Recommended Initial Deployment

```text
              ┌──────────────────────┐
              │      Zuri App        │
              │ Modular Monolith     │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ PostgreSQL Cluster   │
              │                      │
              │ crm.*                │
              │ sales.*              │
              │ inventory.*          │
              │ accounting.*         │
              │ procurement.*        │
              │ msp.*                │
              │ gks.*                │
              └──────────┬───────────┘
                         │
                    Outbox Events
                         │
                         ▼
                  In-Process Bus
```

External services MAY remain separate where runtime characteristics differ significantly, such as:

- LINE gateway/transport;
- AI model execution workers;
- background job workers;
- file processing;
- analytics pipeline.

---

## 28. Target Evolution

```text
Phase 1
Modular Monolith
+ Shared DB
+ Strict Ownership
+ Shared Transactions

        ↓

Phase 2
Domain Events
+ Transactional Outbox
+ Read Models

        ↓

Phase 3
Independent Workers
+ Event Broker

        ↓

Phase 4
Selective Service Extraction
Inventory / Accounting / Agent Runtime / etc.

        ↓

Phase 5
Distributed ERP Platform
only where justified
```

---

## 29. Final Decision

For Zuri, the default architecture SHALL be:

> **Modular Monolith with a Shared PostgreSQL database, strict domain-level schema/table ownership, module contracts for cross-domain access, shared transaction context for atomic rollback, and event/outbox seams for future extraction.**

MSP, GKS, and ERP operational storage SHALL remain separate semantic authorities even if they initially share physical infrastructure.

This architecture is intended to maximize near-term consistency and delivery speed while preserving a controlled path toward a larger ERP and selectively distributed system.
