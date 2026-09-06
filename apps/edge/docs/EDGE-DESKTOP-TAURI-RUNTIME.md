---
id: "EDGE-DESKTOP-TAURI-RUNTIME"
version: "1.0.0b"
status: "candidate"
owner: "zuri-edge-device"
scope: "Architecture, Multi-Lane Ingest Surface, Local LLM/RAG, Cron Workers and Desktop Runtime (Rust + Tauri v2)"
created_at: "2026-09-07T03:00:00+07:00,ATHER"
last_update: "2026-09-07T03:00:00+07:00,ATHER"
approval: "operational architecture and runtime guide; ADR-041, ADR-043, ADR-059, ADR-061"
---

# Zuri Edge Device — Native Desktop Runtime & Multi-Lane Intelligent Node

## 1. Vision and Architectural Mission

The **Zuri Edge Device** is the customer-premise hardware runtime and on-premise execution node for the **Zuri AI** Business Operating System. It provides zero-token local computation, secure on-premise data persistence, multi-lane intake surfaces into the Zuri Data Pipeline, and scheduled background cron workers while maintaining zero-trust synchronization with Zuri Cloud.

```mermaid
flowchart TB
    subgraph Cloud["Zuri AI Cloud (Web Console)"]
        direction TB
        ServerTransport["Server Transport & Webhooks"]
        PlanQueue["Cron & Task Lease Queue (ADR-059)"]
        SoTPipeline["Single Source of Truth (SoT) Pipeline"]
    end

    subgraph EdgeRuntime["Zuri Edge Device (Rust + Tauri v2 Node)"]
        direction TB
        
        subgraph SurfaceLanes["Multi-Lane Intake Surface"]
            LaneA["Lane A: Visual & OCR / Asset Barcode Scanner"]
            LaneB["Lane B: Files, Sheets & Product Master Ingest"]
            LaneC["Lane C: LINE Messaging & Live Conversation Feed"]
            LaneD["Lane D: Local Evidence & Snapshot Vault"]
        end

        subgraph LocalExecution["Local Compute & Worker Engines"]
            Ollama["Local LLM via Ollama (:11434)"]
            CodexHeadless["Headless Subscription Coordinator (Codex / Claude)"]
            CronWorker["Scheduled Cron & Extraction Poller"]
        end

        subgraph KnowledgeSubstrate["4-Tier Knowledge & DB Substrate (ADR-043)"]
            GenesisDB["Tier 4: GenesisBlockDB (Graph + Vector + Lexical)"]
            DuckSQLite["DuckDB & SQLite Analytics Core"]
            MSP_GKS["Tier 2/3: MSP Session & GKS Authority (Radius R0-R6)"]
        end
    end

    Cloud <==>|Outbound HTTPS / Zero-Trust Telemetry (edgk_)| EdgeRuntime
    SurfaceLanes --> SoTPipeline
    PlanQueue --> CronWorker
    LocalExecution <--> KnowledgeSubstrate
```

---

## 2. Core Capabilities Matrix

| Capability | Local Component / Engine | Operating Protocol | Boundary / Isolation |
|---|---|---|---|
| **Local LLM Execution** | Ollama (`:11434`) | HTTP REST (`/api/generate`, `/api/chat`) | 100% offline, zero internet exposure, model weights stored on local disk. |
| **Subscription Plan LLM** | Headless CLI Coordinator (`codex` / `claude`) | Sandboxed Subprocess with `--resume` | Reuses desktop subscription (ChatGPT Plus/Pro, Claude Pro) without per-token API billing. |
| **Scheduled Cron Jobs** | Edge Extraction & Batch Worker | Outbound time-boxed lease poller (ADR-059) | Claims Business-scoped tasks from Cloud, processes locally, posts candidate evidence back. |
| **Knowledge & Hybrid RAG** | GenesisBlockDB & GenesisRAG (`:8888`) | 6-Lane hybrid retrieval (Vector, Lexical, Graph, SQLite, Bitemporal, Provenance) | Entity deduplication, scoped catalog search with R0-R6 radius. |
| **Multi-Lane Data Pipeline** | Multi-Lane Ingest Surface | Streaming parser & candidate mapper | Intake for OCR scans, CSV/Excel catalog sheets, LINE chat logs, and hardware telemetry. |

---

