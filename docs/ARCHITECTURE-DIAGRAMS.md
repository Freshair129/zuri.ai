# Architecture Diagrams — Zuri V2

| Field | Value |
|-------|-------|
| **Version** | 1.1.0 |
| **Status** | Draft |
| **Author** | Claude |
| **Date** | 2026-08-15 |
| **Relates to** | [ARCHITECTURE.md](ARCHITECTURE.md), [PRODUCT.md](PRODUCT.md), [ADR-003](decisions/ADR-003-V2-REPLACES-V1-BY-REUSE.md), [ADR-007](decisions/ADR-007-LINE-AI-STACK-SEQUENCING.md), [ADR-016](decisions/ADR-016-SQLITE-AUTHORITY-AND-MANAGED-LOCAL-FILE-WORKSPACE.md), [ADR-018](decisions/ADR-018-SUPABASE-PRODUCTION-TENANT-ISOLATION.md), BR-007, BR-009, BR-010, BR-011, SDD-009, FR-012, FR-019, FR-027, FR-030, FR-045, FR-047…FR-050 |

Four views of the same system:

| § | View | Answers |
|---|---|---|
| **1** | Three-layer architecture | Where does code live, and what may call what |
| **2** | System architecture | Which processes and stores exist, and who may talk to whom |
| **3** | Data flow diagram (L0 + L1) | What **data** moves, from which source to which store |
| **4** | System flowcharts | What **decides** — the branches, the fail-closed paths |

`ARCHITECTURE.md` keeps the domain-shaped diagrams (context chain, execution
hierarchy, progress engine); this document keeps the structural ones.

Diagrams describe **what is in the tree today**, with unbuilt phases marked. Anything
gated by ADR-007 (`P3 Identity` onward) is drawn dashed.

---

## 1. Three-layer architecture

One Next.js app, three layers, dependencies pointing **downward only**. A layer never
imports from the layer above it, and Layer 1 never writes to Layer 3 directly.

```mermaid
flowchart TB
  subgraph L1["LAYER 1 · Presentation & Intake — src/app/"]
    direction LR
    UI["UI routes<br/>(entry) landing · login · /businesses<br/>(pm) overview · projects · work · files · people"]
    RH["Route handlers — thin<br/>src/app/api/** (63 route.js)<br/>parse · authorize · delegate"]
    INTAKE["4 intake surfaces<br/>UI wizard · Excel (.xlsx)<br/>agent JSON envelope · enterprise API"]
    LINEIN["LINE turn seam<br/>/api/agent/line-webhook<br/>returns verified text, never a replyToken"]
  end

  subgraph L2["LAYER 2 · Application & Domain — src/modules/"]
    direction LR
    SVC["Application services — the ONLY writers<br/>project · work · dependency · progress<br/>milestone-gate · file-asset · scope · people<br/>every write emits an audit event"]
    PURE["Pure domain<br/>progress/strategies · progress/rollup<br/>no I/O · no clock"]
    IMPORT["One import pipeline<br/>validate → semantic check → dry run<br/>→ preview → 1 transaction → audit"]
    AI["LINE/AI modules<br/>crm ingest · identity · agent runtime<br/>action-gate · knowledge contract"]
    VAL["Contract edge<br/>Zod schemas · validation/enums.js<br/>(single source of truth)"]
  end

  subgraph L3["LAYER 3 · Data & Ports"]
    direction LR
    PRISMA["Prisma client — src/lib/db.js<br/>schema.prisma (SQLite dev/test)<br/>schema.postgres.prisma (Supabase)"]
    FS["Filesystem port<br/>normalized relative paths<br/>inside a mounted Business root"]
    CACHE[".zuri/cache<br/>disposable projection<br/>rebuildable, never authority"]
    EXT["External ports<br/>model provider · Supabase knowledge<br/>MSP memory port (separate store)"]
  end

  UI --> RH
  INTAKE --> RH
  LINEIN --> RH
  RH --> SVC
  RH --> IMPORT
  RH --> AI
  INTAKE -.->|"every surface converges here"| IMPORT
  SVC --> VAL
  IMPORT --> VAL
  AI --> VAL
  SVC --> PURE
  IMPORT --> SVC
  SVC --> PRISMA
  SVC --> FS
  AI --> EXT
  FS --> CACHE
  RH -.->|"read-only queries only<br/>audit · files · resolve · project tree"| PRISMA

  classDef l1 fill:#e8f1fb,stroke:#3b6ea5,color:#12324f
  classDef l2 fill:#eaf6ec,stroke:#3f8a4d,color:#14331b
  classDef l3 fill:#fdf1e3,stroke:#b57a2a,color:#4a3110
  class UI,RH,INTAKE,LINEIN l1
  class SVC,PURE,IMPORT,AI,VAL l2
  class PRISMA,FS,CACHE,EXT l3
```

