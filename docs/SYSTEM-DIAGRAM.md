# System Diagram — zuri-ai ทั้งระบบ

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Draft — snapshot of what exists on `main` plus the declared lanes, drawn 2026-09-05 |
| **Author** | Claude Fable 5.1 |
| **Date** | 2026-09-05 |
| **Relates to** | [ARCHITECTURE-DIAGRAMS.md](ARCHITECTURE-DIAGRAMS.md) (three-layer, data-flow and flowchart views from 2026-08-15), [ARCHITECTURE.md](ARCHITECTURE.md), [DOMAIN-MAP.md](DOMAIN-MAP.md) (generated ownership), [PRODUCT.md](PRODUCT.md), ADR-007, ADR-018, ADR-025, ADR-041, ADR-043, ADR-044, ADR-058, ADR-059, ADR-060 |

หน้านี้ตอบคำถามเดียว: **ระบบทั้งหมดประกอบด้วยอะไร ใครคุยกับใคร และอะไรสร้างแล้ว/ยังไม่สร้าง** ณ วันที่วาด
ทุกกล่องอ้างอิงเอกสารที่มีอยู่จริง ไม่มี mock; สิ่งที่ยังเป็นประกาศ (declared) วาดเป็นเส้นประและติดป้าย *planned*
มุมมองที่ละเอียดกว่า (three-layer, DFD, flowchart) อยู่ใน `ARCHITECTURE-DIAGRAMS.md`
และความเป็นเจ้าของ model รายโดเมนที่ generate จาก charter อยู่ใน `DOMAIN-MAP.md`

**สัญลักษณ์**: เส้นทึบ = สร้างแล้วและมี test · เส้นประ = ประกาศแล้ว ยังไม่มีโค้ด · กล่องสีเทา = ระบบภายนอก/repo อื่น

---

## 1. System context — ระบบและสิ่งรอบข้าง

```mermaid
flowchart TB
  subgraph ACTORS["ผู้ใช้"]
    OWNER["เจ้าของธุรกิจ / พนักงาน<br/>(Person · Membership · RoleBinding)"]
    CUST["ลูกค้า<br/>(LINE user → ChannelIdentity → Person)"]
    OPER["Installation operator<br/>(PlatformGrant · isOperator)"]
  end

  subgraph CHANNELS["ช่องทาง"]
    LINEOA["LINE Official Account<br/>chat · Flex · Rich Menu · LIFF<br/>(หลาย OA ต่อ Business — ADR-060)"]
    BROWSER["Browser<br/>back-office console (Next.js UI)"]
    API["Enterprise API / Plugin / MCP<br/>ApiAccessKey · PluginSession"]
  end

  subgraph EDGE["Zuri Edge Device — หน้างานลูกค้า (repo: zuri-edge-device)"]
    EDGERT["Edge runtime<br/>LINE ingress + signature + channel token<br/>local LLM: Ollama / Codex CLI<br/>evidence OCR (FR-143) · LINE reply owner (BR-011)"]
  end

  subgraph CLOUD["zuri-ai — Next.js app (Docker Compose: web + ngrok)"]
    APP["UI + API routes + application services<br/>10 domains (ดู §3)"]
  end

  subgraph STORES["ที่เก็บข้อมูล"]
    PG["Supabase Postgres (production)<br/>public schema = Prisma models<br/>zuri_core = private runtime tables (binding, business_knowledge)<br/>Vault = secretRef · Storage bucket asset-evidence"]
    SQLITE["SQLite (dev / test)<br/>prisma/dev.db · prisma/.test-dbs"]
    FILES["Managed local file workspace<br/>FileAsset · .zuri/cache"]
  end

  subgraph EXT["ระบบภายนอก (แยก lifecycle)"]
    LINEP["LINE Platform<br/>Messaging API · Webhook · Insight"]
    MODELS["Model providers<br/>OpenRouter · OpenAI · Anthropic · Gemini · Groq"]
    MSP["MSP — Tier 2<br/>Memory-and-Soul-Passport (repo แยก)"]
    GKS["GKS — Tier 3<br/>Genesis-Knowledge-System (repo แยก)"]
    GBDB["GenesisBlockDB — Tier 4<br/>6-lane substrate"]
    GH["GitHub<br/>repo projection (FR-130) · CI"]
    FA["FlowAccount<br/>(candidate FR-125 / ADR-053)"]
  end

  OWNER --> BROWSER --> APP
  OWNER --> API --> APP
  OPER --> BROWSER
  CUST --> LINEOA
  LINEOA <--> LINEP
  LINEP -->|"webhook: EDGE tenant"| EDGERT
  LINEP -.->|"webhook: CLOUD tenant<br/>(signature in zuri-ai — planned, ADR-060 D5)"| APP
  EDGERT -->|"normalized event · delivery receipt<br/>evidence handoff · job claim (edgk_ credential)"| APP
  APP --> PG
  APP --> SQLITE
  APP --> FILES
  APP -->|"Phase 1 LLM turn (CLOUD)<br/>secretRef via Vault"| MODELS
  APP -.->|"episodic memory keyed by Person<br/>(ADR-007 P4 · ADR-023)"| MSP
  APP -.->|"governed knowledge · RAG<br/>(ADR-042 · ADR-050)"| GKS
  MSP -.-> GBDB
  GKS -.-> GBDB
  APP --> GH
  APP -.-> FA

  classDef actor fill:#f3f0fa,stroke:#7a5ea8,color:#2e2145
  classDef chan fill:#e8f1fb,stroke:#3b6ea5,color:#12324f
  classDef app fill:#eaf6ec,stroke:#3f8a4d,color:#14331b
  classDef store fill:#fdf1e3,stroke:#b57a2a,color:#4a3110
  classDef ext fill:#eeeeee,stroke:#777,color:#222
  classDef edge fill:#fff4e5,stroke:#c27c0e,color:#3d2a05
  class OWNER,CUST,OPER actor
  class LINEOA,BROWSER,API chan
  class APP app
  class PG,SQLITE,FILES store
  class LINEP,MODELS,MSP,GKS,GBDB,GH,FA ext
  class EDGERT edge
```