## 3. Multi-Lane Data Pipeline Intake Surfaces

The Edge Device acts as a multi-modal gateway that feeds verified evidence into Zuri's SoT Data Pipeline (P0–P10):

### Lane A: Visual Intake & OCR Document Processing
* **Hardware Camera & Scanner**: Scans QR codes and physical asset tags (FR-133, FR-135).
* **Document OCR**: Reads invoice receipts, delivery notes, and purchase orders via local Vision sidecars before creating canonical drafts.

### Lane B: Managed Files & Catalog Spreadsheets
* **Excel / CSV Importer**: Ingests vendor product catalogs, price lists, and inventory master tables into GenesisBlock Graph DB.
* **DuckDB Analytical Processing**: Computes vector embeddings and similarity clustering locally before synchronizing taxonomy projections with Cloud.

### Lane C: Conversational Interaction & Live CRM
* **LINE Webhook & Leased Conversation Jobs**: Receives customer messages, performs real-time entity recognition, and feeds conversation threads into the unified Thread Authority (ADR-044).

### Lane D: Immutable Evidence & Local Snapshot Archive
* **Local Evidence Vault**: Stores tamper-evident raw JSONL logs, binary attachments, and cryptographic audit proofs before cloud replication.

---

## 4. Local Compute: Ollama & Headless Subscription Coordinator

### A. Local LLM via Ollama
The Edge Device communicates with Ollama running at `http://127.0.0.1:11434`:
* Compatible with `qwen2.5`, `llama3.1`, `mistral`, `gemma2`, and quantized domain models.
* Configured in `.env` via `ZURI_LOCAL_MODEL_PROVIDER=ollama` and `ZURI_LOCAL_MODEL_NAME=qwen2.5:7b`.

### B. Headless Subscription Coordinator (`codex` / `claude`)
* When configured with `ZURI_ANSWER_MODE=HEADLESS_PLAN`, the Rust desktop engine spawns the local CLI binary headlessly.
* Connects directly to the user's active session authenticated via `codex login` or `claude login`.
* Eliminates per-token cloud API costs while maintaining stateful conversation history.

---

## 5. Scheduled Background Cron & Task Leases (ADR-059)

The Edge Device continuously executes scheduled maintenance and batch processing jobs:
1. **Evidence Extraction Poller**: Polls `GET /api/edge/extraction-jobs/lease` every 10s to claim pending OCR/Vision jobs.
2. **Automated Catalog Re-indexing**: Periodically updates vector embeddings when local product masters change.
3. **Daily Business Digest**: Generates automated summaries of sales tasks, stock balances, and customer inquiries at midnight.
4. **Health & Liveness Telemetry**: Emits a 40-second heartbeat (`POST /api/agent/heartbeat`) with hardware health metrics (`edgk_` Zero-Trust credential).

---

## 6. Native Desktop Architecture (Rust + Tauri v2)

The Desktop application is structured under `apps/edge/src-tauri/`:

```
apps/edge/
├── src-tauri/
│   ├── Cargo.toml               # Tokio, Tauri v2, Reqwest, Serde, Native Plugins
│   ├── tauri.conf.json          # Window configuration, single-instance & autostart
│   ├── build.rs                 # Native resource generator
│   └── src/
│       ├── main.rs              # Desktop executable entrypoint
│       ├── lib.rs               # Plugin initialization & IPC router
│       └── commands.rs          # Pairing parser, Heartbeat sender & CLI checkers
└── public/
    └── index.html               # Sleek Zuri Heritage UI Desktop Dashboard
```

### 1-Click Drag & Drop Pairing
1. User generates and downloads `zuri-edge-pairing-*.json` from the Web Console at `/line-oa/integrations`.
2. Drops the `.json` file into the Desktop window.
3. Rust backend extracts `deviceId`, `deviceKey`, `cloudBaseUrl`, saves to OS config directory, and lights up the **ONLINE** status.

---

## 7. Distribution & Packaging

### Windows `.exe` / `.msi` Release Build
```bash
# Compile Release Binary
cargo build --manifest-path apps/edge/src-tauri/Cargo.toml --release
```
Output binary: `apps/edge/src-tauri/target/release/zuri-edge-device.exe`

### Global npm CLI
```bash
npm install -g @zuri/edge
npx @zuri/edge start
```