### What each layer owns

| Layer | Owns | Lives in | May **not** |
|---|---|---|---|
| **1 · Presentation & Intake** | Rendering, routing, request parsing, authorization check, shaping the response | `src/app/(entry)`, `src/app/(pm)`, `src/app/api` | Contain business rules; **write** to the database (reads are allowed) |
| **2 · Application & Domain** | Business rules, transactions, audit events, progress maths, the import pipeline, AI turn logic | `src/modules/*/application`, `progress/`, `import/`, `src/lib/validation` | Know about HTTP, React, or a specific database engine beyond the Prisma client |
| **3 · Data & Ports** | Persistence, file content, cache projection, outbound calls to MSP / model providers / Supabase | `prisma/`, `src/lib/db.js`, `local-files/`, port modules | Contain domain decisions; be reached from Layer 1 for a **write** |

### The rules the arrows encode

1. **Every write goes through a service** (`application/`), and that service records an
   audit event. Route handlers stay thin — four of them query Prisma directly, all
   read-only (`audit`, `files`, `resolve`, `projects/[id]/tree`).
2. **Four intake surfaces, one pipeline.** UI wizard, Excel, agent JSON and the
   enterprise API all converge on the same envelope → validate → semantic check →
   read-only dry run → preview → single transaction → audit (BR-009, SDD-009). A new
   surface adds a converter, never a second write path.
3. **Progress is recomputed, never trusted from cache.** Layer 2's calculators are pure
   — no I/O, no clock — so a page and an API can never disagree; `progressCache` is
   advisory only.
4. **SQLite is the single relational authority** (ADR-016, BR-010). The filesystem port
   holds content; `.zuri/cache` holds only derived artifacts that can be deleted and
   rebuilt.
5. **Plans are data, never code.** Nothing arriving in an envelope is executed
   (BR-007, SEC-002).
6. **Enums are strings in the database** with `src/lib/validation/enums.js` as the one
   source — Excel dropdowns, the OpenAPI document and validation all derive from it.

---

## 2. System architecture

Processes, surfaces and stores. The **LINE surface is primary** (AI-native intake); the
web app is the back-office console for detail, complex edits and audit.