สิ่งที่แผนภาพนี้ยืนยัน

| ขอบเขต | ข้อความ | ที่มา |
|---|---|---|
| หนึ่ง reply owner ต่อ LINE event | อุปกรณ์ edge (บัญชี EDGE) หรือคลาวด์ (บัญชี CLOUD) — ไม่ใช่ทั้งคู่ | BR-011, ADR-060 D5 |
| ความลับของ LINE ไม่อยู่ในคอนโซล | edge ถือ channel secret/token ของตัวเอง; บัญชี CLOUD ใช้ Vault ผ่าน port ของ integration | ADR-041 D2/D3, ADR-031 |
| Zuri DB ≠ MSP DB | ใช้ Postgres instance ร่วมได้ แต่คนละ schema/role/migration | ADR-007 §P4 |
| memory ผูกกับ Person ไม่ใช่ lineUserId | Identity มาก่อน Memory | ADR-007, ADR-045 |
| external id ไม่ใช่ key | UUID + code + ExternalRef | BR-002 |
| AI ไม่เขียนตรง | agent อ่านอย่างเดียวจนกว่า Gate F | BR-007, ADR-007 |

---

## 2. Runtime และ deployment topology

```mermaid
flowchart LR
  subgraph HOST["Host machine (Windows) — Docker Compose project `zuri-ai` (ADR-058)"]
    NGROK["ngrok container<br/>static domain → web:3000<br/>inspection UI loopback only"]
    WEB["web container<br/>Next.js standalone · non-root<br/>HEALTHCHECK GET /api/health (FR-142)"]
    LOCALDB["postgres:16 (profile local-db)<br/>+ db-migrate: prisma db push<br/>ทางเลือกแทน Supabase สำหรับทดสอบ"]
  end

  INTERNET["Internet<br/>LINE webhook · browsers · edge devices"] --> NGROK --> WEB
  WEB -->|"DATABASE_URL (Supavisor session pooling, FR-145)<br/>DIRECT_URL สำหรับ migrate"| SUPA
  WEB -.->|"profile local-db"| LOCALDB

  subgraph SUPA["Supabase project (production)"]
    PUB["public schema — Prisma models<br/>RLS forced · grants เฉพาะ zuri_app_runtime / zuri_web_login<br/>revoked from anon/authenticated/service_role"]
    CORE["zuri_core (private)<br/>portfolio · tenant · business · person · customer ·<br/>line_channel_binding · line_activation_event ·<br/>integration_* · business_knowledge · customer_import_*"]
    VAULT["Vault<br/>secretRef = supabase-vault:&lt;uuid&gt;<br/>resolver ทำงานภายใต้ zuri_line_runtime เท่านั้น"]
    BUCKET["Storage bucket asset-evidence (private)<br/>ไบต์หลักฐานทรัพย์สิน; ไม่มี public URL"]
  end

  subgraph CI["GitHub Actions — governance.yml ทุก PR"]
    CHANGES["changes (path filter)"] --> VERIFY["verify: npm test → build → govern"] --> E2E["e2e (Playwright, ข้ามเมื่อเป็นเอกสารล้วน)"]
  end

  subgraph DEV["Developer machines"]
    PRIMARY["primary checkout (detached at origin/main)<br/>ห้ามเป็น working lane (ADR-051)"]
    WT["git worktrees ข้างกัน<br/>zuri-ai-&lt;lane&gt; · npm ci ของตัวเองเมื่อรัน test"]
    SQL["SQLite ต่อ worktree<br/>prisma/.test-dbs ต่อการรัน"]
  end
  WT --> SQL

  classDef box fill:#eaf6ec,stroke:#3f8a4d,color:#14331b
  classDef ext fill:#eeeeee,stroke:#777,color:#222
  classDef store fill:#fdf1e3,stroke:#b57a2a,color:#4a3110
  class NGROK,WEB,LOCALDB box
  class INTERNET,CHANGES,VERIFY,E2E ext
  class PUB,CORE,VAULT,BUCKET,SQL store
  class PRIMARY,WT box
```

