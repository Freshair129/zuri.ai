# SmartGift Catalog Graph v4 — Design Spec

**Status:** v2 — reviewed (5-lens adversarial review 2026-08-23, 73 findings triaged), awaiting Boss approval
**Date:** 2026-08-23
**Owner:** Boss (etohcolsgroup@gmail.com)

**Repos / worktrees** (main repo is `D:\workspace\zuri-cli`; both dirs below are linked worktrees of it):
- `D:\workspace\zuri-edge-device` — branch `master`: this spec. `data/` ที่นี่เป็น working folder **untracked** (175 MB) ไม่อยู่ใน git
- `D:\workspace\zuri-edge-catalog-p4` — branch `feat/local-llm-swap`: LINE agent runtime, `src/rag/*`, `src/answer/*`. **โค้ด v4 ทั้งหมดเขียนที่นี่** บน branch ใหม่ `feat/catalog-graph-v4`
- `D:\workspace\zuri-rag-service` — HTTP facade :8888 (Windows native เท่านั้น ดู §5.10)
- GenesisBlock engine `G:\GenesisBlock_Dev\GenesisBlock` (`@freshair129/gks-genesis-block-native` 0.2.0)

ก่อน P0: รัน `git worktree repair D:/workspace/zuri-edge-device` (registration ปัจจุบันชื่อ `zuri-edge-llm` และถูก flag prunable)

---

## 1. ปัญหา (Problem Statement)

### 1.1 อาการที่ลูกค้าเห็นใน LINE OA

จาก log จริง `state/line-chat/*.json` (2026-08-21 → 22):

| ลูกค้าถาม | สิ่งที่เกิดจริง | ผล |
|---|---|---|
| "ของขวัญดูดี **ไม่ใช่แก้ว** งบ 200 บาท" (4 ครั้ง) | 2/4 ครั้ง RAG inject `TED0662 แก้วกาแฟ พร้อม ปืนนวด` เข้า prompt (1 ครั้งไม่มีราคา); 2/4 ครั้งไม่ได้ evidence เลย บอทตอบ "ตอบคำถามนี้ไม่ได้" | ส่ง **แก้ว** ให้คนที่บอกว่าไม่เอาแก้ว หรือไม่ตอบ |
| "แก้วน้ำมีกี่สี" | สีอยู่ใน description free-text | ตอบสีไม่ได้ |
| "สินค้าเกี่ยวกับแก้วน้ำมีตัวไหนบ้าง" (2026-08-21) | บอทปฏิเสธ; ถ้า tool ทำงานจะได้ `searchByName` ≤ 8 เซ็ตชื่อซ้ำ (limit=8) | ลูกค้าไม่เห็น "แก้วรุ่น A/B/C" |

### 1.2 สาเหตุราก (ตรวจพบจริง)

| # | สาเหตุ | หลักฐาน |
|---|---|---|
| R1 | **ไม่มี vector ใน GenesisBlock** — ทุก path เป็น substring | `vec_default.bin` = 0 byte ทั้ง 3 store; `zuri-rag-service/src/server.ts:82-130` filter JSON + `score: 0.98` คงที่; `src/rag/genesis-rag.ts:175-220 searchProducts()` filter `families` ด้วย `includes`; `src/answer/tools.ts:202 searchProducts` → `searchByName` |
| R2 | **จุด inject สินค้าเข้า LLM อยู่ที่ `src/cli/index.ts:671-680`** (`answer` callback ต่อ `ragContext` เข้า user text ก่อนเรียก `answerConversation`) ไม่ใช่ tool `search_products` | โค้ดอ้างอิง; นี่คือตัวที่ทำให้เกิดแถว 1 ใน §1.1 |
| R3 | **ข้อมูลแบน 1 ชั้น** — ทุก row คือ "เซ็ต" ไม่มี Family / Model / Variant / SKU | store `genesis_smartgift_store`: Product 994 แบน; `taxonomy_v3`: "ProductFamily" 753/845 ตัวคือกลุ่ม **เซ็ต** ตาม component signature; Variant `attributes = null` ทุกตัว |
| R4 | **ไม่มีราคาขาย / MOQ / lead time ใน graph** | Offer มีแค่ `rmb` (ต้นทุน); `moq`/`tiers`/`leadDays` ว่าง 100% ใน `catalog-2026.json`; tools `quote_price`/`find_within_budget` ใช้ rmb × markup จาก `src/pricing/` |
| R5 | **Decomposition ระดับ atomic มีแล้วแต่ไม่ได้เข้า graph** | `data/catalog_identity_review_user_logic_v1/identity-review.json`: ProductMaster 427, PhysicalVariant 1,128 (colors 1,043 / sizes 535 / materials 358), ComponentLink 3,170 |
| R6 | **ราคาขายจริงอยู่ใน FlowAccount แต่ยังไม่ link** | `บริษัท เทราบิส จำกัด_product.xlsx` (export 2026-06-21): Gift Set 703 row = 568 มีรหัส (`TBY01(P-14)-100` = เซ็ต × กลุ่มใบราคา × ขั้นจำนวน, 12 ใน 554 ที่ parse ได้มี UnitPrice 0) + 135 ไม่มีรหัส; base code 119 ตัว match catalog 66 |
| R7 | **ไม่มี SKU ระดับชิ้น** ในทุกแหล่ง | รหัสทั้งหมดเป็นรหัสเซ็ตหรือ price line |

### 1.3 ความต้องการธุรกิจ (brief ของ Boss) → สถานะใน spec นี้

| # | ความต้องการ | รอบนี้ |
|---|---|---|
| 1 | เก็บสินค้าและ SKU ทั้งหมดในฐานข้อมูลกลาง | ✅ §5.2 |
| 2 | จัดกลุ่ม หมวดใหญ่ → Family → Model → Variant | ✅ §5.1 ตาราง 5 ชั้น |
| 3 | Catalog/LINE แสดงระดับ Family/Model ไม่ใช่ทุก SKU | ✅ AC-C1, AC-D2 |
| 4 | เลือกสี/ขนาด → resolve SKU; **เลือกโลโก้** | ✅ สี/ขนาด (AC-C2); โลโก้: แนบ `customizations[]` บน Offer เท่านั้น (AC-C6) — resolve option → SKU **เลื่อนไป SP3** (ไม่มีข้อมูลราคาต่อ option) |
| 5 | สินค้าเดียวกันขายได้ทั้งชิ้นและเซ็ต | ✅ edge `SINGLE_OF` + AC-A8 |
| 6 | Gift Set = Offer แยกจาก Product ประกอบจาก SKU หลายตัว | ✅ `CONTAINS` |
| 7 | Collection/Campaign ไม่ใช่หมวดสินค้า | ⏭ SP3 |
| 8 | ราคา / กล่อง / MOQ / lead time เป็น Commercial rules | **บางส่วน**: ราคาตามขั้นจำนวนผ่าน CommercialSKU เท่านั้น; MOQ / lead time / กล่องจริง ⏭ SP4 (ไม่มี source data) |

---

## 2. Goal

> **G0.** ลูกค้าถามหาของขวัญใน LINE OA เป็นภาษาคน แล้วซูริตอบด้วย **สินค้าระดับ Model/Offer ที่ตรงเงื่อนไข** พร้อม **ตัวเลือกสี/ขนาด** และ **ราคาขายจริงตามจำนวน** โดยข้อมูลทุกชิ้นมาจาก GenesisBlock graph v4 ที่ตรวจสอบย้อนกลับถึงแหล่งได้

