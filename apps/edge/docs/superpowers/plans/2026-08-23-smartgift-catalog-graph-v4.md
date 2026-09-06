# SmartGift Catalog Graph v4 — Implementation Plan (parallel multi-agent)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-08-23-smartgift-catalog-graph-v4-design.md` (v2, commit `8adf6f7`). Section numbers below (§) refer to the spec.

**Goal:** Replace substring product search in the LINE OA agent with a GenesisBlock graph (Category → Type/Family → Model → Variant → SKU, Offer → CommercialSKU price lines) plus e5-small vectors, so ซูริ answers with Model/Offer-level cards, colours, and real tier prices, respecting "ไม่ใช่แก้ว / งบ / จำนวน".

**Architecture:** Pure TypeScript core (`src/rag/v4/*`: parsers → `build-graph` → `search`) with all I/O pushed to the edges (`ingest.ts`, `embed-client.ts`, `http-client.ts`, `zuri-rag-service/src/server.ts`). The LINE agent talks to the service over HTTP only; the service alone opens the GenesisBlock store (versioned dir + `CURRENT` pointer). A Python sidecar serves e5-small embeddings.

**Tech Stack:** TypeScript 5.5 / Node 22 ESM (`NodeNext`), `node --import tsx --test`, `exceljs`, `supertest`, `express` (service), `@freshair129/gks-genesis-block-native` 0.2.0 (service + ingest only), Python 3.13 + FastAPI + sentence-transformers 5.2 (sidecar), `intfloat/multilingual-e5-small` rev `614241f622f53c4eeff9890bdc4f31cfecc418b3`.

## Global Constraints (verbatim from spec)

- All v4 code lives in worktree `D:\workspace\zuri-edge-catalog-p4` on branch `feat/catalog-graph-v4` (branched from `feat/local-llm-swap`). Spec/plan live on `master` in `D:\workspace\zuri-edge-device`.
- Large inputs under `ZURI_DATA_ROOT` (env, default `D:/workspace/zuri-edge-device/data`); hand-written config under `src/rag/v4/config/` (git).
- `npm test` is an explicit file allowlist — **every new test file must be appended to the `test` script in `package.json`** (Q9).
- Store: `$ZURI_DATA_ROOT/genesis_smartgift_store_v4/<runId>/` + `CURRENT` pointer; collection `e5_v4`, dim 384, metric `cosine`; never `vec_default`.
- LINE agent: HTTP only (`GENESIS_RAG_API_URL`, timeout 3 s); no `GenesisDatabase.open`, no `hybridSearch`/`executeHql` strings in `src/answer/**`, `src/cli/index.ts`, `src/rag/genesis-rag.ts` (AC-D4).
- Identity-review `status` copied verbatim (`auto` / `review_required` / `unclassified` / `candidate`), never overridden (AC-A5).
- `displayCode` ≤ 40 chars always (§5.4); `stableId = "SKU_" + sha1(productId|physicalVariantId)[:20]`.
- FlowAccount buckets must sum to 1,317 active rows; nothing dropped silently (AC-A6).
- No silent fallback to substring search anywhere; unavailable → 503 / `{unavailable:true}` (AC-C6, AC-D6).
- Embedding: `passage:` / `query:` prefixes; ProductType / SKU / Variant / CommercialSKU are **not** embedded (AC-A7).
- Commit after every green task; commit message prefix `feat(catalog-v4):`, `test(catalog-v4):`, `docs(catalog-v4):`.

---

## 0. Orchestration — waves, agents, gates

### 0.1 Dependency graph

```
Wave 0  T0 prep (inline, no agent)
Wave 1  T1 schema ─┐  T2 sku  T3 flowaccount  T4 config  T5 query-parser  T6 http/embed clients  T7 NL query set  T8 sidecar.py
                   │   (all independent; T5 consumes T4's JSON shape, T2/T3 consume T1's id helpers — shapes are fixed in this plan)
Wave 2  T9 build-graph (T1,T2,T3,T4)     T10 search+price (T1,T5)      T11 format-cards (T10 types)
Wave 3  T12 ingest (T9,T6,T8)            T13 rag-service (T10,T6)      T14 agent rewire (T10,T6,T11)
Wave 4  T15 cli+persona+flex+replay (T14,T11)        T16 integration+baseline+eval (T12,T13,T7)
Wave 5  T17 eval run + ablation + ADR + PR (T15,T16)
```

### 0.2 Agent assignment (Boss's tiering — Worker: haiku / luna / sonnet-if-complex; Verify: sonnet / opus / sol; Decision: fable / opus)

| Task | Implementer | Verify gate | Isolation | Why this tier |
|---|---|---|---|---|
| T0 | inline (orchestrator) | — | — | git/fs mechanics |
| T1 schema | haiku | sonnet | worktree | typed constants, no logic |
| T2 sku | sonnet | sonnet | worktree | string rules with length proofs |
| T3 flowaccount | sonnet | sonnet | worktree | regex + buckets, arithmetic must hold on real file |
| T4 config | haiku | sonnet | worktree | JSON + validators |
| T5 query-parser | sonnet | sonnet | worktree | Thai rule parsing |
| T6 clients | haiku | sonnet | worktree | thin HTTP wrappers |
| T7 NL queries | sonnet | opus | none (fixture only) | domain judgement; gate checks expected ids exist |
| T8 sidecar | haiku | sonnet | worktree | Python, reuse benchmark loader |
| T9 build-graph | sonnet | opus | worktree | central invariants (counts, denormalization) |
| T10 search+price | sonnet | opus | worktree | ranking/filter logic |
| T11 format-cards | haiku | sonnet | worktree | deterministic mapping |
| T12 ingest | sonnet | sonnet | worktree | I/O ordering, CURRENT pointer |
| T13 rag-service | sonnet | sonnet | worktree (zuri-rag-service) | express routes + supertest |
| T14 agent rewire | sonnet | opus | worktree | touches 5 files in LINE agent |
| T15 cli/persona/flex/replay | sonnet | opus | worktree | customer-facing behaviour, AC-D3 |
| T16 integration/baseline/eval | sonnet | sonnet | none (needs real store, sequential) | runs real ingest |
| T17 ship | fable (orchestrator) | opus | — | decision gate |

Expected agents: 16 implementers (6 haiku, 10 sonnet) + 16 verifiers (12 sonnet, 4 opus) + 5 wave gates (opus) ≈ 37. No fable subagents.

### 0.3 Protocol per task

1. Orchestrator spawns implementer in a fresh worktree branch `feat/catalog-graph-v4-tN` with **only** that task's text + Global Constraints + spec sections it cites. Worktrees are created by the orchestrator from the **current** `feat/catalog-graph-v4` (so earlier waves' modules exist). Implementers never edit `package.json`; the wave gate appends test files to the allowlist (Wave 1 lesson: self-appending caused merge conflicts).
2. Implementer follows steps (test first → fail → code → pass → commit), returns: files changed, test command + output tail, open questions.
3. Verify agent (fresh context) gets: task text, `git diff feat/catalog-graph-v4..feat/catalog-graph-v4-tN`, test output. Checks: every AC row in task has a passing test; no forbidden strings (AC-D4); no placeholder; types match the **Interfaces** block. Returns `approve` or a list of concrete defects.
4. Defects → same implementer (SendMessage, context intact) fixes; max 2 rounds, then escalate to orchestrator.
5. Wave gate (opus): merge all approved task branches into `feat/catalog-graph-v4`, run full `npm test` (+ `RUN_STORE_TESTS=1` from Wave 3), read the combined diff against the spec ACs for that wave, approve or list cross-task conflicts.
6. Orchestrator (fable) resolves conflicts, decides scope changes, and is the only one who edits the spec.

### 0.4 Workflow script skeleton (run after Boss approves; `args = { wave: N }`)

```js
export const meta = { name: 'catalog-v4-wave', description: 'Implement one wave of the catalog-v4 plan with per-task verify gates',
  phases: [{ title: 'Implement' }, { title: 'Verify' }, { title: 'Gate' }] }
const PLAN = 'D:/workspace/zuri-edge-device/docs/superpowers/plans/2026-08-23-smartgift-catalog-graph-v4.md'
const WAVES = { 1: ['T1','T2','T3','T4','T5','T6','T7','T8'], 2: ['T9','T10','T11'], 3: ['T12','T13','T14'], 4: ['T15','T16'] }
const TIER = { T1:'haiku',T2:'sonnet',T3:'sonnet',T4:'haiku',T5:'sonnet',T6:'haiku',T7:'sonnet',T8:'haiku',T9:'sonnet',T10:'sonnet',T11:'haiku',T12:'sonnet',T13:'sonnet',T14:'sonnet',T15:'sonnet',T16:'sonnet' }
const GATE = { T7:'opus',T9:'opus',T10:'opus',T14:'opus',T15:'opus' }
const VERDICT = { type:'object', properties:{ approve:{type:'boolean'}, defects:{type:'array',items:{type:'string'}} }, required:['approve','defects'] }
const RESULT = { type:'object', properties:{ branch:{type:'string'}, files:{type:'array',items:{type:'string'}}, testTail:{type:'string'}, questions:{type:'array',items:{type:'string'}} }, required:['branch','files','testTail','questions'] }
const tasks = WAVES[args.wave]
const out = await pipeline(tasks,
  t => agent(`Implement task ${t} from ${PLAN} exactly (TDD steps, commit each green step). Work in a fresh git worktree of D:/workspace/zuri-edge-catalog-p4 on branch feat/catalog-graph-v4-${t.toLowerCase()} from feat/catalog-graph-v4. Read only the Global Constraints, section 0.3, and your task section. Return structured result.`,
             { label:`impl:${t}`, phase:'Implement', model: TIER[t], effort: TIER[t]==='haiku'?'low':'medium', isolation:'worktree', schema: RESULT }),
  (r, t) => r && agent(`Verify task ${t} of ${PLAN} on branch ${r.branch}: run its tests, diff against feat/catalog-graph-v4, check every AC row has a passing test, Interfaces block honoured, no placeholders, no forbidden strings (AC-D4). Default approve=false if unsure.`,
             { label:`verify:${t}`, phase:'Verify', model: GATE[t] || 'sonnet', effort:'medium', schema: VERDICT }).then(v => ({ t, r, v })),
  x => (x && !x.v.approve) ? agent(`Task ${x.t} was rejected: ${x.v.defects.join('; ')}. Fix on branch ${x.r.branch}, keep tests green, commit. Return structured result.`,
             { label:`fix:${x.t}`, phase:'Implement', model: TIER[x.t], schema: RESULT }).then(r2 => ({ ...x, r: r2, fixed: true })) : x)
const gate = await agent(`Wave ${args.wave} gate: merge branches ${out.filter(Boolean).map(x=>x.r.branch).join(', ')} into feat/catalog-graph-v4 in D:/workspace/zuri-edge-catalog-p4, run npm test${args.wave>=3?' and RUN_STORE_TESTS=1 npm test':''}, compare combined diff with spec ACs for these tasks. Do not rewrite code; report conflicts.`,
  { label:`gate:wave${args.wave}`, phase:'Gate', model:'opus', schema: VERDICT })
return { out, gate }
```
(Wave 1 = 8 impl + 8 verify + ≤ 8 fix + 1 gate ≤ 25 agents, 14 of them haiku/sonnet-low.)

---

## File structure (created / modified)

```
src/rag/v4/schema.ts              labels, rels, id builders, SourceRef, GraphBatch types
src/rag/v4/sku.ts                 stableId / displayCode / COLOR_ABBR / MATERIAL_ABBR / collision
src/rag/v4/flowaccount.ts         exceljs reader + CODE_RX/NAME_RX + buckets
src/rag/v4/config/category-group-map.v1.json, product-type-aliases.v1.json
src/rag/v4/config.ts              loaders + validators (category map, aliases)
src/rag/v4/query-parser.ts        exclude / qty / budget extraction
src/rag/v4/http-client.ts         fetchJson with timeout + RagUnavailableError
src/rag/v4/embed-client.ts        POST /embed
src/rag/v4/embed-text.ts          passage text contracts
src/rag/v4/build-graph.ts         inputs → GraphBatch (pure)
src/rag/v4/search.ts              hybridSearch + expand + price + budget (pure over GraphDb)
src/rag/v4/price.ts               priceLadder / selectedPrice helpers + /api/rag/price
src/rag/v4/ingest.ts              read → hash → manifest decision → embed → bulkAdd → verify → CURRENT
src/answer/format-cards.ts        SearchEvidenceV4 → CardPayload[]
src/rag/genesis-rag.ts            HTTP-only client (searchProducts, priceForCode)
src/answer/tools.ts, llm.ts, headless.ts, src/mcp/pricing-server.ts   async v4 tools
src/cli/index.ts                  remove ragContext injection
src/line-poc/flex.ts              modelCard()
.agents/zuri-01/AGENTS.md         persona rules
scripts/ingest-catalog-v4.ts, scripts/eval-catalog-v4.ts, scripts/embed-sidecar.py
tests/unit/v4-*.test.ts, tests/fixtures/v4/*, tests/replay/line-chat.test.ts, tests/integration/v4-store.test.ts
zuri-rag-service/src/server.ts, tests/server.test.ts, package.json, start-rag-service.bat
```

---

### Task T0: Prep (inline — orchestrator runs these, no agent)

**Files:** `package.json` (p4), `zuri-rag-service/package.json`, `$ZURI_DATA_ROOT/source/*`

- [ ] **Step 1: Repair worktree registration and branch**

```bash
git -C D:/workspace/zuri-cli worktree repair D:/workspace/zuri-edge-device
git -C D:/workspace/zuri-edge-catalog-p4 checkout -b feat/catalog-graph-v4 feat/local-llm-swap
```
Expected: `git -C D:/workspace/zuri-edge-catalog-p4 branch --show-current` → `feat/catalog-graph-v4`

- [ ] **Step 2: Copy inputs under data root**

```bash
mkdir -p D:/workspace/zuri-edge-device/data/source
cp C:/Users/freshair/Downloads/catalog-2026.json D:/workspace/zuri-edge-device/data/source/catalog-2026.json
cp "D:/workspace/Bussiness-01-SmartGift/ไฟล์จากรายชื่อลูกค้า FlowAccount/บริษัท เทราบิส จำกัด_product.xlsx" D:/workspace/zuri-edge-device/data/source/flowaccount-product-2026-06-21.xlsx
sha256sum D:/workspace/zuri-edge-device/data/source/*
```

- [ ] **Step 3: Add dependencies and test-script entries**

In `D:/workspace/zuri-edge-catalog-p4`:
```bash
npm install exceljs@^4.4.0
```
Append to the `"test"` script in `package.json` (keep one line, space-separated):
```
tests/unit/v4-schema.test.ts tests/unit/v4-sku.test.ts tests/unit/v4-flowaccount.test.ts tests/unit/v4-config.test.ts tests/unit/v4-query-parser.test.ts tests/unit/v4-clients.test.ts tests/unit/v4-build-graph.test.ts tests/unit/v4-search.test.ts tests/unit/v4-format-cards.test.ts tests/unit/v4-ingest.test.ts tests/unit/v4-answer-tools.test.ts tests/unit/v4-adr-guard.test.ts tests/replay/line-chat.test.ts
```
Add scripts:
```json
"catalog:ingest-v4": "node --import tsx scripts/ingest-catalog-v4.ts",
"catalog:eval-v4": "node --import tsx scripts/eval-catalog-v4.ts",
"test:store": "cross-env-free: set RUN_STORE_TESTS=1&& node --import tsx --test tests/integration/v4-store.test.ts"
```
(Windows: `"test:store": "node --import tsx --test tests/integration/v4-store.test.ts"` and run with `$env:RUN_STORE_TESTS=1` in PowerShell.)