ข้อเท็จจริงที่ควรรู้: `docker-compose.yml` ตรึงชื่อ project เป็น `zuri-ai` ดังนั้น `docker compose up` จาก worktree ไหนก็ recreate stack ตัวเดียวกันของเครื่อง (CLAUDE.md); การ deploy ส่งให้ session ที่ถือบทบาท deploy

---

## 3. Domain map — โดเมนใน `src/modules/` และสิ่งที่แต่ละโดเมนเป็นเจ้าของ

ความเป็นเจ้าของ model บังคับด้วย preflight (ADR-025 D3): หนึ่ง model มีเจ้าของเดียว เขียนได้เฉพาะเจ้าของ; โดเมนอื่นเรียกผ่าน contract

```mermaid
flowchart TB
  subgraph PM["project-manager (+ business, people)"]
    PMM["Portfolio · Tenant · LegalEntity · Business · Branch ·<br/>Workspace · Project · Workstream · WorkContainer · WorkItem ·<br/>Milestone · Gate · Dependency · Repository · FileAsset · FileLink ·<br/>Membership · Team · AuditEvent · PlanImportReceipt · BusinessRoadmap/Goal"]
  end
  subgraph ID["identity"]
    IDM["ExternalIdentity · ChannelIdentity · IdentityLinkToken · ExternalRef ·<br/>RoleBinding · Session · PersonCredential · PasswordResetToken ·<br/>WorkspaceMembership/Invite · ApiAccessKey · SotDataPlaneKey ·<br/>PlatformGrant · Plugin* · EdgeDeviceCredential"]
  end
  subgraph CRM["crm"]
    CRMM["Person · Customer · Conversation · Message ·<br/>ConversationAnalysis · CustomerImport*"]
  end
  subgraph INT["integration (+ src/platform/integrations)"]
    INTM["IntegrationProvider · IntegrationConnection · IntegrationCredential ·<br/>IngestionRun · RawExternalRecord · SyncCursor · ExternalEntityRef ·<br/>DeadLetterRecord · SotDecision · Pipeline* (ledger ของทุก pipeline)"]
  end
  subgraph AG["agent — ไม่มี Prisma model โดยตั้งใจ"]
    AGM["zuri_core.line_channel_binding · line_activation_event (Postgres)<br/>webhook seam · handleAgentTurn · activation · canary · heartbeat"]
  end
  subgraph KN["knowledge — ไม่มี Prisma model"]
    KNM["zuri_core.business_knowledge · ingestion stages 1..8 (pure)<br/>ใช้ ledger ของ integration ผ่าน createPipelineRun"]
  end
  subgraph MI["market-intelligence"]
    MIM["MarketObservation (+ candidates)"]
  end
  subgraph AM["asset-management"]
    AMM["RegisteredAsset · AssetIntake · AssetEvidence · AssetProcurementRef ·<br/>AssetLot · AssetResponsibility · AssetLocationHistory ·<br/>AssetProjectAllocation · AssetDepreciationCandidate · AssetExtractionJob"]
  end
  subgraph LOS["line-oa-studio (ADR-060, FEAT-018)"]
    LOSM["LineOaAccount ✔ (FR-146)<br/>planned: LineOaRichMenu · LineOaFlexTemplate · LineOaFlow/Version/Session ·<br/>LineOaLiffApp · LineOaTemplate · LineOaDispatch · LineOaTransportJob ·<br/>LineOaSchedule · LineOaInsightSnapshot"]
  end
  subgraph PC["platform-control — ไม่มี model"]
    PCM["/control/** (operator) · GET /api/health"]
  end

  CRM -->|"resolveLineIdentity"| ID
  AG -->|"ingestLineMessage · recordLineReply"| CRM
  AG -->|"resolveAuthorizationContext"| ID
  AG -->|"raw evidence (FR-081)"| INT
  AG -->|"knowledge contract"| KN
  KN -->|"createPipelineRun (ledger)"| INT
  MI -->|"translateRawRecord"| INT
  AM -->|"FileAsset ref"| PM
  AM -->|"resolveEdgeDeviceContext"| ID
  LOS -->|"readLineOaConnectionHealth"| INT
  LOS -->|"assertDomainVisible · hasPermission(LINE_OA_PUBLISHER)"| ID
  LOS -.->|"bindingStatus port (planned)"| AG
  LOS -.->|"inbox read model · consent (planned)"| CRM
  ID -->|"Person write (recorded debt)"| CRM
  PM -->|"recordAudit (shared seam)"| PM

  classDef dom fill:#eaf6ec,stroke:#3f8a4d,color:#14331b
  classDef nod fill:#ffffff,stroke:#3f8a4d,color:#14331b
  class PM,ID,CRM,INT,AG,KN,MI,AM,LOS,PC dom
  class PMM,IDM,CRMM,INTM,AGM,KNM,MIM,AMM,LOSM,PCM nod
```