| Goal | ตัวชี้วัด (นิยามใน §8.3) | Baseline | Target |
|---|---|---|---|
| G1 ค้นหาเชิงความหมาย | `RECALL_AT_5` บน `QS_NL_AUTHORED_v1` | วัดใน P0 (§8.4) | ≥ 0.80 |
| G2 เคารพ negative constraint | `NEG_CONSTRAINT_PASS` (non-vacuous) | วัดใน P0 | 1.00 |
| G3 ตอบระดับ Model/Offer ไม่ซ้ำ | `DUPLICATE_RESULT_RATE` | วัดใน P0 | 0 |
| G4 ตอบราคาได้ | `PRICE_COVERAGE` (graph-level) | 0 | ≥ 0.85 (denominator 216 bases) |
| G5 ตอบ variant ได้ | `VARIANT_COVERAGE` (graph-level) | 0 | ≥ 0.85 (คาด 384/427 = 0.90) |
| G6 Traceability | `TRACE_COVERAGE` | — | 1.00 |
| G7 Latency | `LATENCY_P95_MS` end-to-end รวม embed | — | ≤ 800 |

---

## 3. Acceptance Criteria

ทุกข้อต้องมี automated test (§7) หรือ measurement (§8) ที่พิสูจน์ได้

### AC-A Schema & Ingest
- **AC-A1** `npm run catalog:ingest-v4` สร้าง store ที่มี node counts **เท่ากับค่าที่ `build-graph` คำนวณจาก input** และค่าคาดจาก input ปัจจุบัน (test fixture = input จริง) คือ: CategoryGroup 4, ProductType **32** (+ 1 sentinel `TYPE_unclassified` ที่ไม่นับเป็น ProductType), ProductModel 427, PhysicalVariant 1,128, PhysicalSKU 1,128 (`kind=product`) + 1 (`kind=packaging`), CatalogOffer 1,016 + **91** (`origin=flowaccount_only`: base code จาก ProductCode + ชื่อ รวม 216 ตัว อยู่ใน catalog 125 — วัดจริง 2026-08-23), CommercialSKU **554 + 102** (ดู AC-A6), CustomizationOption 3
- **AC-A2** manifest บันทึก sha256 ของ input **5 ไฟล์**: identity-review.json, flowaccount-product-2026-06-21.xlsx, catalog-2026.json, category-group-map.v1.json, product-type-aliases.v1.json (taxonomy_v3 **ไม่** hash — ไม่ใช่ input); รันซ้ำ input เดิม → node/edge id set เท่าเดิม
- **AC-A3** hash เปลี่ยน ≥ 1 ไฟล์ → `decision: reingest`; ไม่เปลี่ยน → `decision: skip` ไม่เรียก bulkAdd
- **AC-A4** ทุก `typeId` ที่ปรากฏใน identity-review (32) มีใน category-group-map; ขาด → ingest fail ระบุชื่อ type
- **AC-A5** ทุก node มี `sourceRef {file, sha256, rowKey}`; ฟิลด์ `status` คัดลอกจาก identity-review **ตามตัวอักษร** (`auto` / `review_required` / `unclassified` / `candidate`) ไม่ถูก override; การ resolve type เก็บแยกใน edge `IN_TYPE.source`
- **AC-A6** FlowAccount: ประชากร = row active ทั้งหมด 1,317 แบ่งเป็น buckets ที่ผลรวมเท่ากับ 1,317: `parsed` 554 (Gift Set + ProductCode match → CommercialSKU), `name_coded` 102 (Gift Set ไม่มี ProductCode แต่ชื่อลงท้าย `<code>(P-xx)` → CommercialSKU qtyTier = null), `unparsed` 14 (Gift Set มี ProductCode แต่ regex ไม่ match → review), `non_giftset` 4 (มี ProductCode แต่ category อื่น: 2 match / 2 ไม่ match → review), `blank` 643 (ไม่มีรหัสทั้ง 2 ทาง: Gift Set 33 [14 มีราคา → review] + อื่น 610) — 554+102+14+4+643 = 1,317; อีก 2 row `inactive` อยู่นอกประชากร; ทุก bucket เขียนลง `review/flowaccount-buckets.jsonl`; **ห้าม** drop เงียบ
- **AC-A7** `vec_default` ไม่ใช้; collection **`e5_v4`** (dim 384, metric `cosine`) มี vector = ProductModel 427 + CatalogOffer (1,016 + 91 = 1,107); ProductType **ไม่** embed
- **AC-A8** CatalogOffer ที่ `offerKind = single` (30) มี edge `SINGLE_OF` → ProductModel; Model นั้นปรากฏใน ≥ 1 `CONTAINS` ของ Offer set ด้วย ≥ 1 กรณี (พิสูจน์ "ขายได้ทั้งชิ้นและเซ็ต")

### AC-B PhysicalSKU (เฉพาะ `kind = product`)
- **AC-B1** stable id = `SKU_` + sha1(`productId|physicalVariantId`)[:20]; input เดิม → id เดิม
- **AC-B2** display code ตามกฎ §5.4 ยาว ≤ 40 ตัวอักษร **เสมอ** (มี truncation ในกฎ); variant เดียว → `-STD`; ชน → `-2`, `-3` เรียงตาม physicalVariantId
- **AC-B3** เปลี่ยน englishName ของ Model → stable id และ edge set (`HAS_VARIANT`, `HAS_SKU`, `CONTAINS`) เท่าเดิม; display code เปลี่ยนได้
- Packaging SKU ใช้ id คงที่ `SKU_PKG_GIFTBOX_STD` (seed string `packaging|giftbox|std`) ไม่อยู่ใต้ AC-B1

### AC-C Serving (`zuri-rag-service`)
- **AC-C1** `POST /api/rag/search {query, limit}` คืน `results[]` ที่ `kind ∈ {model, offer}` เท่านั้น; `score` = ค่าจาก engine (`1 − L2`) แปลงเป็น cosine client-side (`cos = 1 − d²/2`) และ 2 hits คนละ similarity ต้องได้ score ต่างกัน
- **AC-C2** result แนบ `variants[] {skuId, displayCode, color, size, material}`, `priceLadder[] {qtyTier, unitPrice, commercialSku, priceMissing}`, `selectedPrice {qtyTier, unitPrice, belowMoq, source: 'offer'|'via_offer'|null}`, `components[] {modelId, name, typeId, qty}` (Offer), `customizations[] {id, name_th}` (Offer)
- **AC-C3** negative term → `parsed.excludeTypes[]`; result ที่ `typeId` (Model) หรือ `componentTypeIds[]` (Offer, denormalized) ตัดกับ excludeTypes ถูกตัดออก **ก่อน** truncate; ถ้าหลังตัดเหลือ < limit ให้ re-query `k × 4` หนึ่งครั้ง
- **AC-C4** `qty` → selectedPrice tier = max(qtyTier ≤ qty) ; qty < tier ต่ำสุด → tier ต่ำสุด + `belowMoq: true`; ไม่ระบุ qty → tier ต่ำสุด. `budget` = **ต่อหน่วย** เสมอ (ข้อความ "งบ 20,000 สำหรับ 100 คน" → budget = 200 ต่อหน่วยโดย parser หารให้เมื่อมี qty); result ที่ `selectedPrice.unitPrice > budget` ถูกตัด; Model ที่ไม่มีราคา (`selectedPrice: null`) **คงไว้**
- **AC-C5** budget ตัดหมด → `results: []`, `parsed.budgetUnmet: true`, `nearest[]` = top-3 ตาม semantic เรียง unitPrice ขึ้น; **ไม่** คืน 200 ว่างเปล่าแบบไม่มีเหตุผล
- **AC-C6** DB / embed sidecar ไม่พร้อม → HTTP 503 `{success:false, error:'rag_unavailable', detail}`; **ห้าม** fallback substring
- **AC-C7** Model result ได้ `priceLadder` จาก union ของ CommercialSKU ของ Offer ทุกตัวที่ `CONTAINS` SKU ของ Model นั้น (`selectedPrice.source = 'via_offer'`) หรือจาก `SINGLE_OF` offer (`source = 'offer'`); ไม่มีทั้งคู่ → `null`