In `D:/workspace/zuri-rag-service`:
```bash
npm install --save-dev supertest@^7.0.0 @types/supertest@^6.0.2
```
Add `"test": "node --import tsx --test tests/server.test.ts"`.

- [ ] **Step 4: Commit**

```bash
git -C D:/workspace/zuri-edge-catalog-p4 add package.json package-lock.json
git -C D:/workspace/zuri-edge-catalog-p4 commit -m "chore(catalog-v4): add exceljs, v4 test allowlist and scripts"
git -C D:/workspace/zuri-rag-service add package.json package-lock.json
git -C D:/workspace/zuri-rag-service commit -m "chore: add supertest and test script"
```

---

### Task T1: `schema.ts` — labels, rels, id builders

**Files:**
- Create: `src/rag/v4/schema.ts`
- Test: `tests/unit/v4-schema.test.ts`

**Interfaces:**
- Produces (used by T2, T3, T9, T10, T12):
```ts
export type NodeLabel = 'CategoryGroup'|'ProductType'|'TypeSentinel'|'ProductModel'|'PhysicalVariant'|'PhysicalSKU'|'CatalogOffer'|'CommercialSKU'|'CustomizationOption'|'AttributeValue';
export type EdgeRel = 'IN_GROUP'|'IN_TYPE'|'HAS_VARIANT'|'HAS_SKU'|'HAS_ATTRIBUTE'|'CONTAINS'|'PRICED_AS'|'CUSTOMIZABLE_WITH'|'SINGLE_OF';
export interface SourceRef { file: string; sha256: string; rowKey: string }
export interface GraphNode { id: string; labels: NodeLabel[]; props: Record<string, unknown> }
export interface GraphEdge { id: string; from: string; to: string; rel: EdgeRel; props?: Record<string, unknown> }
export interface GraphBatch { nodes: GraphNode[]; edges: GraphEdge[]; stats: Record<string, number> }
export const TYPE_UNCLASSIFIED = 'TYPE_unclassified'; export const SKU_PKG_GIFTBOX_STD = 'SKU_PKG_GIFTBOX_STD'; export const COLLECTION = 'e5_v4'; export const VECTOR_DIM = 384;
export function sha1Hex(s: string): string; export function slug(s: string): string; export function cut(tok: string, n: number): string;
export function catGroupId(slug: string): string; export function typeNodeId(typeId: string): string; export function offerNodeId(code: string): string;
export function cskuId(seed: string): string; export function customId(optionId: string): string; export function edgeId(rel: EdgeRel, from: string, to: string, extra?: string): string;
```

- [ ] **Step 1: Write the failing test**

`tests/unit/v4-schema.test.ts`:
```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { slug, cut, sha1Hex, catGroupId, typeNodeId, offerNodeId, cskuId, customId, edgeId, TYPE_UNCLASSIFIED, COLLECTION, VECTOR_DIM } from '../../src/rag/v4/schema.js';

describe('v4 schema helpers', () => {
  it('slug uppercases ASCII and collapses non-alphanumerics to single dashes', () => {
    assert.equal(slug('Notebook Powerbank'), 'NOTEBOOK-POWERBANK');
    assert.equal(slug('  usb_flash-drive!! '), 'USB-FLASH-DRIVE');
    assert.equal(slug('สมุดโน้ต'), '');
  });
  it('cut truncates and strips a trailing dash', () => {
    assert.equal(cut('NOTEBOOK-POWERBANK', 12), 'NOTEBOOK-POW');
    assert.equal(cut('USB-FLASH-DRIVE', 10), 'USB-FLASH');
    assert.equal(cut('ABC', 10), 'ABC');
  });
  it('ids are deterministic and namespaced', () => {
    assert.equal(catGroupId('smart_tech'), 'CATGROUP_smart_tech');
    assert.equal(typeNodeId('power_bank'), 'TYPE_power_bank');
    assert.equal(offerNodeId('fxd1x-4'), 'OFFER_FXD1X-4');
    assert.equal(customId('screen_logo'), 'CUSTOM_screen_logo');
    assert.match(cskuId('TBY01(P-14)-100'), /^CSKU_[0-9A-F]{20}$/);
    assert.equal(cskuId('x'), cskuId('x'));
    assert.notEqual(edgeId('CONTAINS', 'A', 'B'), edgeId('CONTAINS', 'A', 'B', 'link2'));
    assert.equal(sha1Hex('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  });
  it('constants', () => {
    assert.equal(TYPE_UNCLASSIFIED, 'TYPE_unclassified');
    assert.equal(COLLECTION, 'e5_v4');
    assert.equal(VECTOR_DIM, 384);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/v4-schema.test.ts`
Expected: FAIL — `Cannot find module '../../src/rag/v4/schema.js'`

- [ ] **Step 3: Write minimal implementation**

`src/rag/v4/schema.ts`:
```ts
import { createHash } from 'node:crypto';

export type NodeLabel =
  | 'CategoryGroup' | 'ProductType' | 'TypeSentinel' | 'ProductModel' | 'PhysicalVariant'
  | 'PhysicalSKU' | 'CatalogOffer' | 'CommercialSKU' | 'CustomizationOption' | 'AttributeValue';

export type EdgeRel =
  | 'IN_GROUP' | 'IN_TYPE' | 'HAS_VARIANT' | 'HAS_SKU' | 'HAS_ATTRIBUTE'
  | 'CONTAINS' | 'PRICED_AS' | 'CUSTOMIZABLE_WITH' | 'SINGLE_OF';

export interface SourceRef { file: string; sha256: string; rowKey: string }
export interface GraphNode { id: string; labels: NodeLabel[]; props: Record<string, unknown> }
export interface GraphEdge { id: string; from: string; to: string; rel: EdgeRel; props?: Record<string, unknown> }
export interface GraphBatch { nodes: GraphNode[]; edges: GraphEdge[]; stats: Record<string, number> }

export const TYPE_UNCLASSIFIED = 'TYPE_unclassified';
export const SKU_PKG_GIFTBOX_STD = 'SKU_PKG_GIFTBOX_STD';
export const COLLECTION = 'e5_v4';
export const VECTOR_DIM = 384;
export const EMBED_MODEL = 'intfloat/multilingual-e5-small';
export const EMBED_MODEL_REVISION = '614241f622f53c4eeff9890bdc4f31cfecc418b3';

export function sha1Hex(s: string): string {
  return createHash('sha1').update(s, 'utf8').digest('hex');
}

/** ASCII-only upper-case slug; non [A-Z0-9] runs become one dash; no leading/trailing dash. */
export function slug(s: string): string {
  return s.normalize('NFKD').replace(/[^\x00-\x7F]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function cut(tok: string, n: number): string {
  return tok.slice(0, n).replace(/-+$/g, '');
}

export const catGroupId = (groupSlug: string): string => `CATGROUP_${groupSlug}`;
export const typeNodeId = (typeId: string): string => `TYPE_${typeId}`;
export const offerNodeId = (code: string): string => `OFFER_${code.trim().toUpperCase()}`;
export const cskuId = (seed: string): string => `CSKU_${sha1Hex(seed).slice(0, 20).toUpperCase()}`;
export const customId = (optionId: string): string => `CUSTOM_${optionId}`;
export function edgeId(rel: EdgeRel, from: string, to: string, extra = ''): string {
  return `EDGE_${sha1Hex(`${rel}|${from}|${to}|${extra}`).slice(0, 20).toUpperCase()}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/v4-schema.test.ts`
Expected: `# pass 4`

- [ ] **Step 5: Commit**

```bash
git add src/rag/v4/schema.ts tests/unit/v4-schema.test.ts
git commit -m "feat(catalog-v4): graph schema labels, rels and id builders"
```

---

### Task T2: `sku.ts` — PhysicalSKU ids and display codes (§5.4, AC-B1..B3)

**Files:**
- Create: `src/rag/v4/sku.ts`
- Test: `tests/unit/v4-sku.test.ts`

**Interfaces:**
- Consumes: `slug`, `cut`, `sha1Hex` from T1.
- Produces:
```ts
export interface SkuInput { productId: string; physicalVariantId: string; typeId: string | null; englishName: string | null; colors: string[]; sizes: string[]; materials: string[] }
export function stableSkuId(productId: string, physicalVariantId: string): string;           // "SKU_" + sha1[:20]
export function baseDisplayCode(input: SkuInput): string;                                    // ≤ 36, no suffix
export function assignDisplayCodes(inputs: SkuInput[]): Map<string /*stableId*/, string>;    // collision-resolved, ≤ 40
export const COLOR_ABBR: Record<string, string>; export const MATERIAL_ABBR: Record<string, string>;
```

- [ ] **Step 1: Write the failing test**

`tests/unit/v4-sku.test.ts`:
```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stableSkuId, baseDisplayCode, assignDisplayCodes, type SkuInput } from '../../src/rag/v4/sku.js';

const mk = (o: Partial<SkuInput>): SkuInput => ({
  productId: 'PRODUCT_00A7D1FE671C2AF3B1E6', physicalVariantId: 'PHYSICAL_VARIANT_0D1AA0A992B73892D806',
  typeId: 'notebook', englishName: 'Notebook Powerbank', colors: ['Black'], sizes: ['A5'], materials: [], ...o,
});

describe('v4 sku', () => {
  it('stableId is deterministic and variant-sensitive', () => {
    assert.equal(stableSkuId('P1', 'V1'), stableSkuId('P1', 'V1'));
    assert.notEqual(stableSkuId('P1', 'V1'), stableSkuId('P1', 'V2'));
    assert.match(stableSkuId('P1', 'V1'), /^SKU_[0-9a-f]{20}$/);
  });
  it('Notebook Powerbank / Black / A5 → SKU-NOTEBOOK-NOTEBOOK-POW-BLK-A5', () => {
    assert.equal(baseDisplayCode(mk({})), 'SKU-NOTEBOOK-NOTEBOOK-POW-BLK-A5');
  });
  it('Vacuum flask / Black / 500ml / SUS304 → modelTok shortened so base ≤ 36', () => {
    const code = baseDisplayCode(mk({ typeId: 'drinkware', englishName: 'Vacuum flask', colors: ['Black'], sizes: ['500ml'], materials: ['SUS304'] }));
    assert.equal(code, 'SKU-DRINKWARE-VACUUM-FL-BLK-500-S304');
    assert.equal(code.length, 36);
  });
  it('no attributes → -STD', () => {
    assert.equal(baseDisplayCode(mk({ colors: [], sizes: [], materials: [] })), 'SKU-NOTEBOOK-NOTEBOOK-POW-STD');
  });
  it('multiple colours → first colour + -MC', () => {
    assert.equal(baseDisplayCode(mk({ colors: ['Black', 'Blue'], sizes: [] })), 'SKU-NOTEBOOK-NOTEBOOK-POW-BLK-MC');
  });
  it('unclassified type → UNCL; Thai-only name → productId hash slice', () => {
    assert.equal(baseDisplayCode(mk({ typeId: null, englishName: 'สมุดโน้ต', colors: [], sizes: [] })), 'SKU-UNCL-00A7D1-STD');
  });
  it('collision suffix ordered by physicalVariantId', () => {
    const a = mk({ physicalVariantId: 'PV_B' }); const b = mk({ physicalVariantId: 'PV_A' });
    const m = assignDisplayCodes([a, b]);
    assert.equal(m.get(stableSkuId(a.productId, 'PV_A')), 'SKU-NOTEBOOK-NOTEBOOK-POW-BLK-A5');
    assert.equal(m.get(stableSkuId(a.productId, 'PV_B')), 'SKU-NOTEBOOK-NOTEBOOK-POW-BLK-A5-2');
  });
  it('≥100 collisions use hash suffix and stay ≤ 40', () => {
    const inputs = Array.from({ length: 120 }, (_, i) => mk({ physicalVariantId: `PV_${String(i).padStart(3, '0')}` }));
    const m = assignDisplayCodes(inputs);
    for (const code of m.values()) assert.ok(code.length <= 40, code);
    assert.match(m.get(stableSkuId(inputs[0].productId, 'PV_119'))!, /^SKU-NOTEBOOK-NOTEBOOK-POW-BLK-A5-[0-9A-F]{4}$/);
  });
  it('property: 500 random long inputs → ≤ 40, uppercase, no spaces, variantTok intact', () => {
    let seed = 7; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const word = (n: number) => Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(rnd() * 26))).join('');
    const inputs: SkuInput[] = [];
    for (let i = 0; i < 500; i++) inputs.push(mk({ physicalVariantId: `PV_${i}`, typeId: word(14), englishName: `${word(20)} ${word(20)} ${word(20)}`, colors: [word(30)], sizes: [`${Math.floor(rnd() * 9999)}ml`], materials: [word(15)] }));
    for (const [, code] of assignDisplayCodes(inputs)) {
      assert.ok(code.length <= 40, code); assert.equal(code, code.toUpperCase()); assert.doesNotMatch(code, /\s/);
    }
  });
  it('changing englishName keeps stableId', () => {
    const a = mk({}); const b = mk({ englishName: 'Renamed' });
    assert.equal(stableSkuId(a.productId, a.physicalVariantId), stableSkuId(b.productId, b.physicalVariantId));
    assert.notEqual(baseDisplayCode(a), baseDisplayCode(b));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/v4-sku.test.ts` → FAIL `Cannot find module`

- [ ] **Step 3: Write minimal implementation**