```mermaid
flowchart TB
  subgraph ACTORS["Actors"]
    OWNER["Business owner / staff"]
    CUST["Customer<br/>(LINE user)"]
  end

  subgraph CHANNEL["Channels"]
    LINEOA["LINE OA<br/>chat · Flex · Rich Menu · LIFF"]
    BROWSER["Browser<br/>back-office console"]
  end

  CLI["zuri-cli — sole LINE transport owner<br/>signature verification · OA → tenant<br/>idempotent Reply API delivery<br/>BR-011 · FR-050"]

  subgraph APP["zuri-ai — Next.js application"]
    direction TB
    SHELL["Entry + Business shell<br/>Landing → Login → /businesses → Overview<br/>ADR-015 · FR-044"]
    PM["Project Manager module<br/>FR-001…FR-020 · 7 execution views<br/>plan import · progress · audit"]
    AGENT["Agent runtime<br/>evidence-grounded Thai answers<br/>action-gate · step-up · read-only (Gate E)<br/>FR-049"]
    KN["Knowledge contract<br/>fixed query shapes<br/>FR-047"]
    ID["Identity<br/>viewer/session · LINE ↔ principal<br/>PDPA erase"]
    APPSVC["Application services + audit<br/>(single write path)"]
  end

  subgraph STORE["Zuri stores"]
    SQLITE["SQLite — dev / test<br/>prisma/dev.db"]
    PG["Supabase Postgres — production<br/>tenant isolation · ADR-018 · FR-030"]
    WS["Mounted Business workspace<br/>real working files"]
    CH[".zuri/cache — disposable"]
  end

  subgraph OUT["External systems (separate lifecycles)"]
    MODEL["Model providers<br/>OpenRouter · OpenAI · Anthropic<br/>Gemini · Groq — FR-048"]
    SBK["Supabase business knowledge<br/>curated public facts"]
    MSP["MSP — agent memory authority<br/>own repo, OWN DATABASE"]
    GKS["GKS / Knowledge Graph<br/>entities + relations"]
  end

  V1["V1 — G:/zuri (live production)<br/>READ-ONLY SOURCE"]

  CUST --> LINEOA
  OWNER --> LINEOA
  OWNER --> BROWSER
  LINEOA <--> CLI
  CLI -->|"HTTP turn"| AGENT
  BROWSER --> SHELL
  SHELL --> PM
  PM --> APPSVC
  AGENT --> KN
  AGENT --> ID
  AGENT -.->|"Gate F only:<br/>writes after authz + audit + step-up"| APPSVC
  KN --> SBK
  AGENT --> MODEL
  APPSVC --> SQLITE
  APPSVC --> PG
  APPSVC --> WS
  WS --> CH
  AGENT -.->|"P3+ — memory keyed by principal,<br/>never by lineUserId"| MSP
  KN -.->|"P5"| GKS
  V1 -.->|"one-directional copy at cutover<br/>UUIDs preserved · ADR-003"| APPSVC

  classDef actor fill:#f3f0fa,stroke:#7a5ea8,color:#2e2145
  classDef chan fill:#e8f1fb,stroke:#3b6ea5,color:#12324f
  classDef app fill:#eaf6ec,stroke:#3f8a4d,color:#14331b
  classDef store fill:#fdf1e3,stroke:#b57a2a,color:#4a3110
  classDef ext fill:#fbeceb,stroke:#b4534b,color:#4a1613
  class OWNER,CUST actor
  class LINEOA,BROWSER,CLI chan
  class SHELL,PM,AGENT,KN,ID,APPSVC app
  class SQLITE,PG,WS,CH store
  class MODEL,SBK,MSP,GKS,V1 ext
```

### Boundaries the diagram is drawing

| Boundary | Statement | Source |
|---|---|---|
| **Transport ⇄ brain** | `zuri-cli` owns LINE signature verification and Reply API delivery; `zuri-ai` owns the knowledge contract, provider invocation and answer verification | ADR-007 (2026-08-14 amendment) |
| **Zuri DB ≠ MSP DB** | May share one Postgres *instance*, never the same database/schema/role — an MSP migration must never drag CRM/POS/invoice down | ADR-007 §P4 |
| **AI never writes directly** | Every AI-derived change is previewed and confirmed by a human; the agent is read-only until Gate F (authorization + audit + step-up auth all proven) | BR-007, ADR-007 |
| **Memory is keyed by principal** | `lineUserId` is a channel fact, not an identity. Memory binds to `tenant:… / principal:…` — which is why Identity (P3) precedes Memory | ADR-007 |
| **One tenant, one system** | A tenant is owned by exactly one system at any instant; LINE OA + workers + writes flip together, or the shop gets double LINE blasts and double charges | ADR-003 §D8 |
| **Reuse is one-directional** | `G:\zuri` is never modified. V1 → V2 copying is allowed; the reverse and any mutation are not. Migrated rows keep V1's UUIDs | AGENTS.md §1, ADR-003 §D4 |
| **External ids are never keys** | Internal UUID + human `code` + `ExternalRef` mapping | BR-002 |