### AC-D LINE OA Integration (branch `feat/local-llm-swap`)
- **AC-D1** `src/cli/index.ts` `answer` callback **ไม่** ต่อ `ragContext` เข้า text อีก; product evidence เข้า LLM ทาง tool `search_products` เท่านั้น (llm.ts + `src/mcp/pricing-server.ts`) ซึ่งเรียก `GenesisLocalRag.searchProducts()` → **HTTP :8888 เท่านั้น** (ไม่เปิด store natively — ลบ `GenesisDatabase.open` ใน genesis-rag.ts ออกจาก path นี้)
- **AC-D2** payload ที่ส่งให้ card/text formatter (deterministic, ก่อนถึง LLM) มี ≤ 5 รายการ แต่ละรายการมี `name`, `colors[]`, `selectedPrice` ที่ `qtyTier == parsed.qty` หรือ tier ต่ำสุด; ทดสอบด้วย stubbed LLM
- **AC-D3** replay 17 user turn จาก `state/line-chat` ผ่าน `answer` callback จริง (fake HTTP search บน fixture v4 50 รายการ): (a) 4× "ไม่ใช่แก้ว" → evidence ไม่มี `typeId/componentTypeIds ∋ drinkware` **และ** query เดียวกันตัด "ไม่ใช่แก้ว" ออกต้องได้ drinkware ≥ 1 (positive control); (b) "แก้วน้ำมีกี่สี" → evidence มี `variants[].color` ≥ 1
- **AC-D4** static guard test: `src/answer/**`, `src/cli/index.ts`, `src/rag/genesis-rag.ts` ไม่ import `gks-genesis-block-native`, ไม่มี string `executeHql`/`hybridSearch`; `searchProducts` ไม่เรียก `GenesisDatabase.open` (สอดคล้อง ADR-RAG-002: ไม่ authorize HQL ผ่าน agent; ADR-003: delivery ผ่าน Zuri เท่านั้น)
- **AC-D5** tools `quote_price` และ `find_within_budget` ถูก rewire ไป `/api/rag/price` และ `/api/rag/search` (budget) ตามลำดับ; ไม่ใช้ `src/pricing/` rmb-markup สำหรับรหัสที่มี CommercialSKU; รหัสที่ไม่มี → คืน `{priceSource:'estimate_rmb'}` ชัดเจน
- **AC-D6** fetch error / timeout 3 s / non-2xx → `SearchEvidenceV4 {unavailable:true, reason}` ไม่ใช่ `[]`; persona rule (ใน `.agents/zuri-01/AGENTS.md`) ตอบ "ระบบค้นหาสินค้าขัดข้องชั่วคราว" ไม่แต่งรหัสสินค้า
- **AC-D7** Flex `modelCard` เป็น **preview-only** ในรอบนี้ (ตรวจด้วย `zuri-agent preview` + validator); DM ตอบ text ตามเดิม; ส่ง Flex จริงต้องผ่าน delivery intent (ADR-003) → SP3

### AC-E Measurement
- **AC-E1** `npm run catalog:eval-v4` → `data/catalog_eval_v4/<runId>/{manifest,queries.jsonl,results.jsonl,metrics.jsonl,errors.jsonl,environment-manifest.json}` schema เดียวกับ round1
- **AC-E2** metrics ครบตาม §8.3 ทั้ง 9 ตัว
- **AC-E3** ทุก target ใน §2 ผ่านก่อน merge; regression `QS_OFFER_SELF_v1` (restricted) ≥ 0.86

---

## 4. แหล่งข้อมูล (Inputs)

ทุก input ใหญ่อยู่ใต้ `ZURI_DATA_ROOT` (env, default `D:/workspace/zuri-edge-device/data`); config ที่เขียนมือ **อยู่ใน git** ที่ `src/rag/v4/config/`

| Input | Path | ใช้สร้าง |
|---|---|---|
| identity-review (user-logic v1) | `$ZURI_DATA_ROOT/catalog_identity_review_user_logic_v1/identity-review.json` | ProductModel 427 (status: review_required 336 / unclassified 49 / auto 42), PhysicalVariant 1,128 (review_required 1,078 / candidate 50), CatalogOffer 1,016 (set 986 / single 30), ComponentLink 3,170, AttributeValue 198, CustomizationProfile 1 |
| catalog-2026.json | คัดลอกจาก Downloads → `$ZURI_DATA_ROOT/source/catalog-2026.json` | name_th, description, `image`, branding ของ 994 offer; join รหัส **case-insensitive** (6 รหัสต่างแค่ตัวพิมพ์); 28 offer ไม่มีใน catalog → fallback englishName จาก identity-review, image null |
| FlowAccount product export | คัดลอก → `$ZURI_DATA_ROOT/source/flowaccount-product-2026-06-21.xlsx` | CommercialSKU + flowaccount_only offers (§5.5) |
| `src/rag/v4/config/category-group-map.v1.json` | ใหม่ (git) | ProductType 32 → CategoryGroup 4 |
| `src/rag/v4/config/product-type-aliases.v1.json` | ใหม่ (git), seed จาก `taxonomy-serving.ts` alias + ชื่อไทย | name_th/name_en/aliases_th[]/aliases_en[] ต่อ type ใช้ใน negative-constraint parser และ embed text |
| taxonomy_v3 store | read-only อ้างอิง | ไม่ใช่ input ของ ingest |

### 4.1 ตัวเลข "2,055 SKU / 703 เซ็ต"
703 = row `Category = Gift Set` ใน FlowAccount ✔; 2,055 ไม่ตรงกับไฟล์ใดที่พบ — spec ยึดตัวเลขจากไฟล์จริง

### 4.2 รหัส `P-xx`
ค้นใบราคา PDF 38 ไฟล์ + Quotation + BillingNote แล้ว **ไม่มีนิยาม**; ใบราคาแสดง `TBY01` เฉยๆ จัดกลุ่มตาม base code (รวม unparsed): P-02 = เซ็ตนวดคอ 41, P-06 = Notebook Powerbank 14, P-PT = Trophy light 14, P-09 = สินค้าเดี่ยว 10 → สัมพันธ์กับ **กลุ่มใบราคา** ไม่ใช่แบบกล่อง → เก็บเป็น `priceListGroup` (Open Q1)

---

## 5. Design

### 5.1 ตาราง 5 ชั้น (นิยามคำให้ตรงกัน)

| ชั้นตาม brief | Node v4 | ตัวอย่าง | หมายเหตุ |
|---|---|---|---|
| Category / Master Product | `CategoryGroup` (4) | Care & Wellness | |
| **Product Family** | `ProductType` (32) | power_bank, drinkware | **"ProductFamily" เดิมใน taxonomy_v3 / genesis-rag.ts (= กลุ่มเซ็ต) เลิกใช้ความหมายนั้น** |
| Product Model | `ProductModel` (427) | Notebook Powerbank, T30 Solar | |
| Variant | `PhysicalVariant` (1,128) | Black / 500 ml / SUS304 | |
| SKU | `PhysicalSKU` (1,129) | `SKU-NOTEBOOK-NOTEBOOK-POW-BLK-A5` | หน่วยตัดสต็อก (ยังไม่มีสต็อกจริง) |
| Gift Set / Offer | `CatalogOffer` (1,107) | TGC06-4 | ประกอบจาก SKU; 91 ตัวมาจาก FlowAccount อย่างเดียว |
| Price line | `CommercialSKU` (656) | `TBY01(P-14)-100` = 490 ฿ | FlowAccount |

```
 identity-review ─┐
 FlowAccount.xlsx ┤→ ingest-v4 (p4 worktree): parse → build-graph (pure) → embed (sidecar) → bulkAdd → manifest
 catalog-2026    ─┤                                   │
 config/*.json   ─┘                                   ▼
                               $ZURI_DATA_ROOT/genesis_smartgift_store_v4/<runId>/  +  CURRENT (pointer file)
                                                      ▲ (exclusive lock: 1 process)
 zuri-rag-service :8888 ── opens CURRENT at startup ──┘     embed-sidecar :8891 (e5-small, CPU, pinned rev)
   POST /api/rag/search, /api/rag/price, GET /health {dbReady, embedReady, storePath}
         ▲ HTTP only
 LINE agent (feat/local-llm-swap): tool search_products / quote_price / find_within_budget → GenesisLocalRag (HTTP client)
```