`src/rag/v4/sku.ts`:
```ts
import { cut, sha1Hex, slug } from './schema.js';

export interface SkuInput {
  productId: string; physicalVariantId: string; typeId: string | null; englishName: string | null;
  colors: string[]; sizes: string[]; materials: string[];
}

export const COLOR_ABBR: Record<string, string> = {
  black: 'BLK', white: 'WHT', blue: 'BLU', red: 'RED', green: 'GRN', gray: 'GRY', grey: 'GRY', gold: 'GLD',
  silver: 'SLV', pink: 'PNK', orange: 'ORG', beige: 'BGE', navy: 'NVY', brown: 'BRN', purple: 'PUR', yellow: 'YEL',
};
export const MATERIAL_ABBR: Record<string, string> = {
  sus304: 'S304', sus316: 'S316', '304 stainless steel': 'S304', '316 stainless steel': 'S316',
  'stainless steel': 'SS', abs: 'ABS', pp: 'PP', pc: 'PC', glass: 'GLS', ceramic: 'CER', leather: 'LTH', 'pu leather': 'PU',
  bamboo: 'BMB', wood: 'WD', silicone: 'SIL', 'wheat straw': 'WHT', cotton: 'CTN', nylon: 'NYL', metal: 'MTL',
};

const BASE_MAX = 36;
const TYPE_MAX = 10, MODEL_MAX = 12, VARIANT_MAX = 12, SIZE_MAX = 5;

export function stableSkuId(productId: string, physicalVariantId: string): string {
  return `SKU_${sha1Hex(`${productId}|${physicalVariantId}`).slice(0, 20)}`;
}

function typeTok(typeId: string | null): string {
  if (!typeId) return 'UNCL';
  return cut(slug(typeId), TYPE_MAX) || 'UNCL';
}
function modelTokFull(input: SkuInput): string {
  const s = input.englishName ? slug(input.englishName) : '';
  if (s) return s;
  return (input.productId.split('_')[1] || input.productId).slice(0, 6).toUpperCase();
}
function colorTok(colors: string[]): string | null {
  if (!colors.length) return null;
  const first = colors[0].trim().toLowerCase();
  const tok = COLOR_ABBR[first] || slug(colors[0]).slice(0, 3);
  return colors.length > 1 ? `${tok}-MC` : tok;
}
function sizeTok(sizes: string[]): string | null {
  if (!sizes.length) return null;
  const s = slug(sizes[0]).replace(/-?(CM|ML|MM)$/g, '');
  return cut(s, SIZE_MAX) || null;
}
function materialTok(materials: string[]): string | null {
  if (!materials.length) return null;
  const key = materials[0].trim().toLowerCase();
  return MATERIAL_ABBR[key] || slug(materials[0]).slice(0, 4) || null;
}
function variantTok(input: SkuInput): string {
  const parts = [colorTok(input.colors), sizeTok(input.sizes), materialTok(input.materials)].filter(Boolean) as string[];
  return cut(parts.join('-'), VARIANT_MAX) || 'STD';
}

/** §5.4: base ≤ 36; if over, only modelTok shrinks; variantTok is never cut by the base budget. */
export function baseDisplayCode(input: SkuInput): string {
  const t = typeTok(input.typeId);
  const v = variantTok(input);
  let m = cut(modelTokFull(input), MODEL_MAX);
  const assemble = () => `SKU-${t}-${m}-${v}`;
  let base = assemble();
  if (base.length > BASE_MAX) {
    const over = base.length - BASE_MAX;
    m = cut(m, Math.max(1, m.length - over));
    base = assemble();
  }
  if (base.length > BASE_MAX) base = cut(base, BASE_MAX); // only reachable with a 1-char modelTok
  return base;
}

export function assignDisplayCodes(inputs: SkuInput[]): Map<string, string> {
  const groups = new Map<string, SkuInput[]>();
  for (const i of inputs) {
    const b = baseDisplayCode(i);
    (groups.get(b) ?? groups.set(b, []).get(b)!).push(i);
  }
  const out = new Map<string, string>();
  for (const [base, members] of groups) {
    members.sort((a, b) => (a.physicalVariantId < b.physicalVariantId ? -1 : a.physicalVariantId > b.physicalVariantId ? 1 : 0));
    members.forEach((m, idx) => {
      const id = stableSkuId(m.productId, m.physicalVariantId);
      if (idx === 0) out.set(id, base);
      else if (idx + 1 <= 99) out.set(id, `${base}-${idx + 1}`);
      else out.set(id, `${cut(base, 35)}-${id.slice(4, 8).toUpperCase()}`);
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/v4-sku.test.ts` → `# pass 10`
(If the Vacuum flask case yields a different string, fix the implementation — the expected string is normative per spec §5.4.)

- [ ] **Step 5: Commit**

```bash
git add src/rag/v4/sku.ts tests/unit/v4-sku.test.ts
git commit -m "feat(catalog-v4): PhysicalSKU stable ids and bounded display codes"
```

---

### Task T3: `flowaccount.ts` — reader, parser, buckets (§5.5, AC-A6)

**Files:**
- Create: `src/rag/v4/flowaccount.ts`
- Create: `tests/fixtures/v4/flowaccount-rows.json` (20 rows covering every bucket)
- Test: `tests/unit/v4-flowaccount.test.ts`

**Interfaces:**
- Produces:
```ts
export interface FlowAccountRow { rowIndex: number; productCode: string; name: string; unit: string | null; category: string | null; unitPrice: number; unitPriceWithVat: number; buyPrice: number }
export type Bucket = 'parsed'|'name_coded'|'unparsed'|'non_giftset'|'blank'|'inactive';
export interface PriceLine { rowIndex: number; bucket: 'parsed'|'name_coded'|'non_giftset'; flowAccountCode: string | null; base: string; priceListGroup: string | null; qtyTier: number | null; unitPrice: number; unitPriceWithVat: number; priceMissing: boolean; flowAccountName: string; category: string | null }
export interface BucketRow { rowIndex: number; bucket: Bucket; reason: string; productCode: string; name: string; unitPrice: number; hasPrice: boolean }
export interface ParsedFlowAccount { lines: PriceLine[]; review: BucketRow[]; counts: Record<Bucket, number>; total: number }
export const CODE_RX: RegExp; export const NAME_RX: RegExp;
export function parseCode(code: string): { base: string; group: string | null; qty: number | null } | null;
export function parseFlowAccountRows(rows: FlowAccountRow[]): ParsedFlowAccount;
export async function readFlowAccountXlsx(path: string): Promise<FlowAccountRow[]>;   // throws FlowAccountSchemaError
export class FlowAccountSchemaError extends Error {}
```

- [ ] **Step 1: Write fixture**

`tests/fixtures/v4/flowaccount-rows.json`:
```json
[
  {"rowIndex":1,"productCode":"TBY01(P-14)-100","name":"เครื่องนวดคอ TBY01(P-14)","unit":"ชุด","category":"Gift Set","unitPrice":490,"unitPriceWithVat":524.3,"buyPrice":0},
  {"rowIndex":2,"productCode":"TBY01(P-14)-10","name":"เครื่องนวดคอ TBY01(P-14)","unit":"ชุด","category":"Gift Set","unitPrice":690,"unitPriceWithVat":738.3,"buyPrice":0},
  {"rowIndex":3,"productCode":"THB03-2(P-20)-500","name":"Vacuum jug+เครื่องนวดคอ THB03-2(P-20)","unit":"ชุด","category":"Gift Set","unitPrice":1020,"unitPriceWithVat":1091.4,"buyPrice":0},
  {"rowIndex":4,"productCode":"TYD0762(P-PT)-10","name":"เครื่องนวดคอ+ที่ใส่ปากกา TYD0762(P-PT)","unit":"ชุด","category":"Gift Set","unitPrice":1180,"unitPriceWithVat":1262.6,"buyPrice":0},
  {"rowIndex":5,"productCode":"TBS01","name":"ขวดแก้วโบโรซิลิเกต + ร่ม","unit":"ชุด","category":"Gift Set","unitPrice":0,"unitPriceWithVat":0,"buyPrice":0},
  {"rowIndex":6,"productCode":"ECO-801-(400)100","name":"กล่องข้าว ECO","unit":"ชุด","category":"Gift Set","unitPrice":265,"unitPriceWithVat":283.55,"buyPrice":0},
  {"rowIndex":7,"productCode":"TFA-2(P-02)-500","name":"ชุดพัดลม TFA-2(P-02)","unit":"ชุด","category":"Gift Set","unitPrice":500,"unitPriceWithVat":535,"buyPrice":0},
  {"rowIndex":8,"productCode":"","name":"ร่ม + ขวดน้ำสูญญากาศ + ปากกา + สมุดโน๊ต A5  TPH00-4(P-06)","unit":"ชุด","category":"Gift Set","unitPrice":1180,"unitPriceWithVat":1262.6,"buyPrice":0},
  {"rowIndex":9,"productCode":"","name":"ไดร์เป่าผม with concentrator nozzle + ร่มอัตโนมัติ TCS00-2","unit":"ชุด","category":"Gift Set","unitPrice":940,"unitPriceWithVat":1005.8,"buyPrice":0},
  {"rowIndex":10,"productCode":"","name":"ชุดของขวัญในกล่องพรีเมี่ยม 2 ชิ้นพร้อมสกรีน Model : VC-002","unit":"ชุด","category":"Gift Set","unitPrice":570,"unitPriceWithVat":609.9,"buyPrice":0},
  {"rowIndex":11,"productCode":"","name":"กล่องไม้","unit":"ชิ้น","category":null,"unitPrice":0,"unitPriceWithVat":0,"buyPrice":0},
  {"rowIndex":12,"productCode":"","name":"สกรีนโลโก้ UV print 1 ตำแหน่ง","unit":null,"category":null,"unitPrice":0,"unitPriceWithVat":0,"buyPrice":0},
  {"rowIndex":13,"productCode":"","name":"แฟลชไดร์ฟ USB 2.0 แบบการ์ด 445 ความจุ 2 GB","unit":null,"category":null,"unitPrice":95,"unitPriceWithVat":101.65,"buyPrice":0},
  {"rowIndex":14,"productCode":"W258","name":"แฟลชไดร์ฟ W258","unit":"ชิ้น","category":"Flash Drive","unitPrice":120,"unitPriceWithVat":128.4,"buyPrice":0},
  {"rowIndex":15,"productCode":"CK-003","name":"Can Cooler","unit":"ชิ้น","category":"Other","unitPrice":350,"unitPriceWithVat":374.5,"buyPrice":0},
  {"rowIndex":16,"productCode":"","name":"**ไม่ใช้งานแล้ว**","unit":"ชิ้น","category":null,"unitPrice":0,"unitPriceWithVat":0,"buyPrice":0},
  {"rowIndex":17,"productCode":"fxd1x-4(P-02)-50","name":"ชุด FXD1X-4","unit":"ชุด","category":"Gift Set","unitPrice":880,"unitPriceWithVat":941.6,"buyPrice":0},
  {"rowIndex":18,"productCode":"TBG03-2(P-2D)-20","name":"ขวดน้ำสูญญากาศ + เครื่องนวดคอ TBG03-2(P-2D)","unit":"ชุด","category":"Gift Set","unitPrice":1240,"unitPriceWithVat":1326.8,"buyPrice":0},
  {"rowIndex":19,"productCode":"DY05601(P-09)-20","name":"เครื่องรีดผ้า DY05601(P-09)","unit":"ชุด","category":"Gift Set","unitPrice":850,"unitPriceWithVat":909.5,"buyPrice":0},
  {"rowIndex":20,"productCode":"TSP07-2(P-06)-10","name":"สมุดโน๊ตอัจฉริยะ + เครื่องนวดคอ TSP07-2(P-06)","unit":"ชุด","category":"Gift Set","unitPrice":2110,"unitPriceWithVat":2257.7,"buyPrice":0}
]
```
Expected buckets for this fixture: parsed 8 (rows 1,2,3,4,5,17,18,20), unparsed 3 (6,7,19), name_coded 2 (8,9), blank 4 (10,11,12,13), non_giftset 2 (14 `W258` matches CODE_RX? — `W258` is 1 letter + 3 digits → **does not** match `[A-Z]{2,4}`; so 14 → non_giftset reason `regex`; 15 `CK-003` → non_giftset reason `regex`), inactive 1 (16). Total 20.

- [ ] **Step 2: Write the failing test**

`tests/unit/v4-flowaccount.test.ts`:
```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCode, parseFlowAccountRows, readFlowAccountXlsx, FlowAccountSchemaError, type FlowAccountRow } from '../../src/rag/v4/flowaccount.js';

const rows: FlowAccountRow[] = JSON.parse(fs.readFileSync(new URL('../fixtures/v4/flowaccount-rows.json', import.meta.url), 'utf8'));

describe('v4 flowaccount parseCode', () => {
  it('parses code, group and qty', () => {
    assert.deepEqual(parseCode('TBY01(P-14)-100'), { base: 'TBY01', group: 'P-14', qty: 100 });
    assert.deepEqual(parseCode('THB03-2(P-20)-500'), { base: 'THB03-2', group: 'P-20', qty: 500 });
    assert.deepEqual(parseCode('TYD0762(P-PT)-10'), { base: 'TYD0762', group: 'P-PT', qty: 10 });
    assert.deepEqual(parseCode('TBS01'), { base: 'TBS01', group: null, qty: null });
    assert.deepEqual(parseCode(' fxd1x-4(P-02)-50 '), { base: 'FXD1X-4', group: 'P-02', qty: 50 });
  });
  it('rejects the known unparseable shapes', () => {
    for (const c of ['ECO-801-(400)100', 'TFA-2(P-02)-500', 'DY05601(P-09)-20', 'W258', 'CK-003']) assert.equal(parseCode(c), null, c);
  });
});

describe('v4 flowaccount buckets', () => {
  const parsed = parseFlowAccountRows(rows);
  it('buckets sum to input count', () => {
    assert.equal(parsed.total, rows.length);
    assert.deepEqual(parsed.counts, { parsed: 8, name_coded: 2, unparsed: 3, non_giftset: 2, blank: 4, inactive: 1 });
    const sum = Object.values(parsed.counts).reduce((a, b) => a + b, 0);
    assert.equal(sum, rows.length);
  });
  it('name_coded rows carry the code from the end of the name and qtyTier null', () => {
    const l = parsed.lines.find((x) => x.rowIndex === 8)!;
    assert.equal(l.bucket, 'name_coded'); assert.equal(l.base, 'TPH00-4'); assert.equal(l.priceListGroup, 'P-06'); assert.equal(l.qtyTier, null); assert.equal(l.flowAccountCode, null);
    const l9 = parsed.lines.find((x) => x.rowIndex === 9)!;
    assert.equal(l9.base, 'TCS00-2'); assert.equal(l9.priceListGroup, null);
  });
  it('blank Gift Set row with a price is flagged for review', () => {
    const r = parsed.review.find((x) => x.rowIndex === 10)!;
    assert.equal(r.bucket, 'blank'); assert.equal(r.hasPrice, true);
  });
  it('inactive rows are counted, not parsed', () => {
    assert.equal(parsed.review.find((x) => x.rowIndex === 16)!.bucket, 'inactive');
    assert.ok(!parsed.lines.some((x) => x.rowIndex === 16));
  });
  it('UnitPrice 0 → priceMissing', () => {
    assert.equal(parsed.lines.find((x) => x.rowIndex === 5)!.priceMissing, true);
    assert.equal(parsed.lines.find((x) => x.rowIndex === 1)!.priceMissing, false);
  });
  it('every unparsed row has a reason', () => {
    for (const r of parsed.review.filter((x) => x.bucket === 'unparsed')) assert.equal(r.reason, 'regex');
  });
});

describe('v4 flowaccount xlsx reader', () => {
  it('throws FlowAccountSchemaError on a workbook without the expected header', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('products');
    ws.addRow(['wrong']); ws.addRow([]); ws.addRow(['A', 'B']);
    const tmp = `${process.env.TEMP || '/tmp'}/v4-bad-${Date.now()}.xlsx`; await wb.xlsx.writeFile(tmp);
    await assert.rejects(() => readFlowAccountXlsx(tmp), FlowAccountSchemaError);
  });
  it('reads a minimal valid workbook (header on row 3)', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('products');
    ws.addRow(['รายการสินค้า']); ws.addRow([]);
    ws.addRow(['BarCode', 'ProductCode', 'Name', 'Unit', 'Category', 'Description', 'UnitPrice', 'UnitPriceWithVat', 'BuyPrice', 'BuyPriceWithVat']);
    ws.addRow(['', 'TBY01(P-14)-100', 'เครื่องนวดคอ TBY01(P-14)', 'ชุด', 'Gift Set', '', 490, 524.3, 0, 0]);
    const tmp = `${process.env.TEMP || '/tmp'}/v4-ok-${Date.now()}.xlsx`; await wb.xlsx.writeFile(tmp);
    const got = await readFlowAccountXlsx(tmp);
    assert.equal(got.length, 1); assert.equal(got[0].productCode, 'TBY01(P-14)-100'); assert.equal(got[0].unitPrice, 490); assert.equal(got[0].rowIndex, 4);
  });
});
```