Navigation (Tier 2 domain bar, `src/config/domains.js`): Business Home · Commerce* · CRM · Market Intelligence · Marketing* · Operations* · HR / People · Development · Asset Management · LINE OA Studio* · Platform — เครื่องหมาย * = ช่อง `soon` ที่ซ่อนไว้ ยังไม่มีหน้า

---

## 4. เส้นทาง LINE — inbound turn และ outbound

### 4.1 บัญชี CLOUD (ค่า default ของ tenant ทั่วไป — ADR-060 D5)

```mermaid
sequenceDiagram
  autonumber
  participant U as ลูกค้า (LINE)
  participant L as LINE Platform
  participant T as Transport owner<br/>(วันนี้: zuri-cli/edge forward; planned: zuri-ai verify เอง)
  participant W as POST /api/agent/line-webhook (agent)
  participant I as identity
  participant C as crm
  participant S as line-oa-studio (planned)
  participant M as Model provider (Vault secretRef)
  U->>L: ข้อความ
  L->>T: webhook (signature)
  T->>W: normalized event + bindingId + destination + bearer
  W->>W: resolve binding → tenant/business (FR-052, fail closed)
  W->>I: resolveLineIdentity / ChannelIdentity (channelAccountId = binding code)
  W->>C: ingestLineMessage (Person · Customer · Conversation · Message)
  W-->>S: resolveAutomation(account, trigger) — planned (flows)
  W->>M: grounded answer (FR-047/FR-057, read-only Gate E)
  W-->>T: verified text (ไม่มี replyToken)
  T->>L: Reply API (หนึ่ง reply — FR-050)
  T->>W: POST /api/agent/line-delivery (FR-093 receipt)
  W->>C: recordLineReply (Message OUTBOUND)
```