### 5.2 Node types

| Label | จำนวน | id | props หลัก |
|---|---|---|---|
| `CategoryGroup` | 4 | `CATGROUP_<slug>` | name_th, name_en, order |
| `ProductType` | 32 | `TYPE_<typeId>` | typeId, name_th, name_en, aliases_th[], aliases_en[], groupId |
| `TYPE_unclassified` | 1 sentinel | `TYPE_unclassified` | ไม่ใช่ ProductType (label `TypeSentinel`), ไม่ embed, ไม่อยู่ใน map |
| `ProductModel` | 427 | `PRODUCT_…` (คงเดิม) | displayName, englishName, **typeId** (denormalized), status, baseSignature, sourceRef |
| `PhysicalVariant` | 1,128 | `PHYSICAL_VARIANT_…` | colors[], sizes[], materials[], status, sourceRef |
| `PhysicalSKU` | 1,129 | §5.4 | displayCode, modelId, variantId, kind, sourceRef |
| `CatalogOffer` | 1,107 | `OFFER_<code-upper>` | code, name_th, name_en, description, image, offerKind, rmb, branding[], status, origin `catalog`\|`flowaccount_only`, **componentTypeIds[]** (denormalized, ไม่รวม packaging), sourceRef |
| `CommercialSKU` | 656 | `CSKU_<sha1(code or base|rowIndex)[:20]>` | flowAccountCode (null ถ้า name_coded), offerCode, priceListGroup, qtyTier (int\|null), unitPrice, unitPriceWithVat, priceMissing, flowAccountName, exportDate `2026-06-21`, sourceRef |
| `CustomizationOption` | 3 | `CUSTOM_<slug>` | name_th |
| `AttributeValue` | 198 | คงเดิม | attributeType, value |

### 5.3 Edges

| Edge | from → to | props |
|---|---|---|
| `IN_GROUP` | ProductType → CategoryGroup | — |
| `IN_TYPE` | ProductModel → ProductType \| TYPE_unclassified | source: `identity_review.typeId` \| `component_role` \| `none` |
| `HAS_VARIANT` | ProductModel → PhysicalVariant | — |
| `HAS_SKU` | PhysicalVariant → PhysicalSKU | — |
| `HAS_ATTRIBUTE` | PhysicalVariant → AttributeValue | — |
| `CONTAINS` | CatalogOffer → PhysicalSKU | qty, position, role, componentLinkId |
| `PRICED_AS` | CatalogOffer → CommercialSKU | — |
| `CUSTOMIZABLE_WITH` | CatalogOffer → CustomizationOption | จาก `branding[]` ของ catalog-2026 (map: สกรีนโลโก้→screen, เลเซอร์โลโก้→laser, การ์ดข้อความ→card) |
| `SINGLE_OF` | CatalogOffer(single) → ProductModel | — |

กฎ type ของ Model: ใช้ `productMasters[].typeId` ก่อน; ไม่มี → `componentLinks[].role` ที่พบบ่อยสุดของ Model นั้น; ไม่มี → `TYPE_unclassified` (`status` ของ node ไม่ถูกแก้)

ร่าง `category-group-map.v1.json` (Boss ยืนยัน — Open Q2):

| CategoryGroup | ProductType (32) |
|---|---|
| `smart_tech` | power_bank, usb_flash_drive, charger, speaker, earbuds, **earphone**, headset, mouse, keyboard, smart_bracelet, car_accessory |
| `care_wellness` | neck_massager, massage_gun, massage_comb, hair_dryer, humidifier, fan, glove, towel, **nail_clipper** |
| `office` | notebook, notebook_refill, pen, bookmark, name_card_holder, briefcase, key_chain, **lighter** |
| `home_travel` | drinkware, coffee_maker, umbrella, bag |

### 5.4 กฎ PhysicalSKU

```
slug(s)     = uppercase(ASCII) → แทน [^A-Z0-9]+ ด้วย "-" → ตัด "-" หัวท้าย
cut(tok, n) = tok[:n] แล้วตัด "-" ท้ายออก
stableId    = "SKU_" + sha1(productId + "|" + physicalVariantId).hex[:20]
typeTok     = cut(slug(typeId), 10)          (typeId เปล่า ไม่ใช่ "TYPE_…"; unclassified → "UNCL")
modelTok    = cut(slug(englishName), 12)     ; slug ว่าง (ชื่อไทยล้วน) → productId.split("_")[1][:6]
variantTok  = cut(join("-", [colorTok, sizeTok, materialTok].filter(Boolean)), 12) || "STD"
  colorTok  = COLOR_ABBR[colors[0] lower] || slug(colors[0])[:3] ; colors.length > 1 → + "-MC"
  sizeTok   = cut(slug(sizes[0]) ตัดหน่วย CM/ML/MM ออก, 5)   (A5, 500, 350)
  materialTok = MATERIAL_ABBR[materials[0] lower] || slug(materials[0])[:4]   (sus304→S304, stainless steel→SS)
base        = "SKU-" + typeTok + "-" + modelTok + "-" + variantTok
ถ้า len(base) > 36 → ลด modelTok เป็น cut(modelTok, 12 − (len(base) − 36)) แล้วประกอบใหม่ (variantTok ไม่ถูกตัด) → len(base) ≤ 36
collision   = base ซ้ำ → ต่อ "-2", "-3" … "-99" เรียงตาม physicalVariantId (≤ 3 ตัวอักษร) ; ตัวซ้ำลำดับ ≥ 100 → ลด base เหลือ 35 แล้วต่อ "-" + stableId[4:8] (5 ตัวอักษร)
displayCode = base + suffix ; ความยาวรวม ≤ 40 เสมอ (36+3 หรือ 35+5)
```
ตัวอย่างคำนวณ: notebook + "Notebook Powerbank" + Black/A5 → `SKU-NOTEBOOK-NOTEBOOK-POW-BLK-A5` (32); drinkware + "Vacuum flask" + Black/500ml/SUS304 → base 39 > 36 → modelTok = cut("VACUUM-FLASK", 9) = "VACUUM-FL" → `SKU-DRINKWARE-VACUUM-FL-BLK-500-S304` (36)
`COLOR_ABBR`: black→BLK, white→WHT, blue→BLU, red→RED, green→GRN, gray/grey→GRY, gold→GLD, silver→SLV, pink→PNK, orange→ORG, beige→BGE, navy→NVY, brown→BRN, purple→PUR, yellow→YEL — ตารางอยู่ใน `sku.ts` และ test 7.1 อ้างตารางนี้

Packaging SKU: `SKU_PKG_GIFTBOX_STD` kind=`packaging`, `CONTAINS` จาก Offer ทุกตัวที่ `branding[]` ไม่ว่าง — placeholder จนกว่าจะมีข้อมูลกล่องจริง (SP4)

### 5.5 FlowAccount parser (`flowaccount.ts`, ใช้ `exceljs`)

```
CODE_RX = ^(?<base>[A-Z]{2,4}\d{1,4}(?:-\d)?)\s*(?:\((?<group>P-[^)]+)\))?\s*-?\s*(?<qty>\d+)?\s*$
NAME_RX = (?<base>[A-Z]{2,4}\d{1,4}(?:-\d)?)\s*(?:\((?<group>P-[^)]+)\)?)?\s*$     (ท้ายชื่อ)
```
ลำดับต่อ row (active เท่านั้น):
1. ProductCode match `CODE_RX` → bucket `parsed` (Gift Set) / `non_giftset`
2. ProductCode มีแต่ไม่ match → `unparsed` (reason `regex`) — 14
3. ProductCode ว่าง + Category Gift Set + Name ท้ายด้วย `NAME_RX` → `name_coded` (qtyTier null, flowAccountCode null) — 102
4. อื่น → `blank` (reason `no_code`) — 643 (รวม 14 Gift Set ที่มีราคาแต่ไม่มีรหัส → log เป็น review); ProductCode มีแต่ category ≠ Gift Set → `non_giftset` — 4
- `UnitPrice = 0` → `priceMissing: true`
- base ไม่อยู่ใน 1,016 offer (case-insensitive) → CatalogOffer `origin: flowaccount_only` ชื่อจาก FlowAccount Name (ตัดรหัสท้ายออก)