- [ ] **Step 3: Run test to verify it fails** → `Cannot find module '../../src/rag/v4/flowaccount.js'`

- [ ] **Step 4: Write implementation**

`src/rag/v4/flowaccount.ts`:
```ts
import ExcelJS from 'exceljs';

export interface FlowAccountRow {
  rowIndex: number; productCode: string; name: string; unit: string | null; category: string | null;
  unitPrice: number; unitPriceWithVat: number; buyPrice: number;
}
export type Bucket = 'parsed' | 'name_coded' | 'unparsed' | 'non_giftset' | 'blank' | 'inactive';
export interface PriceLine {
  rowIndex: number; bucket: 'parsed' | 'name_coded' | 'non_giftset'; flowAccountCode: string | null; base: string;
  priceListGroup: string | null; qtyTier: number | null; unitPrice: number; unitPriceWithVat: number;
  priceMissing: boolean; flowAccountName: string; category: string | null;
}
export interface BucketRow { rowIndex: number; bucket: Bucket; reason: string; productCode: string; name: string; unitPrice: number; hasPrice: boolean }
export interface ParsedFlowAccount { lines: PriceLine[]; review: BucketRow[]; counts: Record<Bucket, number>; total: number }

export class FlowAccountSchemaError extends Error {}

export const CODE_RX = /^(?<base>[A-Z]{2,4}\d{1,4}[A-Z]?(?:-\d)?)\s*(?:\((?<group>P-[^)]+)\))?\s*-?\s*(?<qty>\d+)?\s*$/;  // [A-Z]? admits FXD1X-4 style codes (ProductCode column only)
export const NAME_RX = /(?<base>[A-Z]{2,4}\d{1,4}(?:-\d)?)\s*(?:\((?<group>P-[^)]+)\)?)?\s*$/;

const GIFT_SET = 'Gift Set';
const INACTIVE_MARK = 'ไม่ใช้งาน';

export function parseCode(code: string): { base: string; group: string | null; qty: number | null } | null {
  const m = CODE_RX.exec(code.trim().toUpperCase());
  if (!m || !m.groups) return null;
  return { base: m.groups.base, group: m.groups.group ?? null, qty: m.groups.qty ? Number(m.groups.qty) : null };
}

function codeFromName(name: string): { base: string; group: string | null } | null {
  const m = NAME_RX.exec(name.trim().toUpperCase());
  if (!m || !m.groups) return null;
  return { base: m.groups.base, group: m.groups.group ?? null };
}

export function parseFlowAccountRows(rows: FlowAccountRow[]): ParsedFlowAccount {
  const lines: PriceLine[] = []; const review: BucketRow[] = [];
  const counts: Record<Bucket, number> = { parsed: 0, name_coded: 0, unparsed: 0, non_giftset: 0, blank: 0, inactive: 0 };
  const note = (r: FlowAccountRow, bucket: Bucket, reason: string) => {
    counts[bucket]++;
    review.push({ rowIndex: r.rowIndex, bucket, reason, productCode: r.productCode, name: r.name, unitPrice: r.unitPrice, hasPrice: r.unitPrice > 0 });
  };
  for (const r of rows) {
    if (r.name.includes(INACTIVE_MARK)) { note(r, 'inactive', 'inactive_mark'); continue; }
    const code = (r.productCode || '').trim();
    const isGift = r.category === GIFT_SET;
    if (code) {
      const p = parseCode(code);
      if (!p) { note(r, isGift ? 'unparsed' : 'non_giftset', 'regex'); continue; }
      const bucket: PriceLine['bucket'] = isGift ? 'parsed' : 'non_giftset';
      counts[bucket]++;
      lines.push({ rowIndex: r.rowIndex, bucket, flowAccountCode: code.toUpperCase(), base: p.base, priceListGroup: p.group, qtyTier: p.qty,
        unitPrice: r.unitPrice, unitPriceWithVat: r.unitPriceWithVat, priceMissing: !(r.unitPrice > 0), flowAccountName: r.name, category: r.category });
      continue;
    }
    const fromName = isGift ? codeFromName(r.name) : null;
    if (fromName) {
      counts.name_coded++;
      lines.push({ rowIndex: r.rowIndex, bucket: 'name_coded', flowAccountCode: null, base: fromName.base, priceListGroup: fromName.group, qtyTier: null,
        unitPrice: r.unitPrice, unitPriceWithVat: r.unitPriceWithVat, priceMissing: !(r.unitPrice > 0), flowAccountName: r.name, category: r.category });
      continue;
    }
    note(r, 'blank', 'no_code');
  }
  return { lines, review, counts, total: rows.length };
}

const HEADER = ['BarCode', 'ProductCode', 'Name', 'Unit', 'Category', 'Description', 'UnitPrice', 'UnitPriceWithVat', 'BuyPrice', 'BuyPriceWithVat'];

export async function readFlowAccountXlsx(path: string): Promise<FlowAccountRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet('products') ?? wb.worksheets[0];
  if (!ws) throw new FlowAccountSchemaError('no worksheet');
  const header = (ws.getRow(3).values as unknown[]).slice(1).map((v) => String(v ?? '').trim());
  if (HEADER.some((h, i) => header[i] !== h)) throw new FlowAccountSchemaError(`unexpected header row 3: ${header.join(',')}`);
  const rows: FlowAccountRow[] = [];
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, '')) || 0);
  const str = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' && 'text' in (v as object) ? String((v as { text: unknown }).text) : String(v));
  ws.eachRow((row, idx) => {
    if (idx <= 3) return;
    const v = row.values as unknown[];
    const name = str(v[3]).trim();
    if (!name) return;
    rows.push({ rowIndex: idx, productCode: str(v[2]).trim(), name, unit: str(v[4]).trim() || null, category: str(v[5]).trim() || null,
      unitPrice: num(v[7]), unitPriceWithVat: num(v[8]), buyPrice: num(v[9]) });
  });
  return rows;
}
```

- [ ] **Step 5: Run test** → `# pass 10`. If `W258`/`CK-003` parse unexpectedly, the regex is wrong — fix regex, not the test.

- [ ] **Step 6: Verify against the real file (required for AC-A6)**

```bash
node --import tsx -e "import('./src/rag/v4/flowaccount.js').then(async m=>{const r=await m.readFlowAccountXlsx(process.env.ZURI_DATA_ROOT+'/source/flowaccount-product-2026-06-21.xlsx');const p=m.parseFlowAccountRows(r);console.log(p.total,p.counts)})"
```
Expected: `1319 { parsed: 554, name_coded: 102, unparsed: 14, non_giftset: 4, blank: 643, inactive: 2 }` (total 1,319 incl. 2 inactive = 1,317 active). If numbers differ, stop and report — do not adjust the spec.

- [ ] **Step 7: Commit**

```bash
git add src/rag/v4/flowaccount.ts tests/unit/v4-flowaccount.test.ts tests/fixtures/v4/flowaccount-rows.json
git commit -m "feat(catalog-v4): FlowAccount price-line parser with exhaustive buckets"
```

---

### Task T4: config — category map + aliases + validators (§5.3, AC-A4)

**Files:**
- Create: `src/rag/v4/config/category-group-map.v1.json`, `src/rag/v4/config/product-type-aliases.v1.json`, `src/rag/v4/config.ts`
- Test: `tests/unit/v4-config.test.ts`

**Interfaces:**
```ts
export interface CategoryGroupMap { version: 'v1'; groups: Array<{ id: string; name_th: string; name_en: string; order: number }>; typeToGroup: Record<string, string> }
export interface TypeAlias { typeId: string; name_th: string; name_en: string; aliases_th: string[]; aliases_en: string[] }
export interface TypeAliases { version: 'v1'; types: TypeAlias[] }
export function validateCategoryGroupMap(map: CategoryGroupMap, observedTypeIds: string[]): void;  // throws Error listing missing/duplicate/unknown-group
export function validateTypeAliases(a: TypeAliases, observedTypeIds: string[]): void;
export function loadCategoryGroupMap(): CategoryGroupMap; export function loadTypeAliases(): TypeAliases;  // read from ./config via import.meta.url
export function aliasIndex(a: TypeAliases): Map<string /*lowercased alias*/, string /*typeId*/>;
```

- [ ] **Step 1: Write config JSON**

`src/rag/v4/config/category-group-map.v1.json`:
```json
{
  "version": "v1",
  "groups": [
    { "id": "smart_tech", "name_th": "Smart Tech & Gadgets", "name_en": "Smart Tech & Gadgets", "order": 1 },
    { "id": "care_wellness", "name_th": "Care & Wellness", "name_en": "Care & Wellness", "order": 2 },
    { "id": "office", "name_th": "Smart Work & Office", "name_en": "Smart Work & Office Stationery", "order": 3 },
    { "id": "home_travel", "name_th": "Home & Travel Lifestyle", "name_en": "Home & Travel Lifestyle", "order": 4 }
  ],
  "typeToGroup": {
    "power_bank": "smart_tech", "usb_flash_drive": "smart_tech", "charger": "smart_tech", "speaker": "smart_tech", "earbuds": "smart_tech",
    "earphone": "smart_tech", "headset": "smart_tech", "mouse": "smart_tech", "keyboard": "smart_tech", "smart_bracelet": "smart_tech", "car_accessory": "smart_tech",
    "neck_massager": "care_wellness", "massage_gun": "care_wellness", "massage_comb": "care_wellness", "hair_dryer": "care_wellness",
    "humidifier": "care_wellness", "fan": "care_wellness", "glove": "care_wellness", "towel": "care_wellness", "nail_clipper": "care_wellness",
    "notebook": "office", "notebook_refill": "office", "pen": "office", "bookmark": "office", "name_card_holder": "office",
    "briefcase": "office", "key_chain": "office", "lighter": "office",
    "drinkware": "home_travel", "coffee_maker": "home_travel", "umbrella": "home_travel", "bag": "home_travel"
  }
}
```

`src/rag/v4/config/product-type-aliases.v1.json` — 32 entries; seed Thai aliases from `src/rag/taxonomy-serving.ts` `QUERY_CATEGORY_ALIASES` and add English names. Full content (write all 32):
```json
{ "version": "v1", "types": [
  { "typeId": "power_bank", "name_th": "พาวเวอร์แบงก์", "name_en": "Power bank", "aliases_th": ["พาวเวอร์แบงค์", "แบตสำรอง", "แบตเตอรี่สำรอง"], "aliases_en": ["power bank", "powerbank"] },
  { "typeId": "usb_flash_drive", "name_th": "แฟลชไดรฟ์", "name_en": "USB flash drive", "aliases_th": ["แฟลชไดร์ฟ", "ยูเอสบี", "แฟลชไดร์ฟ์"], "aliases_en": ["flash drive", "usb"] },
  { "typeId": "charger", "name_th": "ที่ชาร์จ", "name_en": "Charger", "aliases_th": ["แท่นชาร์จ", "หัวชาร์จ", "สายชาร์จ"], "aliases_en": ["charger", "charging"] },
  { "typeId": "speaker", "name_th": "ลำโพง", "name_en": "Speaker", "aliases_th": ["ลำโพงบลูทูธ"], "aliases_en": ["speaker"] },
  { "typeId": "earbuds", "name_th": "หูฟังไร้สาย", "name_en": "Earbuds", "aliases_th": ["เอียร์บัด", "หูฟัง"], "aliases_en": ["earbuds", "tws"] },
  { "typeId": "earphone", "name_th": "หูฟัง", "name_en": "Earphone", "aliases_th": ["หูฟังมีสาย"], "aliases_en": ["earphone"] },
  { "typeId": "headset", "name_th": "เฮดเซ็ต", "name_en": "Headset", "aliases_th": ["หูฟังครอบหู"], "aliases_en": ["headset", "headphone"] },
  { "typeId": "mouse", "name_th": "เมาส์", "name_en": "Mouse", "aliases_th": ["เม้าส์"], "aliases_en": ["mouse"] },
  { "typeId": "keyboard", "name_th": "คีย์บอร์ด", "name_en": "Keyboard", "aliases_th": ["แป้นพิมพ์"], "aliases_en": ["keyboard"] },
  { "typeId": "smart_bracelet", "name_th": "สายรัดข้อมืออัจฉริยะ", "name_en": "Smart bracelet", "aliases_th": ["กำไลอัจฉริยะ", "สมาร์ทวอทช์"], "aliases_en": ["smart bracelet", "smart band"] },
  { "typeId": "car_accessory", "name_th": "อุปกรณ์ในรถ", "name_en": "Car accessory", "aliases_th": ["ของใช้ในรถ"], "aliases_en": ["car"] },
  { "typeId": "neck_massager", "name_th": "เครื่องนวดคอ", "name_en": "Neck massager", "aliases_th": ["ที่นวดคอ"], "aliases_en": ["neck massager"] },
  { "typeId": "massage_gun", "name_th": "ปืนนวด", "name_en": "Massage gun", "aliases_th": [], "aliases_en": ["massage gun"] },
  { "typeId": "massage_comb", "name_th": "หวีนวด", "name_en": "Massage comb", "aliases_th": [], "aliases_en": ["massage comb"] },
  { "typeId": "hair_dryer", "name_th": "ไดร์เป่าผม", "name_en": "Hair dryer", "aliases_th": ["ไดร์"], "aliases_en": ["hair dryer"] },
  { "typeId": "humidifier", "name_th": "เครื่องทำความชื้น", "name_en": "Humidifier", "aliases_th": ["เครื่องเพิ่มความชื้น"], "aliases_en": ["humidifier"] },
  { "typeId": "fan", "name_th": "พัดลม", "name_en": "Fan", "aliases_th": ["พัดลมพกพา"], "aliases_en": ["fan"] },
  { "typeId": "glove", "name_th": "ถุงมือ", "name_en": "Glove", "aliases_th": [], "aliases_en": ["glove"] },
  { "typeId": "towel", "name_th": "ผ้าเช็ดตัว", "name_en": "Towel", "aliases_th": ["ผ้าขนหนู"], "aliases_en": ["towel"] },
  { "typeId": "nail_clipper", "name_th": "กรรไกรตัดเล็บ", "name_en": "Nail clipper", "aliases_th": ["ที่ตัดเล็บ"], "aliases_en": ["nail clipper"] },
  { "typeId": "notebook", "name_th": "สมุดโน้ต", "name_en": "Notebook", "aliases_th": ["สมุด", "สมุดโน๊ต", "ไดอารี่"], "aliases_en": ["notebook", "diary"] },
  { "typeId": "notebook_refill", "name_th": "ไส้สมุด", "name_en": "Notebook refill", "aliases_th": [], "aliases_en": ["refill"] },
  { "typeId": "pen", "name_th": "ปากกา", "name_en": "Pen", "aliases_th": [], "aliases_en": ["pen"] },
  { "typeId": "bookmark", "name_th": "ที่คั่นหนังสือ", "name_en": "Bookmark", "aliases_th": [], "aliases_en": ["bookmark"] },
  { "typeId": "name_card_holder", "name_th": "ที่ใส่นามบัตร", "name_en": "Name card holder", "aliases_th": ["กล่องนามบัตร"], "aliases_en": ["card holder"] },
  { "typeId": "briefcase", "name_th": "กระเป๋าเอกสาร", "name_en": "Briefcase", "aliases_th": [], "aliases_en": ["briefcase"] },
  { "typeId": "key_chain", "name_th": "พวงกุญแจ", "name_en": "Key chain", "aliases_th": [], "aliases_en": ["keychain", "key chain"] },
  { "typeId": "lighter", "name_th": "ไฟแช็ก", "name_en": "Lighter", "aliases_th": ["ไฟแช็ค"], "aliases_en": ["lighter"] },
  { "typeId": "drinkware", "name_th": "แก้วน้ำ", "name_en": "Drinkware", "aliases_th": ["แก้ว", "แก้วกาแฟ", "กระบอกน้ำ", "ขวดน้ำ", "กระติก", "กระติกน้ำ", "แก้วมัค", "ทัมเบลอร์"], "aliases_en": ["mug", "cup", "bottle", "tumbler", "flask", "drinkware"] },
  { "typeId": "coffee_maker", "name_th": "เครื่องชงกาแฟ", "name_en": "Coffee maker", "aliases_th": [], "aliases_en": ["coffee maker"] },
  { "typeId": "umbrella", "name_th": "ร่ม", "name_en": "Umbrella", "aliases_th": ["ร่มพับ"], "aliases_en": ["umbrella"] },
  { "typeId": "bag", "name_th": "กระเป๋า", "name_en": "Bag", "aliases_th": ["กระเป๋าผ้า", "เป้"], "aliases_en": ["bag", "backpack", "tote"] }
] }
```