### 4.2 บัญชี EDGE (tenant ที่ใช้ Ollama / Codex CLI บนอุปกรณ์ — ADR-031 rev 0.3.0b, ADR-060 D5)

```mermaid
sequenceDiagram
  autonumber
  participant U as ลูกค้า (LINE)
  participant L as LINE Platform
  participant E as Zuri Edge Device<br/>(signature · token · local LLM)
  participant A as zuri-ai cloud
  U->>L: ข้อความ
  L->>E: webhook (edge ถือ channel secret)
  E->>A: normalized event → line-webhook (evidence · identity · crm rows)
  E-->>A: GET published-config (flows · rich menu · bot profile) — planned
  E->>E: ตอบด้วย Ollama / Codex CLI (โควตาแพครายเดือน)
  E->>L: Reply API (reply owner — BR-011)
  E->>A: POST /api/agent/line-delivery (receipt, FR-093)
  A-->>E: LineOaTransportJob claim/bytes/complete — planned (rich menu · dispatch · insight)
```

กฎที่ทั้งสองแบบใช้ร่วมกัน (ADR-060 D5 v0.3.1): reply ที่ส่งระหว่าง turn รายงานผ่าน FR-093; งานที่เริ่มจาก Studio รายงานเป็นผลของ job — หนึ่งการส่ง หนึ่ง receipt path

---

## 5. Four-tier cognitive stack (ADR-043) — ใครถืออะไร

```mermaid
flowchart TB
  T1["Tier 1 — zuri-ai + Zuri Edge Device<br/>business execution · scope chain Portfolio→Tenant→Business→Workspace→Project<br/>LINE ingress · Flex/Rich Menu/LIFF · quotes · orders"]
  T2["Tier 2 — MSP (repo Memory-and-Soul-Passport)<br/>session lifecycle · episodic memory · vault gates · H0–H4 ceilings<br/>unified thread id th_usr_/th_grp_ (ADR-044)"]
  T3["Tier 3 — GKS (repo Genesis-Knowledge-System)<br/>canonical entities · ontology · dedup · scoped RAG · radius R0–R6<br/>knowledge ingestion stages 9..17"]
  T4["Tier 4 — GenesisBlockDB<br/>6-lane substrate: vector · lexical · graph · SQLite · bitemporal · provenance<br/>query-ir.v1"]
  T1 -->|"task & session context"| T2 -->|"governed scope promotion & search"| T3 -->|"typed query IR"| T4
  T1 -.->|"never directly"| T4
  classDef tier fill:#eaf6ec,stroke:#3f8a4d,color:#14331b
  classDef ext fill:#eeeeee,stroke:#777,color:#222
  class T1 tier
  class T2,T3,T4 ext
```

zuri-ai เป็น Tier 1 เท่านั้น: ไม่คุยกับ GenesisBlockDB ตรง ไม่ข้าม MSP; knowledge ingestion stage 1..8 เป็น calculator บริสุทธิ์ในโดเมน knowledge ส่วน stage 9..17 อยู่ใน GKS/GenesisBlockDB (ADR-050)

---

## 6. LINE OA Studio — ภาพขยายของโดเมนใหม่ (ADR-060)