### 5.6 Embedding

- Model `intfloat/multilingual-e5-small` revision `614241f622f53c4eeff9890bdc4f31cfecc418b3`, float32, CPU, max_seq 512 (pin ตาม Q5)
- **Sidecar Python FastAPI** `scripts/embed-sidecar.py` port **8891** (env `EMBED_URL`), endpoints `POST /embed {texts[], kind:'query'|'passage'}` → `{vectors[][], model, revision}`, `GET /health`; reuse loader จาก `run-catalog-vector-benchmark.py`; `start-rag-service.bat` เริ่ม sidecar ก่อน service และ service `/health.embedReady` probe sidecar
- Collection: `createCollection('e5_v4', 'intfloat/multilingual-e5-small', 384, 'cosine')`; ค้นด้วย `collection: 'e5_v4'`; score แปลงเป็น cosine client-side
- Text contract `e5_v4`:
  - ProductModel: `passage: <type name_th> | <displayName> | <englishName> | สี: <colors ของทุก variant, unique, ≤ 10> | <baseSignature[:200]>`
  - CatalogOffer: `passage: ชุดของขวัญ | <name_th> | <name_en> | ประกอบด้วย: <component type name_th list> | <description[:200]>`
  - Query: `query: <cleanText>`
- **ไม่** embed ProductType / SKU / Variant / CommercialSKU

### 5.7 Query pipeline (`search.ts`, pure over `{hybridSearch, neighbors}` interface)

1. `parseQuery(text)` → `{cleanText, excludeTypes[], qty?, budgetPerUnit?, budgetTotal?}` — rule-based ด้วย `product-type-aliases`: `ไม่ใช่|ไม่เอา|ยกเว้น|ไม่รวม <alias>` → excludeTypes; `<n> (ชิ้น|ชุด|อัน|คน)` → qty; `งบ|ไม่เกิน|budget <n>` → budget; ถ้ามีทั้ง budget และ qty และ budget ≥ 20 × qty → ตีความเป็น budgetTotal แล้ว budgetPerUnit = total / qty
2. embed `query: cleanText` (sidecar)
3. `hybridSearch({queryVector, k: 40, alpha: 0, collection: 'e5_v4'})` — alpha 0 = pure similarity (alpha คือ น้ำหนัก graph impact ไม่ใช่ lexical mix; ablation alpha ∈ {0, 0.2} รายงานใน §8)
4. filter label ∈ {ProductModel, CatalogOffer}; ตัด hit ที่ `props.typeId ∈ exclude` หรือ `props.componentTypeIds ∩ exclude ≠ ∅` (ใช้ props ที่ denormalize ตอน ingest — ไม่ต้อง traverse); เหลือ < limit → re-query k=160 หนึ่งครั้ง
5. expand ด้วย `neighbors(seed, {rels, direction, depth:1})` ทีละ hop:
   - Model → `HAS_VARIANT` out → `HAS_SKU` out
   - Model → `HAS_SKU`⁻¹/`CONTAINS` in → Offer → `PRICED_AS` out (สำหรับ AC-C7) ; Model → `SINGLE_OF` in → Offer → `PRICED_AS`
   - Offer → `CONTAINS` out → SKU → `HAS_SKU` in → Variant → `HAS_VARIANT` in → Model ; Offer → `PRICED_AS`, `CUSTOMIZABLE_WITH` out
6. price: selectedPrice ตาม AC-C4/C7; budget filter; Model ไม่มีราคาคงไว้
7. dedupe ตาม id; ถ้า budget ตัดหมด → AC-C5 `nearest[]`; คืน top `limit` (default 5)
8. engine/sidecar error → throw `RagUnavailableError` → 503

`/api/rag/price {code, qty}` → priceLadder + selectedPrice ของ Offer เดียว (สำหรับ `quote_price`)

Response shape (`search.ts` export type `SearchResponseV4`; `SearchEvidenceV4` ใน LINE agent = subset เดียวกัน + `unavailable?`):
```json
{ "success": true, "query": "...", "parsed": {"excludeTypes":["drinkware"],"qty":null,"budgetPerUnit":200,"budgetUnmet":false},
  "results": [{
    "kind": "offer", "id": "OFFER_TBY01", "code": "TBY01", "name": "เครื่องนวดคอ", "englishName": "Neck massager",
    "type": {"id":"neck_massager","name_th":"เครื่องนวดคอ"}, "group": {"id":"care_wellness"},
    "score": 0.83, "status": "auto", "image": null,
    "variants": [{"skuId":"SKU_…","displayCode":"SKU-NECK-MASS-NECKMASSAGER-WHT","color":"White","size":null,"material":null}],
    "priceLadder": [{"qtyTier":10,"unitPrice":690,"commercialSku":"TBY01(P-14)-10","priceMissing":false}, {"qtyTier":100,"unitPrice":490,"commercialSku":"TBY01(P-14)-100","priceMissing":false}],
    "selectedPrice": {"qtyTier":10,"unitPrice":690,"belowMoq":false,"source":"offer"},
    "components": [{"modelId":"PRODUCT_…","name":"Neck massager","typeId":"neck_massager","qty":1}],
    "customizations": [{"id":"screen","name_th":"สกรีนโลโก้"}],
    "sourceRef": {"file":"identity-review.json","sha256":"…","rowKey":"OFFER_TBY01"}
  }],
  "nearest": [] }
```

### 5.8 LINE OA integration (branch `feat/local-llm-swap` → `feat/catalog-graph-v4`)

| ไฟล์ | การแก้ |
|---|---|
| `src/cli/index.ts:671-680` | **ลบ** การต่อ `ragContext` เข้า `text`; เหลือ `answerConversation(text, …)` |
| `src/rag/genesis-rag.ts` | `searchProducts(query, limit, {qty, budget})` และ `priceForCode(code, qty)` เป็น HTTP client ล้วน (`GENESIS_RAG_API_URL`, timeout 3 s); ลบ `GenesisDatabase.open` ออกจาก class นี้ (store เปิดโดย service เท่านั้น; ใช้ env แยก `RAG_STORE_POINTER` ฝั่ง service) |
| `src/answer/tools.ts` | `searchProducts` → async คืน `SearchEvidenceV4`; `quotePrice` / `findWithinBudget` → v4 (AC-D5) คง `src/pricing/` เป็น fallback ที่ติด `priceSource: 'estimate_rmb'` |
| `src/answer/llm.ts`, `src/mcp/pricing-server.ts`, `src/answer/headless.ts` | tool runners await ตัวใหม่; MCP_TOOLS เดิม |
| `.agents/zuri-01/AGENTS.md` (+ fallback string `persona.ts:19`) | กติกา: ≤ 5 การ์ดระดับ Model/Offer; แสดงสีที่มี + ราคา ณ จำนวนที่ถาม; `status=review_required` → "ข้อมูลรอตรวจสอบ"; `unavailable` → ข้อความขัดข้อง ห้ามแต่งรหัส; `budgetUnmet` → เสนอ `nearest` พร้อมบอกราคาจริง |
| `src/answer/format-cards.ts` (ใหม่) | deterministic: `SearchEvidenceV4` → `CardPayload[]` (≤ 5) ใช้ทั้ง text formatter และ `flex.ts modelCard` |
| `src/line-poc/flex.ts` | `modelCard(CardPayload)` preview-only (AC-D7) |
| `tests/unit/conversation.test.ts` | แก้ case ที่ pin `matches[0].sku` เดิม |
| `package.json` | เพิ่มไฟล์ test ใหม่ใน `test` script (เป็น allowlist); เพิ่ม `exceljs` |

### 5.9 Error handling & observability