- [ ] **Step 2: Write the failing test**

`tests/unit/v4-config.test.ts`:
```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadCategoryGroupMap, loadTypeAliases, validateCategoryGroupMap, validateTypeAliases, aliasIndex } from '../../src/rag/v4/config.js';

const OBSERVED = ['power_bank','usb_flash_drive','charger','speaker','earbuds','earphone','headset','mouse','keyboard','smart_bracelet','car_accessory',
  'neck_massager','massage_gun','massage_comb','hair_dryer','humidifier','fan','glove','towel','nail_clipper',
  'notebook','notebook_refill','pen','bookmark','name_card_holder','briefcase','key_chain','lighter','drinkware','coffee_maker','umbrella','bag'];

describe('v4 config', () => {
  it('shipped category map covers all 32 observed typeIds', () => {
    assert.equal(OBSERVED.length, 32);
    assert.doesNotThrow(() => validateCategoryGroupMap(loadCategoryGroupMap(), OBSERVED));
  });
  it('missing type → error naming it', () => {
    const m = loadCategoryGroupMap(); const copy = { ...m, typeToGroup: { ...m.typeToGroup } }; delete copy.typeToGroup.lighter;
    assert.throws(() => validateCategoryGroupMap(copy, OBSERVED), /lighter/);
  });
  it('unknown group → error', () => {
    const m = loadCategoryGroupMap(); const copy = { ...m, typeToGroup: { ...m.typeToGroup, pen: 'nope' } };
    assert.throws(() => validateCategoryGroupMap(copy, OBSERVED), /nope/);
  });
  it('aliases cover 32 types with name_th and at least one Thai alias or name', () => {
    const a = loadTypeAliases();
    assert.doesNotThrow(() => validateTypeAliases(a, OBSERVED));
    const idx = aliasIndex(a);
    assert.equal(idx.get('แก้ว'), 'drinkware'); assert.equal(idx.get('ร่ม'), 'umbrella'); assert.equal(idx.get('mug'), 'drinkware');
  });
  it('duplicate alias across types → error', () => {
    const a = loadTypeAliases(); const copy = { ...a, types: a.types.map((t) => (t.typeId === 'pen' ? { ...t, aliases_th: [...t.aliases_th, 'แก้ว'] } : t)) };
    assert.throws(() => validateTypeAliases(copy, OBSERVED), /แก้ว/);
  });
});
```

- [ ] **Step 3: Run → fails (module missing)**

- [ ] **Step 4: Implement `src/rag/v4/config.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CategoryGroupMap { version: 'v1'; groups: Array<{ id: string; name_th: string; name_en: string; order: number }>; typeToGroup: Record<string, string> }
export interface TypeAlias { typeId: string; name_th: string; name_en: string; aliases_th: string[]; aliases_en: string[] }
export interface TypeAliases { version: 'v1'; types: TypeAlias[] }

const CONFIG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config');
export const CATEGORY_MAP_FILE = path.join(CONFIG_DIR, 'category-group-map.v1.json');
export const TYPE_ALIASES_FILE = path.join(CONFIG_DIR, 'product-type-aliases.v1.json');

export function loadCategoryGroupMap(): CategoryGroupMap { return JSON.parse(fs.readFileSync(CATEGORY_MAP_FILE, 'utf8')); }
export function loadTypeAliases(): TypeAliases { return JSON.parse(fs.readFileSync(TYPE_ALIASES_FILE, 'utf8')); }

export function validateCategoryGroupMap(map: CategoryGroupMap, observedTypeIds: string[]): void {
  const groupIds = new Set(map.groups.map((g) => g.id));
  if (groupIds.size !== 4) throw new Error(`category-group-map must define exactly 4 groups, got ${groupIds.size}`);
  const missing = observedTypeIds.filter((t) => !(t in map.typeToGroup));
  if (missing.length) throw new Error(`category-group-map missing typeIds: ${missing.join(', ')}`);
  for (const [t, g] of Object.entries(map.typeToGroup)) if (!groupIds.has(g)) throw new Error(`typeId ${t} maps to unknown group ${g}`);
}

export function validateTypeAliases(a: TypeAliases, observedTypeIds: string[]): void {
  const have = new Set(a.types.map((t) => t.typeId));
  const missing = observedTypeIds.filter((t) => !have.has(t));
  if (missing.length) throw new Error(`product-type-aliases missing typeIds: ${missing.join(', ')}`);
  const seen = new Map<string, string>();
  for (const t of a.types) {
    if (!t.name_th) throw new Error(`type ${t.typeId} has no name_th`);
    for (const al of [t.name_th, ...t.aliases_th, ...t.aliases_en, t.name_en.toLowerCase()]) {
      const k = al.normalize('NFKC').toLowerCase().trim();
      const prev = seen.get(k);
      if (prev && prev !== t.typeId) throw new Error(`alias "${al}" claimed by ${prev} and ${t.typeId}`);
      seen.set(k, t.typeId);
    }
  }
}

export function aliasIndex(a: TypeAliases): Map<string, string> {
  const idx = new Map<string, string>();
  for (const t of a.types) for (const al of [t.name_th, t.name_en, ...t.aliases_th, ...t.aliases_en]) idx.set(al.normalize('NFKC').toLowerCase().trim(), t.typeId);
  return idx;
}
```

- [ ] **Step 5: Run → `# pass 5`.** If the duplicate-alias test fails because two shipped types share an alias, fix the JSON (each alias belongs to exactly one type).

- [ ] **Step 6: Commit** `git add src/rag/v4/config src/rag/v4/config.ts tests/unit/v4-config.test.ts && git commit -m "feat(catalog-v4): category-group map and product-type aliases with validators"`

---

### Task T5: `query-parser.ts` (§5.7 step 1, AC-C3/C4)

**Files:** Create `src/rag/v4/query-parser.ts`; Test `tests/unit/v4-query-parser.test.ts`

**Interfaces:**
```ts
export interface ParsedQuery { cleanText: string; excludeTypes: string[]; qty: number | null; budgetPerUnit: number | null; budgetTotal: number | null }
export function parseQuery(text: string, aliases: Map<string, string>): ParsedQuery;
```

- [ ] **Step 1: Failing test**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../../src/rag/v4/query-parser.js';
import { aliasIndex, loadTypeAliases } from '../../src/rag/v4/config.js';

const idx = aliasIndex(loadTypeAliases());
describe('v4 query parser', () => {
  it('negative + budget', () => {
    const p = parseQuery('ของขวัญดูดี ไม่ใช่แก้ว งบ 200 บาท', idx);
    assert.deepEqual(p.excludeTypes, ['drinkware']); assert.equal(p.budgetPerUnit, 200); assert.equal(p.qty, null); assert.equal(p.cleanText, 'ของขวัญดูดี');
  });
  it('two negatives + qty', () => {
    const p = parseQuery('ไม่เอาร่ม ไม่เอาปากกา 100 ชิ้น', idx);
    assert.deepEqual(p.excludeTypes, ['umbrella', 'pen']); assert.equal(p.qty, 100);
  });
  it('total budget with headcount becomes per-unit', () => {
    const p = parseQuery('งบ 20,000 สำหรับ 100 คน', idx);
    assert.equal(p.qty, 100); assert.equal(p.budgetTotal, 20000); assert.equal(p.budgetPerUnit, 200);
  });
  it('bare number without unit is not qty', () => {
    assert.equal(parseQuery('powerbank 20000', idx).qty, null);
  });
  it('ไม่เกิน budget', () => { assert.equal(parseQuery('งบไม่เกิน 1,500', idx).budgetPerUnit, 1500); });
  it('no keywords → passthrough', () => {
    const p = parseQuery('แก้วน้ำมีกี่สี', idx);
    assert.deepEqual(p.excludeTypes, []); assert.equal(p.qty, null); assert.equal(p.budgetPerUnit, null); assert.equal(p.cleanText, 'แก้วน้ำมีกี่สี');
  });
});
```

- [ ] **Step 2: Run → fails**

- [ ] **Step 3: Implement**

```ts
export interface ParsedQuery { cleanText: string; excludeTypes: string[]; qty: number | null; budgetPerUnit: number | null; budgetTotal: number | null }

const NEG = ['ไม่ใช่', 'ไม่เอา', 'ยกเว้น', 'ไม่รวม', 'ไม่ต้องการ', 'not ', 'no '];
const QTY_RX = /(\d[\d,]*)\s*(ชิ้น|ชุด|อัน|คน|ท่าน|pcs|sets?)\b/iu;
const BUDGET_RX = /(?:งบ(?:ประมาณ)?|ไม่เกิน|budget|ราคาไม่เกิน)\s*(?:ไม่เกิน\s*)?(\d[\d,]*)\s*(?:บาท|฿|thb)?/iu;
const num = (s: string) => Number(s.replace(/,/g, ''));

export function parseQuery(text: string, aliases: Map<string, string>): ParsedQuery {
  let clean = text.normalize('NFKC');
  const excludeTypes: string[] = [];
  // longest alias first so "แก้วกาแฟ" wins over "แก้ว"
  const keys = [...aliases.keys()].sort((a, b) => b.length - a.length);
  for (const neg of NEG) {
    let at = clean.toLowerCase().indexOf(neg);
    while (at >= 0) {
      const after = clean.slice(at + neg.length).trimStart();
      const hit = keys.find((k) => after.toLowerCase().startsWith(k));
      if (hit) {
        const t = aliases.get(hit)!;
        if (!excludeTypes.includes(t)) excludeTypes.push(t);
        const start = at; const end = at + neg.length + (clean.slice(at + neg.length).length - after.length) + hit.length;
        clean = clean.slice(0, start) + ' ' + clean.slice(end);
        at = clean.toLowerCase().indexOf(neg);
      } else at = clean.toLowerCase().indexOf(neg, at + neg.length);
    }
  }
  let qty: number | null = null;
  const q = QTY_RX.exec(clean);
  if (q) { qty = num(q[1]); clean = clean.replace(q[0], ' '); }
  let budgetPerUnit: number | null = null; let budgetTotal: number | null = null;
  const b = BUDGET_RX.exec(clean);
  if (b) {
    const v = num(b[1]); clean = clean.replace(b[0], ' ');
    if (qty && v >= 20 * qty) { budgetTotal = v; budgetPerUnit = Math.floor(v / qty); } else budgetPerUnit = v;
  }
  clean = clean.replace(/\b(สำหรับ|บาท|฿)\b/gu, ' ').replace(/\s+/g, ' ').trim();
  return { cleanText: clean || text.trim(), excludeTypes, qty, budgetPerUnit, budgetTotal };
}
```

- [ ] **Step 4: Run → `# pass 6`** (adjust cleanup regex until `cleanText` equals `ของขวัญดูดี` exactly; the expected values are normative).

- [ ] **Step 5: Commit** `git add src/rag/v4/query-parser.ts tests/unit/v4-query-parser.test.ts && git commit -m "feat(catalog-v4): rule-based query parser for exclusions, qty and budget"`

---

### Task T6: `http-client.ts` + `embed-client.ts` (§5.6, §5.9, AC-D6)

**Files:** Create `src/rag/v4/http-client.ts`, `src/rag/v4/embed-client.ts`; Test `tests/unit/v4-clients.test.ts`

**Interfaces:**
```ts
export class RagUnavailableError extends Error { constructor(public reason: string, message?: string) }
export async function fetchJson<T>(url: string, init: { method?: 'GET'|'POST'; body?: unknown; timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<T>;  // throws RagUnavailableError('econnrefused'|'timeout'|'http_<status>'|'bad_json')
export interface EmbedClient { embed(texts: string[], kind: 'query'|'passage'): Promise<number[][]>; health(): Promise<{ ok: boolean; model?: string; revision?: string }> }
export function createEmbedClient(baseUrl: string, opts?: { timeoutMs?: number; fetchImpl?: typeof fetch }): EmbedClient;
```

- [ ] **Step 1: Failing test**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, RagUnavailableError } from '../../src/rag/v4/http-client.js';
import { createEmbedClient } from '../../src/rag/v4/embed-client.js';

const fake = (handler: (url: string, init: RequestInit) => Promise<Response> | Response) => (async (u: string | URL | Request, i?: RequestInit) => handler(String(u), i ?? {})) as typeof fetch;

describe('v4 http-client', () => {
  it('returns parsed JSON on 200', async () => {
    const r = await fetchJson<{ a: number }>('http://x/y', { fetchImpl: fake(() => new Response(JSON.stringify({ a: 1 }), { status: 200 })) });
    assert.deepEqual(r, { a: 1 });
  });
  it('maps non-2xx to RagUnavailableError(http_<status>)', async () => {
    await assert.rejects(fetchJson('http://x', { fetchImpl: fake(() => new Response('', { status: 503 })) }), (e: RagUnavailableError) => e.reason === 'http_503');
  });
  it('maps connection errors', async () => {
    await assert.rejects(fetchJson('http://x', { fetchImpl: fake(() => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); }) }), (e: RagUnavailableError) => e.reason === 'econnrefused');
  });
  it('times out', async () => {
    await assert.rejects(fetchJson('http://x', { timeoutMs: 20, fetchImpl: fake((_u, i) => new Promise((_r, rej) => i.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))) ) }), (e: RagUnavailableError) => e.reason === 'timeout');
  });
});