```mermaid
flowchart LR
  subgraph STUDIO["line-oa-studio"]
    ACC["LineOaAccount ✔<br/>N ต่อ Business · code unique ต่อ Tenant<br/>status DRAFT→CONNECTED→PAUSED|ARCHIVED (LIVE derived)<br/>transportMode EDGE|CLOUD"]
    RM["Rich Menu (planned)"]
    FX["Flex (planned)"]
    FL["Flow + interpreter (planned)"]
    LIFF["LIFF registry (planned)"]
    TPL["Templates SYSTEM/BUSINESS (planned)"]
    DSP["Dispatch (planned)"]
    JOB["LineOaTransportJob (planned)"]
    SCH["LineOaSchedule — Studio scheduler (planned)"]
    INS["InsightSnapshot (planned)"]
  end
  CONN["integration: IntegrationConnection LINE_OA + Vault secretRef"] -->|"1:1 reference · readLineOaConnectionHealth ✔"| ACC
  BIND["agent: line_channel_binding code = channelAccountId"] -.->|"bindingStatus port (planned) → LIVE"| ACC
  CRED["identity: EdgeDeviceCredential ACTIVE?"] -->|"default transportMode ✔"| ACC
  ROLE["identity: RoleBinding LINE_OA_PUBLISHER ✔ / Business OWNER"] -->|"publish authority ✔"| ACC
  ACC -.-> RM & FX & FL & LIFF & DSP
  TPL -.-> RM & FX & FL & LIFF
  RM & LIFF & DSP & INS -.-> JOB
  DSP -.-> SCH -.-> JOB
  FL -.-> SCH
  JOB -.->|"EDGE: device claims (pull, edgk_)"| EDGEDEV["Zuri Edge Device"]
  JOB -.->|"CLOUD: worker → integration LINE port (Vault)"| PORT["integration LINE Messaging port (planned)"]
  EDGEDEV -.-> LINEAPI["LINE Messaging / Insight API"]
  PORT -.-> LINEAPI
  classDef done fill:#eaf6ec,stroke:#3f8a4d,color:#14331b
  classDef plan fill:#ffffff,stroke:#3f8a4d,stroke-dasharray:5 3,color:#14331b
  classDef ext fill:#eeeeee,stroke:#777,color:#222
  class ACC,CONN,CRED,ROLE done
  class RM,FX,FL,LIFF,TPL,DSP,JOB,SCH,INS,PORT plan
  class BIND,EDGEDEV,LINEAPI ext
```

prerequisite ที่พบ (ADR-060 D9): `Conversation` unique ที่ `(tenantId, channel, externalThreadId)` โดย thread key มาจาก `userId` — ผู้ใช้คนเดียวคุยกับสอง OA ใน tenant เดียวยุบเป็น Conversation เดียว; crm ต้องเพิ่ม `channelAccountId` เข้า identity ของ Conversation ก่อนมุมมองต่อบัญชีจะเป็นจริง

---

## 7. สถานะการสร้าง (2026-09-05)

| ส่วน | สถานะ | หลักฐาน |
|---|---|---|
| Web shell, Project Manager, intake 4 surfaces, audit, backup | สร้างแล้ว | FR-001..020, `docs/TRACE.md` |
| Identity/IAM: session, LINE linking, RBAC, plugin, edge credential | สร้างแล้ว | FEAT-010, FR-144 |
| CRM ingest + Inbox + reply receipt + consent + erasure | สร้างแล้ว | FEAT-009, FR-103, FR-022 |
| Integration substrate, Platform Integrations UI, Vault resolver | สร้างแล้ว (live Vault provisioning เป็น operator gate) | FEAT-004, FR-081 |
| Phase 1 LINE runtime (binding, canary, activation) | สร้างแล้ว; production activation ยังเป็น gate | FR-052..055 |
| Knowledge ingestion Tier 1 stage 1..8 | สร้างแล้ว; stage 9..17 อยู่ GKS/GenesisBlockDB | FEAT-013 |
| Market Intelligence, Asset Management (+ edge extraction) | สร้างแล้ว | FEAT-015..017 |
| Docker Compose + ngrok deployment, health, pooler mode | สร้างแล้ว และใช้บน production | FR-142, FR-145 |
| LINE OA Studio: `LineOaAccount` + API | สร้างแล้วใน local (migration production ยังไม่ apply) | FR-146 |
| LINE OA Studio: rich menu, flows, dispatch, jobs, scheduler, insight, pages | ประกาศแล้ว (Phase 1–4) | ADR-060 D14 |
| MSP / GKS / GenesisBlockDB integration ในเส้นทาง production | ยังไม่มี production deployment ของสาย MSP→GKS | ROADMAP PHASE-ZAI-KNOWLEDGE |