| สถานการณ์ | พฤติกรรม |
|---|---|
| native module โหลดไม่ได้ | ingest exit 2; service `/health.dbReady=false`, search/price → 503 |
| store lock ชน | ingest **ไม่** เปิด store ที่ service ถือ: เขียน dir ใหม่ `<runId>` เสมอ; ถ้า lock ที่ dir ใหม่ → exit 3 |
| embed sidecar ล่ม | ingest: embed ทั้งหมดก่อน `bulkAddNodes` → fail ก่อนเขียน; service: 503 `embed_unavailable` |
| input hash เปลี่ยนระหว่างรัน | abort, ไม่เขียน manifest/CURRENT |
| LINE tool: ECONNREFUSED / timeout 3 s / non-2xx | `{unavailable:true, reason}` (AC-D6) |

Request log `state/rag-service/requests.jsonl`: `{ts, queryHmac (HMAC-SHA256 key = lineHistoryHashKey), parsed: {excludeTypes, qty, budgetPerUnit, budgetUnmet} (ไม่มี cleanText), k, hits, returned, latencyMs: {embed, search, expand, total}}` — test 7.8 assert ไม่มี non-ASCII query substring

### 5.10 Runtime / cutover (แทน Q6 เดิม)

- รองรับ **Windows native** ผ่าน `start-rag-service.bat` เท่านั้น; `docker-compose.yml` rag-service (Linux) **ไม่รองรับ v4** ในรอบนี้ → mark deprecated ใน README
- Ingest เขียน `genesis_smartgift_store_v4/<runId>/` + อัปเดตไฟล์ `genesis_smartgift_store_v4/CURRENT` (เนื้อหา = runId) **หลัง** verify counts + vector ผ่าน
- Service อ่าน CURRENT ตอน start (`RAG_STORE_POINTER`); cutover = restart service (P3/P6 มี step ชัด, downtime ≈ 10 s, owner Boss)
- Ingest ก่อนเขียน CURRENT จะ `GET :8888/health` แล้วพิมพ์ storePath ที่ service ถืออยู่ เพื่อเตือนว่าต้อง restart
- `start-edge-device.bat`: แก้ให้ kill เฉพาะ process ที่ถือ :8787 (ไม่ kill service :8888)

---

## 6. โครงสร้างโค้ด

```
zuri-edge-catalog-p4 (feat/catalog-graph-v4)
  src/rag/v4/
    config/category-group-map.v1.json
    config/product-type-aliases.v1.json
    schema.ts          node/edge types + id builders (+ TYPE_unclassified sentinel)
    sku.ts             stableId / displayCode / COLOR_ABBR / MATERIAL_ABBR / collision
    flowaccount.ts     exceljs reader + CODE_RX / NAME_RX + buckets
    category-map.ts    loader + validator (32 typeIds)
    aliases.ts         loader + validator (32 coverage)
    build-graph.ts     inputs → GraphBatch (pure, no I/O; denormalize typeId / componentTypeIds)
    ingest.ts          I/O: read, hash, embed, bulkAdd, createCollection, manifest, CURRENT
    query-parser.ts
    search.ts          hybridSearch + expand + price + budget (pure over db interface)
    price.ts           /api/rag/price
    embed-client.ts    HTTP → sidecar
    http-client.ts     shared by service & GenesisLocalRag (timeout, error mapping)
  scripts/ingest-catalog-v4.ts, scripts/eval-catalog-v4.ts, scripts/embed-sidecar.py, scripts/author-nl-queries.md (template)
  src/rag/genesis-rag.ts, src/cli/index.ts, src/answer/{tools,llm,headless,format-cards}.ts, src/mcp/pricing-server.ts, src/line-poc/flex.ts, .agents/zuri-01/AGENTS.md
  tests/unit/v4-*.test.ts, tests/fixtures/v4/, tests/replay/line-chat.test.ts, tests/integration/v4-store.test.ts
zuri-rag-service
  src/server.ts (thin: routes → search.ts/price.ts), tests/server.test.ts, package.json (+ supertest, test script), start-rag-service.bat (+ sidecar)
```

---

## 7. Test Plan (TDD: red → green → refactor; pure modules ก่อน I/O)

Runner `node --import tsx --test`; fixtures ≤ 20 รายการ ยกเว้น `tests/fixtures/v4/real-50.json` (50 รายการจริงสำหรับ replay); `@store`/`@sidecar` รันเฉพาะ `RUN_STORE_TESTS=1`

### 7.1 `sku.ts` — `tests/unit/v4-sku.test.ts`
| Test | AC |
|---|---|
| stableId เท่ากันเมื่อ input เท่า; ต่างเมื่อ variantId ต่าง | B1 |
| Notebook Powerbank (type notebook, en "Notebook Powerbank", Black, A5, null) → `SKU-NOTEBOOK-NOTEBOOK-POW-BLK-A5` | B2 |
| Vacuum flask (drinkware, "Vacuum flask", Black, 500ml, SUS304) → `SKU-DRINKWARE-VACUUM-FL-BLK-500-S304` (modelTok ถูกลดเหลือ 9 เพื่อให้ base ≤ 36) | B2 |
| ไม่มี attributes → `…-STD` | B2 |
| colors ["Black","Blue"] → `BLK-MC…` | B2 |
| 2 variants displayCode เดียวกัน → ตัว physicalVariantId มากกว่าได้ `-2` | B2 |
| englishName ว่าง → modelTok = productId.split("_")[1][:6] (ต่างกันต่อ model) | B2 |
| property 500 random (ชื่อยาว 60, สี 30 ตัวอักษร, วัสดุยาว) → length ≤ 40 เสมอ, ไม่มีช่องว่าง/ตัวพิมพ์เล็ก; variantTok ไม่เคยถูกตัดเพราะ base เกิน | B2 |
| 120 variants base เดียวกัน → ตัวที่ 100+ ได้ suffix hash, ความยาว ≤ 40 | B2 |
| เปลี่ยน englishName → stableId เดิม | B3 |

### 7.2 `flowaccount.ts` — `tests/unit/v4-flowaccount.test.ts`
| Test | AC |
|---|---|
| `TBY01(P-14)-100` → base TBY01, group P-14, qty 100 | A6 |
| `THB03-2(P-20)-500`, `TYD0762(P-PT)-10`, `TBS01` (group/qty null) | A6 |
| 14 unparsed จริง (fixture) → `unparsed[]` reason `regex` | A6 |
| ProductCode ว่าง + Name "…TPH00-4(P-06)" → `name_coded` base TPH00-4 group P-06 qtyTier null | A6 |
| ProductCode ว่าง + Name ไม่มีรหัส + price 570 → `blank` + flagged `hasPrice` | A6 |
| "ไม่ใช้งานแล้ว" → `inactive` | A6 |
| ทุก bucket รวม = จำนวน row fixture | A6 |
| UnitPrice 0 → `priceMissing: true` | A6 |
| header ไม่ตรง → `FlowAccountSchemaError` | A6 |
| base เทียบ offers แบบ case-insensitive (`fxd1x-4` = `FXD1X-4`) | A1 |

### 7.3 `category-map.ts` + `aliases.ts` — `tests/unit/v4-config.test.ts`
| Test | AC |
|---|---|
| map ครอบ typeId ชุดที่ส่งเข้า (32) → ผ่าน; ขาด `lighter` → throw ระบุชื่อ | A4 |
| type ซ้ำ 2 group / group นอก 4 → throw | A4 |
| aliases ครบ 32 type, แต่ละ type มี name_th + ≥ 1 alias_th; "แก้ว" ∈ drinkware.aliases_th | A4, C3 |
| ไฟล์ config จริงใน `src/rag/v4/config/` ผ่าน validator ทั้งสอง | A4 |