### Build state (2026-08-15)

| Drawn as | Meaning | Which parts |
|---|---|---|
| **Solid** | In the tree, tested | Web shell, Project Manager module, four intake surfaces, application services + audit, SQLite, managed local file workspace, Phase-1 LINE knowledge (FR-047…FR-050) |
| **Dashed** | Decided and gated, not wired | MSP memory (P1/P3), GKS projection (P5), agent write path (Gate F), V1 cutover copy |
| **Postgres** | Schema and migration path exist (`schema.postgres.prisma`, `prisma/postgres/`, `scripts/migrate-to-postgres.mjs`); production provisioning still needs the owner-supplied project and secret boundary | FR-030, ADR-018 |

---

## 3. Data flow diagram

Shapes: `▭` external entity · `(  )` process · `[(  )]` data store. Dashed = gated,
not wired yet.

### 3.1 Level 0 — context diagram

The whole system as one process, with everything it exchanges data with.

```mermaid
flowchart LR
  STAFF["Owner / staff"]
  CUSTOMER["LINE customer"]
  CLI["zuri-cli<br/>LINE transport"]
  PROV["Model provider"]
  SBK["Supabase<br/>business knowledge"]
  MSP["MSP<br/>memory authority"]
  V1["V1 — G:/zuri<br/>(read-only source)"]
  DISK["Device filesystem<br/>mounted Business root"]

  SYS(("0<br/>Zuri V2"))

  STAFF -->|"scope choice · plan (.xlsx / wizard)<br/>work edits · file actions"| SYS
  SYS -->|"views · dry-run preview<br/>progress · audit trail"| STAFF
  CUSTOMER -->|"Thai message"| CLI
  CLI -->|"normalized event batch<br/>+ resolved tenantId"| SYS
  SYS -->|"verified reply text<br/>or skipReply"| CLI
  CLI -->|"Reply API (idempotent)"| CUSTOMER
  SYS -->|"question + evidence packet"| PROV
  PROV -->|"candidate wording"| SYS
  SYS -->|"registered query id + params"| SBK
  SBK -->|"bounded evidence records + asOf"| SYS
  SYS -.->|"memory write, keyed by principal (P3+)"| MSP
  MSP -.->|"recalled context"| SYS
  V1 -.->|"one-directional copy at cutover<br/>UUIDs preserved"| SYS
  SYS <-->|"file content, normalized relative paths"| DISK

  classDef ext fill:#f3f0fa,stroke:#7a5ea8,color:#2e2145
  classDef proc fill:#eaf6ec,stroke:#3f8a4d,color:#14331b
  class STAFF,CUSTOMER,CLI,PROV,SBK,MSP,V1,DISK ext
  class SYS proc
```

### 3.2 Level 1 — processes and stores

