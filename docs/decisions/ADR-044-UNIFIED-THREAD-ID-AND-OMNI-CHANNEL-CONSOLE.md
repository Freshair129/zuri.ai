# ADR-044 — Unified Thread ID, Omni-Channel Identity & Live Command Console Architecture

**Status:** Approved  
**Date:** 2026-08-22  
**Decided by:** Boss (Owner), Lead Architect  
**Relates to:** [ADR-024](ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md), [ADR-025](ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md), [ADR-041](ADR-041-ZURI-EDGE-DEVICE-TOPOLOGY.md), [ADR-042](ADR-042-DECOUPLED-STANDALONE-KNOWLEDGE-AND-GRAPHRAG-SERVICE.md), [ADR-043](ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md)

---

## Context

As Zuri AI scales into an Omni-Channel business operations ecosystem (LINE Official Account, LINE Groups, Facebook Messenger, Instagram DM, Web Chat), interactions take place across disparate platform identifiers (`groupId`, `userId`, `roomId`, `pageScopedId`).

Without a formal **Unified Thread ID** and **Omni-Channel Identity Authority**:
1. Single users talking across different channels fracture context and duplicate CRM entities.
2. Group conversations lack clear channel-level context boundaries, risking accidental data leakage across teams.
3. Supervisors/Owners lack a single real-time console to observe live chat streams across all channels, take over conversations, or broadcast instructions using the AI Persona.

---

## Decision

### D1 — Domain Boundary Allocation (The 4-Tier Cognitive Stack)

We allocate ownership of the Omni-Channel Live Console & Unified Thread system across the 4-Tier architecture defined in ADR-043:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🏢 Tier 1: Zuri Edge Device & Live Operations Console (d:\workspace)        │
│    - Role: UI Rendering, Webhook Ingress (LINE/FB), Web Speech API          │
│    - Features: Real-time Monitor GUI, Prompt-to-Zuri Voice Dispatcher,      │
│      Manual Human Takeover, Push Broadcast Transport                        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (Session & Identity Context)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🛡️ Tier 2: MSP — Memory System Protocol (d:\msp) [PRIMARY OWNER]            │
│    - Role: Unified Thread Authority, Session Lifecycle & Channel Isolation  │
│    - Features:                                                              │
│      1. Unified Thread ID Minting: `th_grp_<uuid>` vs `th_usr_<uuid>`       │
│      2. Omni-Channel Identity Federation (LINE ID + FB ID -> Person UUID)   │
│      3. Multi-Turn Scratchpad Memory Window (H0-H4 Permission Ceilings)     │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (Verified Fact Enrichment)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🧠 Tier 3: GKS — Genesis Knowledge Service (d:\gks)                         │
│    - Role: Canonical Knowledge Authority & Entity Verification             │
│    - Features: Master Catalog 2026, Specs, Pricing Policy, Anti-Hallucination│
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (6-Lane Physical Storage)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 💾 Tier 4: GenesisBlockDB Substrate                                         │
│    - Role: Hybrid Vector + Graph + SQLite + Bitemporal History Persistence │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### D2 — Unified Thread ID & Channel Scoping Model

All conversations across all platforms are normalized into **Unified Thread Records**:

1. **Thread Scope Hierarchy:**
   - **`Group Thread (th_grp_...)`**: Scoped to a shared collaboration room (e.g. LINE Group `LINE_GROUP_TEAM`, LINE Group `LINE_GROUP_TEST`). All participant messages share a common episodic context.
   - **`Direct Thread (th_usr_...)`**: Scoped 1:1 between an external user and Zuri AI. Preserves private customer CRM state.

2. **Omni-Channel Person Resolution:**
   - External platform IDs are mapped to internal canonical `Person UUID` via HMAC-SHA256 privacy preservation:
   ```json
   {
     "threadId": "th_grp_cc7cfa4c501da9b430abc5ec09a8894ea",
     "channelType": "LINE_GROUP",
     "channelName": "SmartGift Team Ops",
     "ownerRole": "owner",
     "platformBindings": {
       "lineGroupId": "Cc7cfa4c501da9b430abc5ec09a8894ea",
       "facebookPageId": null
     },
     "activeParticipants": [
       {
         "personId": "usr_e3c52f6c9d78ae2f",
         "displayName": "PP - 4466",
         "role": "owner"
       }
     ]
   }
   ```

---

### D3 — Live Operations GUI & Prompt-to-Zuri Command Dispatcher

Tier 1 provides a unified web console accessible at `http://localhost:8787/gui` (and `/monitor`):

1. **Live Channel Monitor**: Real-time visual cards of all bound LINE Groups, Direct User chats, message counts, and active persona status.
2. **Conversation Stream**: Live message feed showing inbound customer questions, RAG evidence logs, and Zuri generated replies.
3. **Supervisor Command Dispatcher (Voice & Text)**:
   - Input: Raw human instructions (typed or spoken via microphone). Example: *"บอกกลุ่มทีมงานว่าแก้ระบบเสร็จแล้ว ให้ลองถามเรื่อง CI ใหม่"*
   - AI Tone Transformer: Converts supervisor directives into Zuri Persona (warm, polite, capable Thai business partner).
   - Instant Target Dispatch: Single-click broadcast to specified `threadId` or `channelId` via LINE Push API.

---

## Consequences

- **Clear Responsibility**: MSP (Tier 2) manages session memory and identity keys; GKS (Tier 3) manages verified facts; Tier 1 manages UI and platform ingress/egress.
- **Privacy & Security**: Factory RMB costs and sensitive pricing models remain restricted to `owner` roles (H4 ceiling); regular chat members interact as `sales` (H1 ceiling).
- **Extensibility**: When Facebook Messenger or Webchat connectors are added, they hook directly into the Unified Thread ID without changing the core business logic.