### 7.4 `build-graph.ts` — `tests/unit/v4-build-graph.test.ts` (pure)
| Test | AC |
|---|---|
| fixture 3 models / 5 variants / 2 offers (1 set, 1 single) / 4 links / 3 price lines / 1 name_coded → counts ตาม AC-A1 สูตร | A1 |
| รัน 2 ครั้ง → deep-equal | A2 |
| `status` ทุก node = ค่าใน fixture ตามตัวอักษร (รวม `candidate`) | A5 |
| ทุก node มี sourceRef {file, sha256, rowKey} | A5 |
| Model ไม่มี typeId แต่ role → IN_TYPE source `component_role`; ไม่มีทั้งคู่ → `TYPE_unclassified` source `none`, status ไม่ถูกแตะ | A4, A5 |
| Offer single → `SINGLE_OF`; Model เดียวกันอยู่ใน CONTAINS ของ set ด้วย | A8 |
| base ไม่อยู่ใน offers → CatalogOffer origin `flowaccount_only` + PRICED_AS | A1 |
| Offer branding ไม่ว่าง → CONTAINS `SKU_PKG_GIFTBOX_STD`; `componentTypeIds` ไม่รวม packaging | C3 |
| Offer ไม่มีใน catalog-2026 → name_en จาก identity-review, image null | A5 |
| ProductModel.typeId และ Offer.componentTypeIds ถูก denormalize ถูกต้อง | C3 |

### 7.5 `ingest.ts` — `tests/unit/v4-ingest.test.ts` (mock db, mock embed client, tmp dir)
| Test | AC |
|---|---|
| manifest มี sha256 ครบ 5 input ตามชื่อไฟล์ | A2 |
| hash เดิม → `skip`, ไม่เรียก bulkAdd; เปลี่ยน 1 ไฟล์ → `reingest` | A3 |
| embed ล้ม → ไม่เรียก bulkAddNodes, exit 2 | §5.9 |
| `createCollection('e5_v4', …, 384, 'cosine')` ถูกเรียก; `addVector` = models + offers | A7 |
| CURRENT เขียนหลัง verify ผ่านเท่านั้น; verify fail → ไม่เขียน | §5.10 |
| lock error → exit 3 | §5.9 |

### 7.6 `query-parser.ts` — `tests/unit/v4-query-parser.test.ts`
| Test | AC |
|---|---|
| "ของขวัญดูดี ไม่ใช่แก้ว งบ 200 บาท" → exclude [drinkware], budgetPerUnit 200, cleanText "ของขวัญดูดี" | C3, C4 |
| "ไม่เอาร่ม ไม่เอาปากกา 100 ชิ้น" → exclude [umbrella, pen], qty 100 | C3, C4 |
| "งบ 20,000 สำหรับ 100 คน" → qty 100, budgetTotal 20000, budgetPerUnit 200 | C4 |
| "powerbank 20000" → qty null (ไม่มีหน่วย) | C4 |
| "งบไม่เกิน 1,500" → budgetPerUnit 1500 | C4 |
| ไม่มี keyword → parsed ว่าง, cleanText = input | — |

### 7.7 `search.ts` — `tests/unit/v4-search.test.ts` (fake db)
| Test | AC |
|---|---|
| hits มี SKU/Variant → ไม่โผล่ใน results | C1 |
| 2 hits distance ต่างกัน → score ต่างกัน และ = 1 − d²/2 | C1 |
| exclude [drinkware] → Offer ที่ componentTypeIds ∋ drinkware ถูกตัด; Model typeId drinkware ถูกตัด | C3 |
| หลังตัดเหลือ 2 < limit 5 → เรียก hybridSearch ครั้งที่ 2 ด้วย k=160 | C3 |
| qty 100 → tier 100; qty 30 → tier 20; qty 5 → tier 10 + belowMoq; ไม่ระบุ → tier ต่ำสุด | C4 |
| budget 200 → Offer 470 ถูกตัด; Model ไม่มีราคา คงไว้ | C4 |
| budget ตัดหมด → results [], budgetUnmet true, nearest 3 เรียง unitPrice | C5 |
| Model result ได้ priceLadder ผ่าน CONTAINS⁻¹ offers (source via_offer); ผ่าน SINGLE_OF (source offer); ไม่มี → null | C7 |
| expand เรียก neighbors ด้วย rels/direction ตาม §5.7 step 5 (assert call args) | C2 |
| dedupe Model ซ้ำ 2 hits → 1 | C1 |
| hybridSearch throw → `RagUnavailableError` | C6 |
| ผล positive control: query ไม่มี exclude บน fixture เดียวกันคืน drinkware ≥ 1 | D3 |

### 7.8 Service — `zuri-rag-service/tests/server.test.ts` (supertest, inject fake search/price)
| Test | AC |
|---|---|
| 200 shape ตาม §5.7 (schema assert) | C1, C2 |
| `RagUnavailableError` → 503 `{success:false, error:'rag_unavailable'}` | C6 |
| `/health` สะท้อน dbReady/embedReady/storePath (ลงท้าย CURRENT runId) | C6, §5.10 |
| `/api/rag/price {code, qty}` → priceLadder + selectedPrice | D5 |
| request log line: มี queryHmac, parsed ไม่มี cleanText, ไม่มี non-ASCII | §5.9 |

### 7.9 LINE integration — `tests/unit/v4-answer-tools.test.ts`, `tests/unit/v4-adr-guard.test.ts`, `tests/replay/line-chat.test.ts`
| Test | AC |
|---|---|
| `searchProducts` evidence มี variants/priceLadder/selectedPrice/components/customizations | D1 |
| `quotePrice('TBY01', 100)` → 490 source CommercialSKU; รหัสไม่มี price line → `priceSource: 'estimate_rmb'` | D5 |
| `findWithinBudget(100, 500)` → เรียก search ด้วย qty/budget | D5 |
| ECONNREFUSED / timeout 3 s / 500 → `{unavailable:true, reason}` | D6 |
| static guard: grep forbidden imports/strings; `GenesisDatabase.open` ไม่ถูกเรียกจาก `searchProducts` (spy) | D4 |
| `cli/index.ts answer`: prompt ที่ส่งเข้า `answerConversation` = text เดิม ไม่มี "[ข้อมูลสินค้า" | D1 |
| replay 17 turns: 4× ไม่ใช่แก้ว → ไม่มี drinkware + positive control ≥ 1; "แก้วน้ำมีกี่สี" → colors ≥ 1 | D3 |
| `formatCards(evidence)` ≤ 5, แต่ละใบมี name/colors/selectedPrice ถูก tier (stub LLM) | D2 |
| `modelCard(payload)` ผ่าน validator; ไม่ถูกเรียกใน DM path | D7 |
| `conversation.test.ts` case เดิมแก้ให้ใช้ `code` | — |

### 7.10 Integration `@store @sidecar` — `tests/integration/v4-store.test.ts`
| Test | AC |
|---|---|
| ingest fixture real-50 → เปิด store → counts, `e5_v4` vectors = models + offers | A1, A7 |
| ingest ซ้ำ → id set เท่าเดิม, CURRENT เดิม | A2 |
| hybridSearch "สมุดโน้ต power bank" → Notebook Powerbank Model ใน top-3 | G1 |
| ประสิทธิภาพ: 20 query p95 ≤ 800 ms | G7 |

ลำดับ TDD: 7.1 → 7.2 → 7.3 → 7.4 → 7.6 → 7.7 → 7.5 → 7.10 → 7.8 → 7.9

---

## 8. การวัดผล

### 8.1 `scripts/eval-catalog-v4.ts` → `$ZURI_DATA_ROOT/catalog_eval_v4/<runId>/`
ไฟล์ตาม AC-E1; `environment-manifest.json` บันทึก model revision, CPU, versions (Q5)

### 8.2 Query sets (อยู่ใน git ที่ `tests/fixtures/v4/querysets/`)

| Set | ที่มา | ขนาด | ใช้ |
|---|---|---|---|
| `QS_LINE_REAL_v1` | user turn จาก `state/line-chat` ที่เป็นคำถามสินค้า (ตัด greeting/admin) | 6 (3 unique) | AC-D3 + รายงานเชิงคุณภาพ |
| `QS_NL_AUTHORED_v1` | **เขียนใน P0** 60 คำถามภาษาคน: 4 CategoryGroup × {หา, เทียบ, ถามสี, ถามราคา} × ~4; แต่ละข้อระบุ `expected: {kind:'model'|'type', id}`, `exclude[]`, `qty?`, `budget?` | 60 | G1–G3 |
| `QS_OFFER_SELF_v1` | offer text → expected component models (round1 cohort RESOLVED_375) | 1,005 | regression |