```mermaid
flowchart TB
  STAFF["Owner / staff"]
  CLI["zuri-cli"]
  PROV["Model provider"]
  SBKX["Supabase knowledge"]

  P1(("1.0<br/>Entry &<br/>scope resolution"))
  P2(("2.0<br/>Plan intake<br/>pipeline"))
  P3(("3.0<br/>Work &<br/>progress"))
  P4(("4.0<br/>File<br/>workspace"))
  P5(("5.0<br/>LINE<br/>agent turn"))
  P6(("6.0<br/>Audit &<br/>backup"))

  D1[("D1 · Zuri relational store<br/>SQLite dev / Postgres prod")]
  D2[("D2 · AuditEvent log")]
  D3[("D3 · progressCache — advisory")]
  D4[("D4 · .zuri/cache — disposable")]
  D5[("D5 · Business workspace files")]
  D6[("D6 · MSP memory store")]

  STAFF -->|"login stub · business choice"| P1
  P1 -->|"viewer + scope context"| D1
  D1 -->|"entry read model"| P1
  P1 -->|"Business Overview"| STAFF

  STAFF -->|"wizard form · .xlsx · API envelope"| P2
  CLI -->|"agent JSON envelope"| P2
  P2 -->|"read-only diff query"| D1
  D1 -->|"current rows for the diff"| P2
  P2 -->|"preview: inserts / updates / conflicts"| STAFF
  P2 ==>|"confirmed — ONE transaction"| D1
  P2 -->|"IMPORT event"| D2

  STAFF -->|"work edits · gate decisions"| P3
  P3 <-->|"workstreams · items · evidence"| D1
  P3 -->|"recomputed 0..100 + explanation"| D3
  P3 -->|"CREATE / UPDATE / DELETE events"| D2
  D3 -.->|"never trusted — always recomputed"| P3

  STAFF -->|"link · move · reveal"| P4
  P4 <-->|"identity · scope · links · state"| D1
  P4 <-->|"content by relative path"| D5
  P4 -->|"derived projection"| D4
  D4 -.->|"rebuildable"| P4

  CLI -->|"event batch + tenantId"| P5
  P5 -->|"message · conversation · identity"| D1
  P5 -->|"registered query"| SBKX
  SBKX -->|"evidence records"| P5
  P5 -->|"question + evidence"| PROV
  PROV -->|"candidate text"| P5
  P5 -->|"verified text / skipReply"| CLI
  P5 -.->|"P3+ recall/write, keyed by principal"| D6
  P5 -->|"Gate F actions only"| P3

  D1 --> P6
  D2 --> P6
  P6 -->|"snapshot with counts + conflicts,<br/>never a silent overwrite"| STAFF

  classDef ext fill:#f3f0fa,stroke:#7a5ea8,color:#2e2145
  classDef proc fill:#eaf6ec,stroke:#3f8a4d,color:#14331b
  classDef store fill:#fdf1e3,stroke:#b57a2a,color:#4a3110
  class STAFF,CLI,PROV,SBKX ext
  class P1,P2,P3,P4,P5,P6 proc
  class D1,D2,D3,D4,D5,D6 store
```

### What the store boundaries mean

| Store | Authority | Rule |
|---|---|---|
| **D1** Zuri relational store | **The** authority for identity, ownership, links, status, versions | Only application services write to it; every write emits D2 |
| **D2** AuditEvent | Append-only history | Written inside the same transaction as the change |
| **D3** progressCache | None — advisory | A read may never return a number a page would disagree with; recompute wins |
| **D4** `.zuri/cache` | None — derived | Deleting it is safe; it is rebuilt from D1 + D5 |
| **D5** Workspace files | File **content** only | Relations stay queryable links in D1, never folder structure |
| **D6** MSP memory | Agent memory | Physically separate database from D1 (ADR-007 §P4); keyed by principal, never by `lineUserId` |

---

## 4. System flowcharts

### 4.1 Plan intake — every surface, one pipeline

Four surfaces, one path. Nothing in a plan is ever executed — a plan is data
(BR-007, SEC-002).