describe('v4 embed-client', () => {
  it('posts texts with kind and returns vectors', async () => {
    let seen: unknown;
    const c = createEmbedClient('http://e', { fetchImpl: fake((u, i) => { seen = { u, body: JSON.parse(String(i.body)) }; return new Response(JSON.stringify({ vectors: [[0.1, 0.2]], model: 'm', revision: 'r' })); }) });
    const v = await c.embed(['a'], 'query');
    assert.deepEqual(v, [[0.1, 0.2]]); assert.deepEqual(seen, { u: 'http://e/embed', body: { texts: ['a'], kind: 'query' } });
  });
  it('health false on failure', async () => {
    const c = createEmbedClient('http://e', { fetchImpl: fake(() => { throw new Error('x'); }) });
    assert.equal((await c.health()).ok, false);
  });
});
```

- [ ] **Step 2: Run → fails**

- [ ] **Step 3: Implement**

`src/rag/v4/http-client.ts`:
```ts
export class RagUnavailableError extends Error {
  constructor(public reason: string, message?: string) { super(message ?? `rag_unavailable: ${reason}`); this.name = 'RagUnavailableError'; }
}
export async function fetchJson<T>(url: string, init: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<T> {
  const f = init.fetchImpl ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), init.timeoutMs ?? 3000);
  try {
    const res = await f(url, { method: init.method ?? (init.body === undefined ? 'GET' : 'POST'), headers: { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: ctl.signal });
    if (!res.ok) throw new RagUnavailableError(`http_${res.status}`);
    try { return (await res.json()) as T; } catch { throw new RagUnavailableError('bad_json'); }
  } catch (e: unknown) {
    if (e instanceof RagUnavailableError) throw e;
    const err = e as { name?: string; code?: string; cause?: { code?: string } };
    if (err.name === 'AbortError') throw new RagUnavailableError('timeout');
    const code = err.code ?? err.cause?.code ?? '';
    throw new RagUnavailableError(code ? code.toLowerCase() : 'network', (e as Error).message);
  } finally { clearTimeout(timer); }
}
```
`src/rag/v4/embed-client.ts`:
```ts
import { fetchJson } from './http-client.js';
export interface EmbedClient { embed(texts: string[], kind: 'query' | 'passage'): Promise<number[][]>; health(): Promise<{ ok: boolean; model?: string; revision?: string }> }
export function createEmbedClient(baseUrl: string, opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): EmbedClient {
  const base = baseUrl.replace(/\/$/, '');
  return {
    async embed(texts, kind) {
      const r = await fetchJson<{ vectors: number[][] }>(`${base}/embed`, { body: { texts, kind }, timeoutMs: opts.timeoutMs ?? 30000, fetchImpl: opts.fetchImpl });
      return r.vectors;
    },
    async health() {
      try { const r = await fetchJson<{ model: string; revision: string }>(`${base}/health`, { timeoutMs: 2000, fetchImpl: opts.fetchImpl }); return { ok: true, ...r }; }
      catch { return { ok: false }; }
    },
  };
}
```

- [ ] **Step 4: Run → `# pass 6`**  - [ ] **Step 5: Commit** `feat(catalog-v4): http and embedding sidecar clients with explicit unavailability`

---

### Task T7: Author `QS_NL_AUTHORED_v1` (60 queries) + `QS_LINE_REAL_v1` (§8.2)

**Files:** Create `tests/fixtures/v4/querysets/QS_NL_AUTHORED_v1.jsonl`, `tests/fixtures/v4/querysets/QS_LINE_REAL_v1.jsonl`, `scripts/author-nl-queries.md`; Test: `tests/unit/v4-querysets.test.ts` (add to allowlist)

**Interfaces:** each line `{ "id": "NL-001", "text": "...", "expected": { "kind": "model"|"type", "id": "PRODUCT_…"|"<typeId>" }, "exclude": ["drinkware"], "qty": 100|null, "budget": 500|null, "group": "smart_tech"|…, "intent": "find"|"compare"|"color"|"price" }`

