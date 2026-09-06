# System & activity diagrams

> Current transport decision: [Server-owned LINE and optional Edge](SERVER-LINE-OPTIONAL-EDGE.md)
> implements upstream ADR-061. New runtimes are compute-only; the transport behavior below
> applies only to explicitly selected `LEGACY_EDGE` installations during migration.


Drawn from the code as it stands at `95a5f82`, not from intent. Where a diagram shows something
that does not work yet, it says so on the arrow rather than omitting it — an architecture picture
that quietly leaves out the broken edge is how the gap survives.

Every element here is traceable: ports and paths from `.env` and `src/history/webhook-server.ts`,
the answer path from `src/answer/`, the queue from `src/delivery/`, liveness from
`src/zuri-api/heartbeat.ts`.

---

## 1. Deployment and trust boundaries

The question this answers: **what can reach what, and with which credential.**

```mermaid
flowchart LR
  customer["Customer<br/>LINE app"]

  subgraph public["Public internet"]
    line["LINE Platform<br/>Messaging API"]
  end

  subgraph funnel["Tailscale Funnel — publishes ONE path"]
    fn["desktop-vetatmq.tail71c7d1.ts.net<br/>/webhook/line only"]
  end

  subgraph premise["Customer premise · DESKTOP-VETATMQ"]
    wh["webhook :8787"]
    rag["GenesisRAG service :8888"]
    emb["e5 embed sidecar :8891"]
    oll["Ollama :11434"]
    store[("GenesisBlock store<br/>exclusive lock, even readOnly")]
    obx[("Outbox<br/>state/outbox")]
    arc[("Local archive<br/>state/line-history")]
  end

  subgraph tailnet["Operator's tailnet"]
    op["Operator's other devices"]
  end

  subgraph cloud["zuri-ai cloud"]
    hb["POST /api/agent/heartbeat"]
    del["POST /api/agent/line-delivery"]
  end

  customer -->|"message"| line
  line -->|"signed event"| fn
  fn --> wh
  wh -->|"catalog lookup"| rag
  rag -->|"embed query"| emb
  rag --- store
  wh --> obx
  obx -->|"compose"| oll
  obx ==>|"push · channel token"| line
  line -->|"reply"| customer
  wh -->|"pseudonymised"| arc
  wh -->|"heartbeat 40s · edgk_ key"| hb
  obx -.->|"delivery receipt — BLOCKED, no binding"| del
  op -->|"operator key"| wh

  classDef gap stroke-dasharray: 4 4;
  class del gap;
```

**What the picture is claiming**

| Edge | Credential | Note |
| --- | --- | --- |
| LINE → webhook | LINE request signature | The only path the Funnel publishes. Everything else answers 404 from the internet |
| operator → webhook | operator key `zadm_…` | `/gui`, `/api/config`, `/api/graph`, `/api/command/dispatch`. Over the tailnet, not the internet |
| webhook → cloud | minted device key `edgk_…` | Liveness only |
| outbox → LINE | LINE channel access token | **The edge owns the send** (BR-003, retired; zuri-ai BR-011) |
| outbox → cloud | — | Dashed because it cannot run: a receipt needs the cloud's `Message.id`, which needs a server-owned LINE binding this device does not have. BR-008 |

The RAG service is a separate process for one reason: the GenesisBlock engine takes an **exclusive
lock on the store directory even when opened read-only**, so the webhook cannot open it and proxies
instead.

---

## 2. Answering a customer

The question this answers: **why the customer gets an acknowledgement before an answer.**

A LINE reply token expires in about thirty seconds. Composing an answer takes longer than that on
this hardware, so the reply token is spent immediately on an acknowledgement and the real answer
goes out later as a push. That is the whole reason the outbox exists.

```mermaid
flowchart TD
  start(["POST /webhook/line"]) --> sig{"Signature valid?"}
  sig -->|no| r401["401 — refuse"]
  sig -->|yes| ack["200 OK immediately"]
  ack --> dedupe{"Seen this<br/>webhookEventId?"}
  dedupe -->|yes| drop["Drop — LINE retries<br/>what it got no 200 for"]
  dedupe -->|no| ident{"Sender<br/>registered?"}
  ident -->|no| req["Reply: request sent to an admin<br/>record the access request"]
  ident -->|yes| ackreply["Reply on the token:<br/>ซูริรับคำถามแล้วค่ะ"]
  ackreply --> queue["Enqueue delivery intent<br/>idempotency key = hash of sender + event"]

  queue -.->|"poll 2s"| claim{"Claim<br/>lease + revision"}
  claim -->|"CONVERSATION_BUSY"| wait["Leave queued — one answer<br/>per person at a time"]
  claim -->|claimed| answer["Compose"]

  answer --> rag["GenesisRAG :8888<br/>catalog + price"]
  answer --> model["Ollama or Codex CLI"]
  rag --> guards
  model --> guards

  guards{"Guards"} -->|"figure ≥100 not in evidence"| discard["Discard the reply"]
  guards -->|"offers products no lookup returned"| discard
  discard --> fallback["Pattern reader answers instead"]
  guards -->|passes| push["Push to the customer"]
  fallback --> push

  push --> mark["Mark DELIVERED<br/>clear the raw recipient id"]
  mark --> receipt{"inboundMessageId<br/>on the record?"}
  receipt -->|yes| report["Report the receipt to the cloud"]
  receipt -->|no| note["Record why it could not be attributed"]
```