```mermaid
flowchart TB
  A["Wizard · .xlsx · agent JSON · enterprise API"] --> B["Convert to PlanEnvelope<br/>(one converter per surface)"]
  B --> C{"Zod schema valid?"}
  C -->|no| X1["Return field-path errors<br/>nothing touched"]
  C -->|yes| D{"Semantic checks pass?<br/>refs · cycles · scope"}
  D -->|no| X1
  D -->|yes| E["Resolve identity<br/>externalId → code → new UUID"]
  E --> F["DRY RUN — read-only diff<br/>vs current database"]
  F --> G["Preview: inserts / updates / conflicts<br/>per entity kind"]
  G --> H{"Human confirms?"}
  H -->|no| X2["Abort — database unchanged"]
  H -->|yes| I["ONE transaction:<br/>upsert rows + sync ExternalRef"]
  I --> J{"Transaction committed?"}
  J -->|no| X3["Roll back whole envelope<br/>— no partial import"]
  J -->|yes| K["Write AuditEvent (IMPORT)"]
  K --> L["Recompute progress<br/>from pure calculators"]
  L --> M(["Done — preview counts match committed counts"])

  classDef bad fill:#fbeceb,stroke:#b4534b,color:#4a1613
  classDef good fill:#eaf6ec,stroke:#3f8a4d,color:#14331b
  class X1,X2,X3 bad
  class M good
```

### 4.2 LINE agent turn — read-only, fail closed

The whole point of this flowchart is the two guards: **evidence before generation**,
and **verification after it**. The model's wording is advisory; the evidence packet is
authoritative.

```mermaid
flowchart TB
  A["LINE customer sends a message"] --> B["zuri-cli: verify signature"]
  B --> C{"Signature valid?"}
  C -->|no| X1["Reject — 4xx, no turn"]
  C -->|yes| D["Resolve OA → tenantId<br/>POST /api/agent/line-webhook"]
  D --> E{"Text message event?"}
  E -->|no| S1["Acknowledge 200, skip<br/>(follow · join · sticker · postback)"]
  E -->|yes| F["Ingest: persist message,<br/>resolve conversation + identity"]
  F --> G{"Already seen<br/>externalMessageId?"}
  G -->|yes| S2["skipReply — no duplicate blast"]
  G -->|no| H["Assemble read-only context<br/>identity + memory + knowledge + read tools"]
  H --> I{"Action requested?"}
  I -->|yes| J{"Gate F: authorized?<br/>step-up satisfied?"}
  J -->|"denied / step-up"| S3["Graceful response<br/>ACTION_DENIED · STEP_UP_REQUIRED<br/>turn never crashes"]
  J -->|"allowed"| S4["Execute write tool → ACTION_DONE"]
  I -->|no| K["Select a REGISTERED query<br/>detail · compare · search"]
  K --> L["Fetch bounded evidence packet"]
  L --> M{"Any evidence records?"}
  M -->|no| S5["Ask for a product code<br/>grounded=false · model NOT called"]
  M -->|yes| N["Call model provider<br/>with question + evidence"]
  N --> O{"Provider errored<br/>or timed out?"}
  O -->|yes| P["Deterministic fallback<br/>built from evidence only"]
  O -->|no| Q{"Verify candidate:<br/>unsupported number?<br/>unsupported code?<br/>risky claim?"}
  Q -->|unsupported| P
  Q -->|supported| R["Grounded answer<br/>+ sourceRefs + asOf"]
  P --> T["Return verified text to zuri-cli<br/>(never a replyToken)"]
  R --> T
  S3 --> T
  S4 --> T
  S5 --> T
  T --> U["zuri-cli: idempotent Reply API"]
  U --> V(["Customer sees one reply"])

  classDef bad fill:#fbeceb,stroke:#b4534b,color:#4a1613
  classDef guard fill:#fdf1e3,stroke:#b57a2a,color:#4a3110
  classDef good fill:#eaf6ec,stroke:#3f8a4d,color:#14331b
  class X1 bad
  class P,S2,S3,S5 guard
  class R,V good
```

**Both flowcharts fail closed.** In §4.1 an invalid or unconfirmed envelope leaves
the database byte-identical. In §4.2 every path that cannot be grounded degrades to
evidence-only text rather than to a plausible sentence — an unverifiable price,
product code, or "ส่งฟรี / มีสต็อก" claim is dropped, not sent.