### 8.3 Metrics (`metricId` prefix `MET_V4_`) — ครบทั้ง 9 ตัว = AC-E2; ทุกตัวผ่าน target = AC-E3

| metricId | numerator / denominator | Target |
|---|---|---|
| `RECALL_AT_{1,5,10}` | hit(result, expected) ∈ top-k / queries; hit: expected model → `result.id == id` หรือ Offer ที่ `components ∋ id`; expected type → `result.type.id == id` หรือ `componentTypeIds ∋ id` | R@5 ≥ 0.80 |
| `MRR` | mean(1 / rank ของ hit แรก; 0 ถ้าไม่มี) | ≥ 0.65 |
| `NEG_CONSTRAINT_PASS` | queries ที่ exclude ≠ ∅ **และ** results ≥ 1 (หรือ nearest ≥ 1) **และ** ไม่มี result ใน excluded type / queries ที่ exclude ≠ ∅ | 1.00 |
| `PRICE_COVERAGE` (graph) | Offer ที่มี PRICED_AS → CommercialSKU `priceMissing=false` ≥ 1 / distinct FlowAccount bases (parsed + name_coded = 216) | ≥ 0.85 |
| `VARIANT_COVERAGE` (graph) | Model ที่มี HAS_VARIANT → variant ที่ colors ≠ ∅ / 427 | ≥ 0.85 |
| `DUPLICATE_RESULT_RATE` | queries ที่มี ≥ 2 results id เดียวกัน / queries | 0 |
| `LATENCY_P50_MS`, `LATENCY_P95_MS` | end-to-end รวม embed | p95 ≤ 800 |
| `TRACE_COVERAGE` | node ที่มี sourceRef / nodes | 1.00 |
| `OFFER_SELF_RECALL_AT_5_RESTRICTED` | `QS_OFFER_SELF_v1` โดย filter label ProductModel และตัด Offer ของ query เอง, k=40 | ≥ 0.86 (round1 0.89 − 0.03) — regression gate ของ AC-E3 |

Ablation รายงานเพิ่ม (ไม่ใช่ gate): alpha 0 vs 0.2

### 8.4 Baseline (P0)
รัน `QS_NL_AUTHORED_v1` + `QS_LINE_REAL_v1` ผ่าน `/api/rag/search` เดิม (substring) และผ่าน `searchByName` → `runId=BASELINE_SUBSTRING`; ตัวเลขจริงแทนที่คอลัมน์ Baseline ใน §2

---

## 9. แผนงาน

| Phase | งาน | Deliverable | ขึ้นกับ |
|---|---|---|---|
| **P0 Prep** (1 วัน) | `git worktree repair`; branch `feat/catalog-graph-v4`; คัดลอก input เข้า `$ZURI_DATA_ROOT/source/`; เขียน `category-group-map.v1.json` + `product-type-aliases.v1.json` (Boss ยืนยัน Q1/Q2); **เขียน `QS_NL_AUTHORED_v1` 60 ข้อ**; baseline run §8.4; เพิ่ม `exceljs`, `supertest`, test script ใน zuri-rag-service | inputs + configs + query set + baseline metrics | spec approved |
| **P1 Pure core** (1.5 วัน) | TDD 7.1 → 7.4, 7.6, 7.7 | `src/rag/v4/*` pure เขียว | P0 |
| **P2 Embed + Ingest** (1 วัน) | sidecar :8891; TDD 7.5; `ingest-catalog-v4.ts`; 7.10 | store v4 `<runId>` + CURRENT, `e5_v4` vectors, manifest | P1 |
| **P3 Service** (0.5 วัน) | server.ts → v4 search/price; 7.8; request log; `start-rag-service.bat` + sidecar; **restart service (cutover #1)** | `/api/rag/search`, `/api/rag/price` v4 | P2 |
| **P4 LINE** (1.5 วัน) | cli/index.ts ลบ inject; genesis-rag HTTP-only; tools/llm/mcp/headless; format-cards; AGENTS.md; flex preview; 7.9 + replay | ซูริตอบระดับ Model พร้อมสี/ราคา | P3 |
| **P5 Eval** (0.5 วัน) | `eval-catalog-v4.ts`; รัน 3 query sets; ablation; เทียบ baseline | `catalog_eval_v4/<run>/metrics.jsonl` ผ่าน target | P4 |
| **P6 Ship** (0.5 วัน) | ทดสอบบน LINE OA กลุ่มทดสอบ (17 turn เดิม); ADR-006 (catalog graph v4) + ADR-RAG-004 (cutover lifecycle) ; deprecate docker rag-service; PR → `feat/local-llm-swap` | merged | P5 |

รวม ≈ 6.5 วันทำงาน. ทุก phase จบด้วย commit ที่ `npm test` เขียว (P2+ รวม `RUN_STORE_TESTS=1`)

**Definition of Done:** AC ทุกข้อผ่าน + §8.3 ผ่าน target + AC-D3 replay ผ่าน + ADR commit + Boss ทดสอบบน LINE OA จริง

---

## 10. Out of scope (sub-project ถัดไป)

| # | หัวข้อ | เหตุผล / ต้องมีก่อน |
|---|---|---|
| SP3 | Meta-Bundle (Package A/B/C), Collection/Campaign, Tier (Reach/Select/Signature/Bespoke); resolve customization option → SKU; ส่ง Flex ผ่าน delivery intent | v4 + ข้อมูลกล่อง/ราคา option |
| SP4 | MOQ / lead time / packaging จริง / pricing engine แทน CommercialSKU static; inventory cascade; WMS payload | ไม่มี source data ตอนนี้ |
| — | Admin UI review `review_required` 336 models / 49 unclassified | v4 |
| — | Docker/Linux build ของ rag-service + native module | ต้อง build Linux `.node` |
| — | bge-m3 dense+sparse | ต้อง re-benchmark ผ่าน HF ตรง (ไม่ใช่ Ollama) |

---

## 11. Risks & Open Questions

| # | ประเด็น | แผน |
|---|---|---|
| Q1 | ความหมาย `P-xx` | เก็บเป็น `priceListGroup`; Boss ยืนยัน |
| Q2 | mapping 32 type → 4 group (umbrella, bag, key_chain, car_accessory, lighter, nail_clipper) | ร่าง §5.3; Boss แก้ก่อน P0 |
| Q3 | 336/427 Model `review_required`, 49 `unclassified` | แสดง status ในคำตอบ; ไม่ block |
| Q4 | 91 FlowAccount base ไม่อยู่ใน catalog (ไม่มี description/ภาพ) — ยอมรับเป็น Offer ชื่อจาก FlowAccount (ตัดสิน 2026-08-23) | `origin: flowaccount_only` |
| Q5 | e5 CPU vs GPU ต่างกัน 7 จุดใน round1 | pin revision + float32 + CPU; environment-manifest ทุก run |
| Q6 | single-process lock | §5.10: versioned dir + CURRENT + restart ที่กำหนดเอง |
| Q7 | FlowAccount export 2026-06-21 (≈ 2 เดือน) | manifest เก็บ exportDate; การ์ดแสดง "ราคาอ้างอิง ณ 21 มิ.ย. 2026" |
| Q8 | งบ 200 ฿ แต่ price line ต่ำสุด 350 ฿ | AC-C5 `budgetUnmet` + `nearest`; persona บอกราคาจริง ไม่แต่ง |
| Q9 | `npm test` เป็น allowlist | ทุกไฟล์ test ใหม่ต้องถูกเพิ่ม (checklist ใน PR template) |
| Q10 | alpha > 0 boost node ที่มี in-degree สูง | default 0; ablation ใน P5 |