**Guards worth naming.** `unverifiedNumbers` rejects a reply containing a figure of 100 or more that
appears neither in a recorded tool result nor in the customer's own words — the failure it prevents
is an invented price. `suggestsUnseenProducts` rejects a reply that offers products when the model
made no tool call at all. Both discard the model's text and fall through to the deterministic
reader, so the customer still gets a correct if plainer answer.

**The raw recipient id** is the one identifier stored unhashed anywhere in this project, and it is
cleared the moment the record reaches a terminal state — it exists only for the seconds a delivery
is in flight.

---

## 3. Bringing the stack up

The question this answers: **why the webhook starts last.**

```mermaid
flowchart TD
  logon(["Logon — Scheduled Task ZuriEdgeStack"]) --> built{"dist/ present?"}
  built -->|no| build["npm run build via cmd<br/>PowerShell would abort on npm's stderr banner"]
  built -->|yes| ollama
  build -->|failed| stop1["Stop — nothing else can serve"]
  build --> ollama

  ollama["Wait up to 90s for Ollama"] --> ollnote["Never started here: it autostarts from<br/>the Startup folder, and a second copy<br/>would fight the first over model files"]
  ollnote --> embed{"embed :8891<br/>answering?"}

  embed -->|"already up"| ragq
  embed -->|no| startembed["Start it, wait up to 180s<br/>it loads a model"]
  startembed --> ragq{"rag :8888<br/>answering 200?"}

  ragq -->|"already up"| whq
  ragq -->|no| startrag["Start it, require a 200"]
  startrag --> ragok{"200 within 60s?"}
  ragok -->|no| degraded["Mark incomplete"]
  ragok -->|yes| whq

  whq{"Everything below<br/>came up?"} -->|no| refuse["Do NOT start the webhook.<br/>A webhook in front of a catalog<br/>that cannot answer takes<br/>messages it can only fail"]
  whq -->|yes| startwh["Start webhook :8787"]
  startwh --> beat["Heartbeat begins — from inside<br/>the listen callback, not before it"]
```

**Why the RAG probe insists on a 200 while the skip check does not.** Two different questions.
*"Is something already holding this port?"* is answered by any reply at all, including a 5xx — and
it must be, because starting a second RAG service would fight the first over the store lock.
*"Did what I just started come up?"* is not: the RAG service answers `/health` with 503 while its
store or embedder is still loading.

---

## 4. Liveness

The question this answers: **what the cloud's Edge tab is actually telling you.**

```mermaid
sequenceDiagram
    participant W as webhook serve
    participant P as probe
    participant C as zuri-ai

    Note over W: starts only once the socket is bound
    loop every 40s
        W->>P: assess
        P->>P: server.listening?
        P->>P: RAG /health 200?
        P->>P: model host reachable, if the model layer is on?
        P-->>W: healthy | degraded | unavailable
        W->>C: POST /api/agent/heartbeat (Bearer edgk_)
        Note right of W: 15s timeout, one beat at a time
        C-->>W: acknowledged
    end
    Note over C: a device is dropped from "online"<br/>after 120s without a beat
```

`healthy` requires the dependencies to answer, not merely to exist. This distinction is not
theoretical: Ollama's server process died while its tray application kept running, every answer
fell back silently to the pattern reader, and the device reported healthy throughout — which is
what a hardcoded status buys you.

`unavailable` is reserved for the webhook's own listener being down, because at that point nothing
is serving LINE at all. A missing dependency is `degraded`: the device still accepts and answers,
just less well, and calling that unavailable teaches whoever reads the tab to ignore it.

---

## 5. Changing configuration

The question this answers: **why some settings take effect on save and others do not.**

```mermaid
stateDiagram-v2
    [*] --> SignIn
    SignIn --> Page: operator key accepted
    SignIn --> SignIn: 401 — a device with no key<br/>configured refuses, it does not open
    Page --> Written: save writes .env
    Written --> Reload: re-read the file, diff against the running config

    Reload --> Applied: value is read per request<br/>or the client is rebuilt per call
    Reload --> NeedsRestart: value was captured at startup

    Applied --> Page: reported by name
    NeedsRestart --> Page: reported by name, not applied

    note right of Applied
      LINE channel secret and access token,
      group aliases, model selection
    end note

    note right of NeedsRestart
      port, bind host, history root,
      history hash key, retention,
      outbox root, cloud pairing
    end note
```

Saving used to answer `{success:true}` regardless, which was true of the file and said nothing about
the device. A token rotation where the form still held the old value wrote the same bytes back and
looked exactly like success — and did, for an hour.

`dotenv.config()` is deliberately not used for the reload. It will not overwrite a variable already
present in `process.env`, so after the first load it can only ever return what the process started
with, which is the staleness being fixed.

---

## What these diagrams do not show

- **The Studio job lane.** `LineOaTransportJob` (zuri-ai ADR-060 D5) does not exist on `main` — no
  routes, no models, contract unpublished. When it ships, Studio-initiated sends report as the job's
  own result and must **not** also use the delivery route, or the Inbox records one send twice.
- **The command console dispatch path**, which resolves a recipient against configured aliases and
  refuses anything else. It is a small enough flow that the prose in `src/line-poc/targets.ts` says
  it better than a box would.