- [ ] **Step 1: Write `scripts/author-nl-queries.md`** — the authoring rubric: 4 groups × 4 intents × ~4 = 60; every `expected.id` must exist in `$ZURI_DATA_ROOT/catalog_identity_review_user_logic_v1/identity-review.json` (`productMasters[].productId`) or the 32 typeIds; ≥ 12 queries carry `exclude`, ≥ 12 carry `qty`, ≥ 12 carry `budget`; Thai customer phrasing, no product codes in text.
- [ ] **Step 2: Write the failing test** that loads both files, checks 60 lines / ≥ 6 lines, schema fields present, `expected.id` resolvable against identity-review (skip with `test.skip` if `ZURI_DATA_ROOT` missing), and the count thresholds above.
- [ ] **Step 3: Author the 60 queries** (sonnet, reading identity-review `displayName`s to pick real models; e.g. `{"id":"NL-001","text":"อยากได้พาวเวอร์แบงก์แจกพนักงาน 200 คน งบไม่เกิน 300","expected":{"kind":"type","id":"power_bank"},"exclude":[],"qty":200,"budget":300,"group":"smart_tech","intent":"price"}`); write `QS_LINE_REAL_v1` with the 6 real product turns from `state/line-chat` (3 unique texts; expected per the spec's §1.1 table: `ไม่ใช่แก้ว` → `exclude:["drinkware"], budget:200, expected:{kind:"type",id:"neck_massager"}` as a plausible positive; `แก้วน้ำมีกี่สี` → `expected:{kind:"type",id:"drinkware"}, intent:"color"`; `สินค้าเกี่ยวกับแก้วน้ำมีตัวไหนบ้าง` → `drinkware`, `find`).
- [ ] **Step 4: Run → pass; Commit** `test(catalog-v4): authored NL query sets for eval`

---

### Task T8: `scripts/embed-sidecar.py` (§5.6)

**Files:** Create `scripts/embed-sidecar.py`, `scripts/requirements-sidecar.txt`; Test: `scripts/test_embed_sidecar.py` (pytest, not in npm test)

- [ ] **Step 1: Failing test** (`pytest scripts/test_embed_sidecar.py`): using `fastapi.testclient`, `GET /health` → `{model, revision, dim: 384}`; `POST /embed {texts:["a"], kind:"query"}` → 1 vector of len 384, L2 norm ≈ 1; `kind:"passage"` prefixes `passage: `; empty texts → 400.
- [ ] **Step 2: Implement**

```python
# scripts/embed-sidecar.py
import os, numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

MODEL = os.environ.get("EMBED_MODEL", "intfloat/multilingual-e5-small")
REVISION = os.environ.get("EMBED_MODEL_REVISION", "614241f622f53c4eeff9890bdc4f31cfecc418b3")
_model = SentenceTransformer(MODEL, revision=REVISION, device="cpu")
_model.max_seq_length = 512
app = FastAPI()

class EmbedIn(BaseModel):
    texts: list[str]
    kind: str = "passage"

@app.get("/health")
def health():
    return {"model": MODEL, "revision": REVISION, "dim": _model.get_sentence_embedding_dimension()}

@app.post("/embed")
def embed(body: EmbedIn):
    if not body.texts: raise HTTPException(400, "texts required")
    if body.kind not in ("query", "passage"): raise HTTPException(400, "kind must be query|passage")
    texts = [t if t.startswith(f"{body.kind}: ") else f"{body.kind}: {t}" for t in body.texts]
    vecs = _model.encode(texts, batch_size=32, normalize_embeddings=True, convert_to_numpy=True).astype(np.float32)
    return {"vectors": vecs.tolist(), "model": MODEL, "revision": REVISION}

if __name__ == "__main__":
    import uvicorn; uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("EMBED_PORT", "8891")))
```
`scripts/requirements-sidecar.txt`: `fastapi`, `uvicorn`, `sentence-transformers==5.2.0`, `torch` (cpu), `numpy`, `pytest`, `httpx`.
- [ ] **Step 3: Run pytest → pass (first run downloads model). Commit** `feat(catalog-v4): e5-small embedding sidecar`

---

### Task T9: `embed-text.ts` + `build-graph.ts` (§5.2, §5.3, §5.6, AC-A1/A4/A5/A8, C3 denormalization)

**Files:** Create `src/rag/v4/identity-types.ts`, `src/rag/v4/embed-text.ts`, `src/rag/v4/build-graph.ts`; fixture `tests/fixtures/v4/identity-mini.json`, `tests/fixtures/v4/catalog-mini.json`; Test `tests/unit/v4-build-graph.test.ts`

**Interfaces:**
```ts
// identity-types.ts (subset of identity-review.json actually consumed)
export interface IrProductMaster { productId: string; displayName: string; englishName: string | null; baseSignature: string; status: string; typeId: string | null; physicalVariantIds: string[]; offerIds: string[] }
export interface IrVariant { physicalVariantId: string; productId: string; status: string; attributes: { colors: string[] | null; sizes: string[] | null; materials: string[] | null } }
export interface IrOffer { offerId: string; sourceCode: string; offerKind: 'set'|'single'; status: string; productId: string | null; componentLinkIds: string[]; customizationProfileIds: string[] }
export interface IrComponentLink { componentLinkId: string; offerId: string; productId: string; physicalVariantId: string; quantity: number; position: number; role: string; typeId: string | null }
export interface IdentityReview { productMasters: IrProductMaster[]; variants: IrVariant[]; offers: IrOffer[]; componentLinks: IrComponentLink[]; customizationProfiles: Array<{ customizationProfileId: string; optionIds: string[] }>; graph: { nodes: Array<{ id: string; label: string; props: Record<string, unknown> }>; edges: Array<{ from: string; to: string; rel: string; props: Record<string, unknown> }> } }
export interface Catalog2026Item { code: string; name: string; englishName: string; category: string; description: string; image: string | null; branding: string[] }
// build-graph.ts
export interface BuildInputs { identity: IdentityReview; catalog: Catalog2026Item[]; flowaccount: ParsedFlowAccount; categoryMap: CategoryGroupMap; aliases: TypeAliases; refs: { identity: SourceRef; catalog: SourceRef; flowaccount: SourceRef } }
export function buildGraphV4(inputs: BuildInputs): GraphBatch;      // stats: { CategoryGroup, ProductType, ProductModel, PhysicalVariant, PhysicalSKU, CatalogOffer, CatalogOfferFlowAccountOnly, CommercialSKU, CustomizationOption, AttributeValue, edges }
export function embeddableNodes(batch: GraphBatch): Array<{ id: string; text: string }>;   // ProductModel + CatalogOffer only
// embed-text.ts
export function modelPassage(n: GraphNode, typeNameTh: string): string; export function offerPassage(n: GraphNode, componentTypeNamesTh: string[]): string;
```
Node props (exact keys, used by T10/T11): ProductModel `{displayName, englishName, typeId, groupId, status, baseSignature, colors: string[], sourceRef}`; CatalogOffer `{code, name_th, name_en, description, image, offerKind, rmb, branding, status, origin, componentTypeIds, sourceRef}`; PhysicalVariant `{colors, sizes, materials, status, productId, sourceRef}`; PhysicalSKU `{displayCode, modelId, variantId, kind, sourceRef}`; CommercialSKU `{flowAccountCode, offerCode, priceListGroup, qtyTier, unitPrice, unitPriceWithVat, priceMissing, flowAccountName, exportDate, sourceRef}`.

- [ ] **Step 1: Fixture** `identity-mini.json`: 3 masters (`PRODUCT_M1` Notebook Powerbank typeId notebook, `PRODUCT_M2` Neck massager typeId null but links role neck_massager, `PRODUCT_M3` Mug typeId null and no links → unclassified), 5 variants (M1: Black/A5 + Blue/A5; M2: White; M3: White + Red), offers: `OFFER_TSP07-2` set (links M1 pos1, M2 pos2, customization profile with `screen_logo`), `OFFER_TBY01` single productId M2. `catalog-mini.json`: items for `tsp07-2` (lowercase code, branding 3 items, image path) only. Flowaccount via `parseFlowAccountRows` on 3 rows: `TSP07-2(P-06)-10` 2110, `TBY01(P-14)-100` 490, name_coded `… TPH00-4(P-06)` 1180 (base not in offers → flowaccount_only).

- [ ] **Step 2: Failing test** asserting: `stats` = `{CategoryGroup:4, ProductType:32, ProductModel:3, PhysicalVariant:5, PhysicalSKU:6 (5 + packaging), CatalogOffer:3, CatalogOfferFlowAccountOnly:1, CommercialSKU:3, CustomizationOption:3, AttributeValue:…}`; deep-equal on second build; status verbatim incl. `candidate`; every node has `props.sourceRef.sha256`; M2 `IN_TYPE` → `TYPE_neck_massager` with `source:'component_role'`; M3 → `TYPE_unclassified` source `none` and `status` unchanged; `SINGLE_OF` edge for `OFFER_TBY01` → `PRODUCT_M2` and M2 also in a `CONTAINS` of `OFFER_TSP07-2`; `OFFER_TPH00-4` has `origin:'flowaccount_only'` and a `PRICED_AS`; `OFFER_TSP07-2` has `CONTAINS` → `SKU_PKG_GIFTBOX_STD` and `componentTypeIds` deep-equals `['notebook','neck_massager']` (no packaging); `OFFER_TBY01` (absent from catalog) has `name_en` from identity and `image:null`; case-insensitive join gave `OFFER_TSP07-2` a Thai `name_th` from catalog; `embeddableNodes(batch).length === 6` (3 models + 3 offers) and each text starts with `passage: `.

- [ ] **Step 3: Implement `identity-types.ts`** (types only, as in Interfaces).

- [ ] **Step 4: Implement `embed-text.ts`**
```ts
import type { GraphNode } from './schema.js';
const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export function modelPassage(n: GraphNode, typeNameTh: string): string {
  const p = n.props as { displayName: string; englishName: string | null; colors: string[]; baseSignature: string };
  const colors = (p.colors ?? []).slice(0, 10).join(', ');
  return `passage: ${typeNameTh} | ${p.displayName} | ${p.englishName ?? ''} | สี: ${colors} | ${clip(p.baseSignature, 200)}`;
}
export function offerPassage(n: GraphNode, componentTypeNamesTh: string[]): string {
  const p = n.props as { name_th: string | null; name_en: string | null; description: string | null };
  return `passage: ชุดของขวัญ | ${p.name_th ?? ''} | ${p.name_en ?? ''} | ประกอบด้วย: ${componentTypeNamesTh.join(', ')} | ${clip(p.description, 200)}`;
}
```

- [ ] **Step 5: Implement `build-graph.ts`** (pure; ~200 lines). Required behaviour in order:
  1. `validateCategoryGroupMap` / `validateTypeAliases` against observed typeIds (`productMasters[].typeId` ∪ `componentLinks[].typeId`, non-null).
  2. Nodes: 4 CategoryGroup; 32 ProductType (`{typeId, name_th, name_en, aliases_th, aliases_en, groupId}`) + `IN_GROUP`; sentinel `TYPE_unclassified` with label `TypeSentinel`.
  3. ProductModel per master: typeId = master.typeId ?? mostCommon(links where productId==master).typeId/role ?? null; `IN_TYPE` with `source` ∈ `identity_review.typeId|component_role|none`; `colors` = union of its variants' colors.
  4. PhysicalVariant per variant (attributes null → `[]`), `HAS_VARIANT`; AttributeValue nodes + `HAS_ATTRIBUTE` from `identity.graph` edges with rel `HAS_ATTRIBUTE`.
  5. PhysicalSKU per variant via `assignDisplayCodes` (SkuInput from master+variant), `HAS_SKU`; plus `SKU_PKG_GIFTBOX_STD` `{kind:'packaging', displayCode:'SKU-PKG-GIFTBOX-STD'}`.
  6. Catalog index by `code.toUpperCase()`; CatalogOffer per identity offer (`origin:'catalog'`): `name_th` = catalog.name ?? null, `name_en` = catalog.englishName ?? identity englishName (use offer sourceCode if nothing), `image` = catalog.image ?? null, `branding` = catalog.branding ?? [], `rmb` from `identity.graph` CatalogOffer node props if present else null.
  7. `CONTAINS` edges from componentLinks → `stableSkuId(productId, physicalVariantId)` with `{qty: quantity, position, role, componentLinkId}`; `componentTypeIds` = unique `link.typeId ?? link.role` excluding `unclassified`; if `branding.length` → `CONTAINS` → packaging SKU `{qty:1, position:99, role:'packaging'}`.
  8. `SINGLE_OF` for `offerKind==='single' && productId`.
  9. `CUSTOMIZABLE_WITH`: CustomizationOption nodes `screen_logo`/`laser_logo`/`message_card` (name_th สกรีนโลโก้/เลเซอร์โลโก้/การ์ดข้อความ); edges from offer's customizationProfiles' optionIds, and from catalog `branding` strings mapped by name_th.
  10. CommercialSKU per `flowaccount.lines` (`bucket !== 'non_giftset'`): id `cskuId(flowAccountCode ?? `${base}|${rowIndex}`)`, `offerCode: base`, `exportDate:'2026-06-21'`; if `offerNodeId(base)` not present → create CatalogOffer `{origin:'flowaccount_only', code: base, name_th: flowAccountName with trailing code removed, offerKind:'set', status:'flowaccount_only', componentTypeIds: []}`; `PRICED_AS` edge.
  11. Every node gets `sourceRef` (`identity` ref with `rowKey` = node id; `catalog` ref for catalog-derived props recorded as `catalogRef`; `flowaccount` ref for CommercialSKU with `rowKey` = `row:${rowIndex}`).
  12. `stats` as in Interfaces; nodes sorted by id, edges sorted by id (determinism).
  `embeddableNodes`: ProductModel → `modelPassage(n, typeNameTh)` (sentinel → 'ไม่ระบุหมวด'); CatalogOffer → `offerPassage(n, componentTypeIds.map(name_th))`.

- [ ] **Step 6: Run → pass. Verify with real inputs** (script one-liner like T3 step 6) expected stats: `ProductModel 427, PhysicalVariant 1128, PhysicalSKU 1129, CatalogOffer 1107, CatalogOfferFlowAccountOnly 91, CommercialSKU 656, ProductType 32`. Differences → report, don't patch numbers.

- [ ] **Step 7: Commit** `feat(catalog-v4): pure graph builder with denormalized type ids and passage texts`

---

### Task T10: `search.ts` + `price.ts` (§5.7, AC-C1..C5, C7)

**Files:** Create `src/rag/v4/search.ts`, `src/rag/v4/price.ts`; fixture `tests/fixtures/v4/fake-db.ts`; Test `tests/unit/v4-search.test.ts`

**Interfaces:**
```ts
export interface GraphDb {
  hybridSearch(a: { queryVector: number[]; k: number; alpha?: number; collection?: string }): Promise<Array<{ node: { id: string; labels: string[]; props: any }; score?: number }>>;
  neighbors(seed: string, a: { rels?: string[]; rel?: string; direction?: 'out'|'in'|'both'; depth?: number; limit?: number }): Promise<Array<{ node: { id: string; labels: string[]; props: any }; path: Array<{ rel: string; from: string; to: string; props: any }> }>>;
}
export interface PriceTier { qtyTier: number | null; unitPrice: number; commercialSku: string | null; priceMissing: boolean; exportDate: string | null; offerCode: string | null }   // offerCode names the offer the tier came from; Model results set ResultV4.code from the selected tier's offerCode
export interface SelectedPrice { qtyTier: number | null; unitPrice: number; belowMoq: boolean; source: 'offer'|'via_offer' }
export interface ResultV4 { kind: 'model'|'offer'; id: string; code: string | null; name: string; englishName: string | null; type: { id: string; name_th: string } | null; group: { id: string } | null; score: number; status: string; image: string | null;
  variants: Array<{ skuId: string; displayCode: string; color: string | null; size: string | null; material: string | null }>; priceLadder: PriceTier[]; selectedPrice: SelectedPrice | null;
  components: Array<{ modelId: string; name: string; typeId: string | null; qty: number }>; customizations: Array<{ id: string; name_th: string }>; sourceRef: unknown }
export interface SearchResponseV4 { success: true; query: string; parsed: ParsedQuery & { budgetUnmet: boolean }; results: ResultV4[]; nearest: ResultV4[]; timing: { embedMs: number; searchMs: number; expandMs: number; k: number } }
export interface SearchDeps { db: GraphDb; embed: EmbedClient; aliases: Map<string, string>; typeNames: Map<string, string> /*typeId→name_th*/; typeGroups: Map<string, string> }
export function cosineFromEngineScore(s: number): number;   // engine score = 1 - d (L2 on unit vectors) → cos = 1 - (1-s)^2/2
export function selectTier(ladder: PriceTier[], qty: number | null): SelectedPrice | null;
export async function searchV4(deps: SearchDeps, query: string, opts: { limit?: number; k?: number; alpha?: number; overrides?: { qty?: number; budgetPerUnit?: number } }): Promise<SearchResponseV4>;   // throws RagUnavailableError; overrides win over parsed values (used by find_within_budget)
export async function priceV4(deps: SearchDeps, code: string, qty: number | null): Promise<{ found: boolean; code: string; priceLadder: PriceTier[]; selectedPrice: SelectedPrice | null; exportDate: string | null }>;
```

- [ ] **Step 1: Fake db fixture** `tests/fixtures/v4/fake-db.ts`: builds an in-memory `GraphDb` from a `GraphBatch` (use `buildGraphV4` on `identity-mini.json` from T9 — import the same fixture) plus a `vectors: Map<id, number[]>` and a scripted `hybridSearch` that returns nodes ordered by a provided score map; `neighbors` implemented over the batch edges honouring `rels` and `direction`. Also a fake `EmbedClient` returning `[1,0,0…]`.

- [ ] **Step 2: Failing tests** (one `it` per spec §7.7 row): SKU/Variant hits excluded from results; two hits with engine scores 0.9 / 0.7 → cosine `1-(0.1²)/2 = 0.995` and `0.955`, distinct; exclude `[drinkware]` removes Model M3 and any Offer with `componentTypeIds ∋ drinkware`; after filter < limit → second `hybridSearch` call with `k: 160` (spy counts calls); `selectTier`: ladder [10:690, 20:550, 100:490] → qty 100→100, 30→20, 5→10 + belowMoq, null→10; budget 200 removes Offer at 470 but keeps a Model with `selectedPrice:null`; all removed → `results:[]`, `budgetUnmet:true`, `nearest` 3 sorted by unitPrice asc; Model M2 gets `priceLadder` via `OFFER_TBY01` `SINGLE_OF` (`source:'offer'`) and Model M1 via `OFFER_TSP07-2` CONTAINS (`source:'via_offer'`); `neighbors` called with `{rels:['HAS_VARIANT'],direction:'out'}` for models (assert call args); duplicate hit ids dedupe to one; `hybridSearch` throwing → rejects with `RagUnavailableError`; positive control: same fixture, query without exclude returns ≥ 1 drinkware.

- [ ] **Step 3: Implement `price.ts`**
```ts
import type { PriceTier, SelectedPrice } from './search.js';
export function selectTier(ladder: PriceTier[], qty: number | null): SelectedPrice | null {
  const priced = ladder.filter((t) => !t.priceMissing && t.qtyTier !== null).sort((a, b) => a.qtyTier! - b.qtyTier!);
  if (!priced.length) return null;
  if (qty === null) return { qtyTier: priced[0].qtyTier, unitPrice: priced[0].unitPrice, belowMoq: false, source: 'offer' };
  const le = priced.filter((t) => t.qtyTier! <= qty);
  if (!le.length) return { qtyTier: priced[0].qtyTier, unitPrice: priced[0].unitPrice, belowMoq: true, source: 'offer' };
  const best = le[le.length - 1];
  return { qtyTier: best.qtyTier, unitPrice: best.unitPrice, belowMoq: false, source: 'offer' };
}
export function ladderFromCsku(nodes: Array<{ props: any }>): PriceTier[] {
  return nodes.map((n) => ({ qtyTier: n.props.qtyTier ?? null, unitPrice: Number(n.props.unitPrice) || 0, commercialSku: n.props.flowAccountCode ?? null, priceMissing: Boolean(n.props.priceMissing) }))
    .sort((a, b) => (a.qtyTier ?? 1e9) - (b.qtyTier ?? 1e9));
}
```

- [ ] **Step 4: Implement `search.ts`** following §5.7 steps 1–8 exactly (parse → embed `query: ` → `hybridSearch({k:40, alpha:0, collection:'e5_v4'})` → label filter + exclude on `props.typeId` / `props.componentTypeIds` → if `< limit` re-query `k:160` once → expand per-hop with explicit `rels`/`direction` → ladder/selectedPrice (Model: union of ladders from `SINGLE_OF`⁻¹ offers tagged `offer`, else `CONTAINS`⁻¹ via `HAS_SKU` SKUs tagged `via_offer`) → budget filter (keep `selectedPrice:null`) → dedupe → `nearest` when empty-by-budget → `timing`). Wrap any db/embed error that is not already `RagUnavailableError` in `new RagUnavailableError('engine', msg)`. `priceV4` = lookup `offerNodeId(code)` → `PRICED_AS` out → ladder + `selectTier`.

- [ ] **Step 5: Run → all `it` pass. Commit** `feat(catalog-v4): graph search with exclusions, tier pricing and budget semantics`

---

### Task T11: `format-cards.ts` (AC-D2)

**Files:** Create `src/answer/format-cards.ts`; Test `tests/unit/v4-format-cards.test.ts`

**Interfaces:**
```ts
export interface SearchEvidenceV4 { query: string; parsed: SearchResponseV4['parsed'] | null; matchCount: number; matches: ResultV4[]; nearest: ResultV4[]; unavailable?: true; reason?: string; priceSource: 'commercial_sku' }
export interface CardPayload { id: string; kind: 'model'|'offer'; code: string | null; name: string; typeNameTh: string | null; colors: string[]; sizes: string[]; selectedPrice: SelectedPrice | null; priceExportDate: string | null; priceNote: string | null; status: string; image: string | null; reviewNote: string | null }
export function formatCards(ev: SearchEvidenceV4, max = 5): CardPayload[];
export function cardsToText(cards: CardPayload[], ev: SearchEvidenceV4): string;   // deterministic Thai text block the LLM may quote
```

- [ ] **Step 1: Failing test**: 7 matches → 5 cards; colours = unique `variants[].color` non-null; `selectedPrice.qtyTier === parsed.qty` when qty set, else min tier; `status:'review_required'` → `reviewNote:'ข้อมูลรอตรวจสอบ'`; `belowMoq` → `priceNote` contains 'ขั้นต่ำ'; `unavailable:true` → `formatCards` returns `[]` and `cardsToText` contains 'ขัดข้องชั่วคราว' and no `SKU`/code; `budgetUnmet` → text lists `nearest` with real prices and the phrase 'ไม่มีสินค้าในงบ'.
- [ ] **Step 2: Implement** (pure map + template strings; `cardsToText` lines like `1) เครื่องนวดคอ (TBY01) — สี: ขาว — 100 ชุด: 490 บาท/ชุด (ราคาอ้างอิง ณ 21 มิ.ย. 2026)`).
- [ ] **Step 3: Run → pass; Commit** `feat(catalog-v4): deterministic Model-level card payloads and text`

---

#### Wave-2 follow-ups (carried into Wave 3/4)
- `tests/fixtures/v4/fake-db.ts` is a hand-written GraphBatch that drifts from `buildGraphV4` output (PhysicalSKU `kind`, M2/M3 status/type). T16 must add one test that runs `searchV4` over `buildGraphV4(identity-mini.json)` so the real builder shape is exercised.
- `searchV4` expands every deduped hit before `limit`; T16's p95 ≤ 800 ms gate will show whether expansion must move after the budget filter/slice (price-only pre-expansion, full expansion for top `limit`).

### Task T12: `ingest.ts` + `scripts/ingest-catalog-v4.ts` (§5.9, §5.10, AC-A2/A3/A7)

**Files:** Create `src/rag/v4/ingest.ts`, `scripts/ingest-catalog-v4.ts`; Test `tests/unit/v4-ingest.test.ts`

**Interfaces:**
```ts
export interface IngestDb { createCollection(name: string, model: string, dim: number, metric: string): Promise<void>; listCollections(): Array<{ name: string; dim: number; metric: string; count: number }>; bulkAddNodes(n: Array<{ id: string; labels: string[]; props: any }>): Promise<void>; bulkAddEdges(e: Array<{ id: string; from: string; to: string; rel: string; props?: any }>): Promise<void>; addVector(nodeId: string, collection: string, embedding: number[]): Promise<void>; flushIndex(): Promise<void>; saveState(): Promise<void> }
export interface IngestPaths { dataRoot: string; identity: string; catalog: string; flowaccount: string; categoryMap: string; aliases: string; storeRoot: string /* …/genesis_smartgift_store_v4 */ }
export interface IngestManifest { runId: string; createdAt: string; inputs: Record<'identity'|'flowaccount'|'catalog'|'categoryMap'|'aliases', { path: string; sha256: string }>; stats: Record<string, number>; vectors: number; collection: 'e5_v4'; model: string; revision: string; flowaccountExportDate: '2026-06-21' }
export type IngestDecision = 'skip'|'reingest';
export function decide(prev: IngestManifest | null, inputs: IngestManifest['inputs']): IngestDecision;
export async function runIngest(p: IngestPaths, deps: { openDb: (dir: string) => IngestDb; embed: EmbedClient; now: () => Date; runId: string; serviceHealth?: () => Promise<{ storePath?: string } | null> }): Promise<{ decision: IngestDecision; runDir?: string; manifest?: IngestManifest; exitCode: 0|2|3 }>;
```
Order inside `runIngest` (must be testable): read+hash 5 inputs → `decide` (read `CURRENT` → `<run>/manifest.json`) → if skip return → `buildGraphV4` → `embeddableNodes` → **embed all** (sidecar failure ⇒ exitCode 2 before any db call) → `openDb(runDir)` (lock error ⇒ 3) → `createCollection('e5_v4', EMBED_MODEL, 384, 'cosine')` → `bulkAddNodes` → `bulkAddEdges` → `addVector` × N → `flushIndex` → `saveState` → verify `listCollections()` count === N and stats → write `manifest.json` → write `CURRENT` (content = runId) → write `review/flowaccount-buckets.jsonl` → log service storePath warning.

- [ ] **Step 1: Failing tests** with in-memory `IngestDb` spy + fake `EmbedClient` + tmp `dataRoot` (write mini fixtures from T9/T3 into tmp): manifest has 5 sha256 keys; second run → `skip` and zero `bulkAddNodes` calls; modify aliases file → `reingest`; embed throws → `exitCode 2`, `bulkAddNodes` not called, no `CURRENT`; `createCollection` called with `('e5_v4', 'intfloat/multilingual-e5-small', 384, 'cosine')`; `addVector` count = models + offers; verify failure (`listCollections` count mismatch) → no `CURRENT`; `openDb` throwing `already open` → `exitCode 3`.
- [ ] **Step 2: Implement `ingest.ts`** per order above; `scripts/ingest-catalog-v4.ts` wires real `GenesisDatabase.open({path, vectorDim:384, retention:'frontier_only'})`, `createEmbedClient(process.env.EMBED_URL ?? 'http://127.0.0.1:8891')`, `runId = new Date().toISOString().replace(/[:.]/g,'-')`, `serviceHealth` GET `http://localhost:8888/health`, `process.exit(code)`.
- [ ] **Step 3: Run unit → pass; Commit** `feat(catalog-v4): idempotent ingest with versioned store dirs and CURRENT pointer`

---

### Task T13: `zuri-rag-service` → v4 (§5.7, §5.9, AC-C1/C6)

**Files (repo zuri-rag-service):** Modify `src/server.ts` (rewrite), Create `src/app.ts` (express app factory for tests), `tests/server.test.ts`, Modify `start-rag-service.bat`, `README.md` (deprecate docker section)

**Interfaces:** `createApp(deps: { search: (q: string, o: { limit?: number; overrides?: { qty?: number; budgetPerUnit?: number } }) => Promise<SearchResponseV4>; price: (code: string, qty: number | null) => Promise<unknown>; health: () => { dbReady: boolean; embedReady: boolean; storePath: string | null; runId: string | null }; log: (line: object) => void; hmacKey: string }): express.Express` — routes `POST /api/rag/search` (body `{query, limit?, qty?, budgetPerUnit?}` → `overrides`), `POST /api/rag/price`, `GET /health`. The service imports `searchV4`/`priceV4` from the p4 worktree build (`file:` dependency on `D:/workspace/zuri-edge-catalog-p4` or a relative import of `dist/rag/v4/*.js` — choose `file:` dep in package.json).

- [ ] **Step 1: Failing supertest tests**: 200 shape has `success, query, parsed, results[], nearest[], timing`; injected `search` throwing `RagUnavailableError('engine')` → 503 `{success:false,error:'rag_unavailable',detail:'engine'}`; `/health` returns injected fields and `storePath` ends with `runId`; `/api/rag/price` passes `code`/`qty`; log line contains `queryHmac` (64 hex) and `parsed` without `cleanText` and contains no non-ASCII.
- [ ] **Step 2: Implement `app.ts`/`server.ts`**: server reads `RAG_STORE_POINTER` (default `$ZURI_DATA_ROOT/genesis_smartgift_store_v4/CURRENT`) → opens `GenesisDatabase.open({path: <root>/<runId>, vectorDim:384, retention:'frontier_only'})`, builds `SearchDeps` (aliases/typeNames from config), probes `EMBED_URL/health`; appends JSONL to `state/rag-service/requests.jsonl` with `createHmac('sha256', process.env.LINE_HISTORY_HASH_KEY ?? 'dev')`. Remove the catalog-JSON substring code entirely. `start-rag-service.bat`: start `py -3 ..\zuri-edge-catalog-p4\scripts\embed-sidecar.py` in a second window, wait for `/health`, then `npx tsx src/server.ts`.
- [ ] **Step 3: Run `npm test` in zuri-rag-service → pass; Commit** `feat: serve catalog graph v4 search and price; drop substring fallback`

---

### Task T14: LINE agent rewire (§5.8, AC-D1 (client part), D5, D6)

**Files:** Modify `src/rag/genesis-rag.ts` (remove store open; HTTP only), `src/answer/tools.ts` (`searchProducts`, `quotePrice`, `findWithinBudget` async v4), `src/answer/llm.ts:122-175`, `src/mcp/pricing-server.ts:118-135`, `src/answer/headless.ts` (no change to MCP_TOOLS names), `tests/unit/conversation.test.ts`; Test `tests/unit/v4-answer-tools.test.ts`

**Interfaces:**
```ts
// genesis-rag.ts
export class GenesisLocalRag { constructor(opts?: { apiUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch }); searchProducts(query: string, limit?: number): Promise<SearchEvidenceV4>; priceForCode(code: string, qty: number | null): Promise<PriceEvidenceV4>; health(): Promise<{ ok: boolean }> }
export interface PriceEvidenceV4 { found: boolean; code: string; priceLadder: PriceTier[]; selectedPrice: SelectedPrice | null; exportDate: string | null; priceSource: 'commercial_sku'|'estimate_rmb'|'none'; unavailable?: true; reason?: string }
// tools.ts
export interface EvidenceOptions { catalog: Catalog; role: Role; exchangeRate: number; shipMonth?: number; rag: GenesisLocalRag }
export async function searchProducts(query: string, options: EvidenceOptions, limit = 5): Promise<SearchEvidenceV4>;
export async function quotePrice(sku: string, quantity: number | null, options: EvidenceOptions): Promise<QuoteEvidence & { priceSource: 'commercial_sku'|'estimate_rmb' }>;
export async function findWithinBudget(quantity: number, maxPriceThb: number, options: EvidenceOptions, limit = 10): Promise<BudgetEvidence & { priceSource: 'commercial_sku' }>;
```
`quotePrice`: try `rag.priceForCode`; if `found` → map ladder to `breaks[] {quantity: qtyTier, unitPriceThb: unitPrice, orderTotalThb: qtyTier*unitPrice}` and `priceAtQuantity` from `selectedPrice`, `priceSource:'commercial_sku'`; if not found and not unavailable → existing rmb path with `priceSource:'estimate_rmb'`; if `unavailable` → `{found:false, message:'ระบบราคาขัดข้องชั่วคราว', unavailable:true}`. `findWithinBudget` → `rag.searchProducts(`งบ ${maxPriceThb} ${quantity} ชุด`)`-style is **not** allowed (don't fabricate text); instead call a new `rag.searchWithConstraints({ query: '', qty, budgetPerUnit })` → service accepts optional `qty`/`budgetPerUnit` overriding parser (add to T13 route body and `searchV4` opts in T10 as `overrides`).

- [ ] **Step 1: Failing tests**: `searchProducts` returns evidence with `matches[0].variants/priceLadder/selectedPrice/components/customizations` from a fake fetch; `quotePrice('TBY01',100)` → `priceAtQuantity.unitPriceThb 490`, `priceSource 'commercial_sku'`; unknown code → falls to rmb path with `priceSource 'estimate_rmb'`; fetch ECONNREFUSED / timeout / 500 → `{unavailable:true, reason}` never `[]`; spy: `GenesisDatabase.open` never called (module has no such import — assert via `grep` in T15's guard; here assert `new GenesisLocalRag()` does not touch fs); MCP `call('search_products')` awaits and returns same shape.
- [ ] **Step 2: Implement**; update `llm.ts` runners to `await`; `pricing-server.ts` `call` becomes async; fix `tests/unit/conversation.test.ts` expectation (`matches[0].code`).
- [ ] **Step 3: Run full `npm test` → pass; Commit** `feat(catalog-v4): LINE agent tools use graph v4 over HTTP with explicit unavailability`

---

#### Wave-3 outcomes that change T15/T16 (decided 2026-08-23)
- T14 moved the old native-store code to `src/rag/genesis-native.ts`; it is still imported by `src/cli/index.ts` (only for the `/api/graph` debug route) and `src/mcp/genesis-mcp-server.ts` (separate dev process). **T15 decision:** remove the `/api/graph` route and the `genesis-native` import from `src/cli/index.ts` (the LINE agent process must not open any GenesisBlock store); keep `genesis-native.ts` only for `genesis-mcp-server.ts`; the ADR guard asserts `src/cli/index.ts` and `src/answer/**` do not import `genesis-native` and that `genesis-native.ts` is imported from `src/mcp/**` only.
- Service `/health` now returns `{ ok, dbReady, embedReady, storePath, runId, currentRunId, staleRun }`; cutover is a restart (no `close()` in the native API). `GenesisLocalRag.health()` mirrors it.
- `searchV4` gained `browseAll` (seed query 'ของขวัญองค์กร', k 2000, sort by unitPrice desc under budget) used by `find_within_budget`; `BudgetEvidence` has `budgetUnmet` + `nearest[]`.
- Store root env `GENESIS_SMARTGIFT_STORE_V4_ROOT` is honoured by both ingest and service; run dir = dirname(RAG_STORE_POINTER)/runId.
- `GET /api/rag/graph` and the `/graph` viewer were removed from the service (no list-all API in GenesisBlock); `graph-viewer.html` is orphaned — T17 deletes it or SP3 designs a store-backed graph endpoint.
- The real ingest already ran once: `$ZURI_DATA_ROOT/genesis_smartgift_store_v4/2026-08-23T07-56-24-501Z/` (1,534 vectors, ~80 s incl. 30 s embed); `CURRENT` points at it. T16 integration test must use a tmp `GENESIS_SMARTGIFT_STORE_V4_ROOT`, not this one.
- ExcelJS stamps a creation time into .xlsx, so a regenerated "identical" workbook changes sha256 — T16 fixtures must write the workbook once and reuse the path.
- Embedding 1,534 passages in one request takes ~30 s on CPU; ingest uses a 300 s client timeout. T16 latency gate (p95 ≤ 800 ms) applies to query-time only.

### Task T15: cli injection removal, persona, flex preview, replay, ADR guard (AC-D1, D2, D3, D4, D7)

**Files:** Modify `src/cli/index.ts:671-680`, `.agents/zuri-01/AGENTS.md`, `src/answer/persona.ts:19` fallback string, `src/line-poc/flex.ts` (+`modelCard`); Create `tests/unit/v4-adr-guard.test.ts`, `tests/replay/line-chat.test.ts`, `tests/fixtures/v4/real-50.json` (50 real identity-review masters/offers incl. ≥ 3 drinkware, ≥ 3 neck_massager, ≥ 1 with priceLadder ≤ 200 absent — i.e. all ≥ 350)

- [ ] **Step 1: Failing ADR guard test**: reads `src/answer/**/*.ts`, `src/cli/index.ts`, `src/rag/genesis-rag.ts`; asserts none contains `gks-genesis-block-native`, `GenesisDatabase.open`, `hybridSearch(`, `executeHql(`; asserts `src/cli/index.ts` does not contain the string `[ข้อมูลสินค้าจาก`.
- [ ] **Step 2: Failing replay test**: load the 17 user turns from `D:/workspace/zuri-edge-device/state/line-chat/*.json` (or a copied fixture `tests/fixtures/v4/line-chat-turns.json` — copy once, commit), run each through `answerConversation` with a stubbed LLM that echoes tool calls and a `GenesisLocalRag` backed by `searchV4` over `fake-db` built from `real-50.json`; assert for the 4 `ไม่ใช่แก้ว` turns: evidence has no result with `type.id==='drinkware'` or `components[].typeId==='drinkware'` **and** `nearest.length ≥ 1` **and** the positive-control query (same text minus `ไม่ใช่แก้ว`) yields ≥ 1 drinkware; for `แก้วน้ำมีกี่สี`: evidence `matches[0].variants.some(v=>v.color)`; for greetings: no `search_products` call.
- [ ] **Step 3: Failing format/flex test additions**: `formatCards` over the replay evidence ≤ 5; `modelCard(payload)` passes `src/cards/validator.ts`; `answer` DM path never calls `modelCard` (spy).
- [ ] **Step 4: Implement**: delete lines 673-679 in `cli/index.ts` (keep `answerConversation(text, …)`), construct `GenesisLocalRag({ apiUrl: process.env.GENESIS_RAG_API_URL })` and pass as `rag` in `EvidenceOptions`; `AGENTS.md` rules block (verbatim from spec §5.8 table row); `persona.ts:19` fallback string gains the same ≤5-card/exclude/unavailable sentences; `flex.ts` `export function modelCard(c: CardPayload): Record<string, unknown>` building a bubble (hero image if `image`, title name, chips colours, price line, button 'ดูตัวเลือก' postback `v4:${c.id}`), preview-only.
- [ ] **Step 5: Run full `npm test` → pass; Commit** `feat(catalog-v4): route product evidence only through tools; persona and preview cards; replay guard`

---

### Task T16: integration, baseline, eval script (§7.10, §8, AC-E1/E2)

**Files:** Create `tests/integration/v4-store.test.ts`, `scripts/eval-catalog-v4.ts`, `tests/fixtures/v4/querysets/QS_OFFER_SELF_v1.jsonl` (generated from `data/catalog_vector_benchmark_round1_v1/vector-input-round1.json` cohort RESOLVED_375 by a small generator function inside the eval script, committed output)

- [ ] **Step 1: Integration test (`RUN_STORE_TESTS=1`, skipped otherwise)**: `runIngest` on `real-50` fixture into tmp storeRoot with real `GenesisDatabase` + real sidecar (skip if `EMBED_URL/health` fails) → counts, `listCollections()` has `e5_v4` with count = models+offers; second run `skip`; `searchV4` "สมุดโน้ต power bank" → a ProductModel whose `englishName` matches /notebook/i in top-3; 20 queries p95 ≤ 800 ms.
- [ ] **Step 2: Eval script**: reads 3 query sets, calls `http://localhost:8888/api/rag/search` (or `--baseline substring` mode that calls the pre-T13 service / `searchByName` via `dist`), computes the 9 metrics exactly as §8.3 (hit function, MRR, non-vacuous NEG pass, graph-level coverages computed by reading the store's nodes via `neighbors` on types/models, duplicate rate, latency percentiles, trace coverage, restricted offer-self recall with label filter and self-offer exclusion), writes the 6 files under `$ZURI_DATA_ROOT/catalog_eval_v4/<runId>/`, prints a table, exits 1 if any target fails unless `--no-gate`.
- [ ] **Step 3: Baseline run** (P0 in spec — executed here because the query set now exists): `npm run catalog:eval-v4 -- --baseline substring --no-gate` → `runId=BASELINE_SUBSTRING`; paste numbers into spec §2 Baseline column (orchestrator edits spec on master).
- [ ] **Step 4: Commit** `test(catalog-v4): store integration test and eval harness; record substring baseline`

---

### Task T17: Ship (decision gate — orchestrator)

- [ ] Run real ingest (`npm run catalog:ingest-v4`), restart `start-rag-service.bat` (cutover #1), run `npm run catalog:eval-v4` (gate on), ablation `--alpha 0.2` with `--no-gate`.
- [ ] Boss tests on LINE OA with the 17 turns; record outcomes in `docs/superpowers/specs/…-design.md` §8.4.
- [ ] Write `ADR-006` in `docs/ARCHITECTURE.md` (catalog graph v4: agent is HTTP-only, store owned by service, versioned cutover) and `ADR-RAG-004` in `docs/GENESIS-RAG-ADR.md`; mark docker rag-service deprecated in `zuri-rag-service/README.md`.
- [ ] PR `feat/catalog-graph-v4` → `feat/local-llm-swap` with metrics table, baseline vs v4, and the AC checklist.

---

## Self-review (done while writing)

- **Spec coverage:** AC-A1–A8 → T9/T12/T16; B1–B3 → T2; C1–C7 → T10/T13; D1–D7 → T14/T15; E1–E3 → T16/T17; §5.10 cutover → T12/T13/T17; §8.4 baseline → T16 (moved from P0 because the query set is authored in T7, same wave). Q2 mapping shipped in T4 (Boss can edit the JSON).
- **Placeholders:** none; T7/T9/T10/T12/T13 describe behaviour lists instead of full bodies where the body exceeds ~150 lines — each list item is a concrete, testable rule with the test named.
- **Type consistency:** `ResultV4`, `SearchEvidenceV4`, `PriceTier`, `SelectedPrice`, `ParsedQuery`, `GraphBatch`, `SkuInput`, `ParsedFlowAccount`, `EmbedClient`, `RagUnavailableError` are defined once (T1/T2/T3/T5/T6/T10/T11) and referenced by those names in T12–T16. `findWithinBudget` uses `overrides {qty, budgetPerUnit}` which is part of the T10 `searchV4` signature and the T13 request body.
