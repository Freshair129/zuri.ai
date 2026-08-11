# Parity Inventory — Operations (P4)

Scope: `kitchen`, `culinary`, `team`, `employees`, `schedule`, plus adjacent staff-facing
areas (courses/enrollment, certificates, procurement, runner/KDS). Read-only scan of
`G:\zuri` (V1). No files under `G:\zuri` were modified.

**Headline finding**: this is not a generic restaurant back-office. V1's target
customer is a **culinary school** ("V School") — the `kitchen`/`culinary` area is a
teaching kitchen (recipes tied to `Course`, class sessions, QR attendance,
certificates), cleanly namespaced as an industry plugin at
`G:\zuri\src\modules\industry\culinary\`. A generic restaurant reading of "kitchen
module" undersells what has to be preserved.

---

## 1. Sub-area tables

### 1.1 Kitchen — ingredients, lots, FEFO stock

| | |
|---|---|
| API routes | 5: `GET/POST /api/kitchen/ingredients`, `GET/PATCH /api/kitchen/ingredients/[id]`, `GET/POST /api/kitchen/ingredients/[id]/lots`, `GET /api/kitchen/lots`, `GET /api/kitchen/expiring` |
| Dashboard pages | `/kitchen` (dashboard), `/kitchen/ingredients`, `/kitchen/stock` |
| Prisma models owned | `Ingredient`, `IngredientLot` (`G:\zuri\prisma\schema.prisma:1515-1552`) |
| Workers touched | none directly (deduction is triggered by `industry/culinary/kitchen/handlers/onClassStarted.js`, a hook — see §4) |
| Evidence of real use | `src/lib/repositories/ingredientRepo.js` + `ingredientRepo.test.js` exist and are non-trivial (118 lines); `src/tests/integration/inventory-lots-api.test.js` exercises the lots API; wired into sidebar nav (`src/config/modules.js:109-113`); `src/app/(dashboard)/kitchen/CLAUDE.md` documents FEFO as CRITICAL business rule |
| **Verdict** | **must-have** |
| Cutover risk | M |
| Why | FEFO (First-Expired-First-Out) is a stated legal/food-safety rule, not cosmetic; `IngredientLot.status` blocks issuing from `EXPIRED`/`RECALLED` lots. Losing this silently breaks compliance for restaurant/school customers. |

### 1.2 Recipes / Menu

| | |
|---|---|
| API routes | 2: `GET/POST /api/culinary/recipes`, `GET/PATCH /api/culinary/recipes/[id]` |
| Dashboard pages | `/kitchen/recipes`, `/kitchen/menu` (menu↔recipe linking, reuses `/pos/products`) |
| Prisma models owned | `Recipe`, `RecipeIngredient`, `ProductRecipe` (join to `Product`) — `schema.prisma:1554-1609` |
| Workers touched | none |
| Evidence of real use | `src/lib/repositories/recipeRepo.js` (130 lines); `src/components/kitchen/RecipeCard.jsx`, `RecipeEditor.jsx`; `kitchen/menu/page.jsx` explicitly reuses `src/components/pos/RecipeLinker.jsx` and `/api/products/[id]/recipes` — cross-module coupling with POS, not standalone |
| **Verdict** | **must-have** |
| Cutover risk | M |
| Why | Recipes are the link between `Course` (what's taught), `Product` (what's sold/served) and `Ingredient` (what's deducted). Dropping this breaks both the kitchen and the POS menu. |
| Note | CLAUDE.md for kitchen states "Allergen list ต้องแสดงใน Recipe detail เสมอ — legal requirement," but **no `allergen` field exists anywhere in `Recipe`/`Ingredient`/the UI** (grep found zero matches). Either the legal requirement was never implemented, or it lives elsewhere undiscovered — flagged as an open question, not assumed done. |

### 1.3 Procurement (Supplier / PR / PO / GRN)

| | |
|---|---|
| API routes | Not under `/api/kitchen` or `/api/culinary` — this is a generic warehouse/procurement system in `/api/procurement/**` and `/api/inventory/**` (out of this area's direct scan list but owned jointly) |
| Dashboard pages | `/kitchen/procurement` (kitchen-scoped PO lifecycle UI) |
| Prisma models owned | `Supplier`, `PurchaseRequest`, `PurchaseRequestItem`, `PurchaseOrderV2`, `POItem`, `POApproval`, `POAcceptance`, `POTracking`, `GoodsReceivedNote`, `GRNItem`, `POReturn`, `POIssue`, `Warehouse`, `WarehouseStock`, `StockMovement`, `StockCount`, `StockCountItem` — `schema.prisma:1893-2236` |
| Workers touched | `market-price` (06:00 ICT cron, `src/app/api/workers/market-price/route.js`) |
| Evidence of real use | Full PO lifecycle modeled (DRAFT→PENDING→ORDERED→PARTIAL/RECEIVED→CANCELLED) with approvals, GRN, returns and issues — this is a mature, generic procurement engine that kitchen consumes, not something kitchen-specific |
| **Verdict** | **must-have** (as generic procurement, shared beyond kitchen) |
| Cutover risk | M |
| Why | Kitchen's auto-PR-on-low-stock flow depends on it; but because it's generic (warehouse-scoped, `productType` field supports non-food items), it should be lifted once for all consumers, not duplicated per module. |

### 1.4 ⚠️ FEAT22 "food-erp" engine — DEAD CODE, do not carry forward as-is

| | |
|---|---|
| Location | `G:\zuri\src\modules\industry\culinary\kitchen\food-erp\{deduction,procurement,capacity,snapshot,itemTypes}.js` |
| Evidence | Raw-SQL engine (`$queryRaw`/`$executeRaw`) against tables `items`, `recipes`(different columns), `purchase_requests`, `purchase_orders`, `goods_receipts` that **do not exist** in `prisma/schema.prisma` — no `model Item`, no matching column names. `deduction.test.js` line 6-8: `// PRE-EXISTING BROKEN (not caused by RMD): default-imports deductionEngine but the module uses named exports... Skipped to unblock the test suite; rewrite to the current API — RMD follow-up.` → `describe.skip(...)`. Zero other files import `produceBatchGoods`/`fulfillMadeToOrder`/`createPurchaseRequest`/etc. |
| **Verdict** | **drop** |
| Cutover risk | L (it's inert) |
| Why | This looks like an earlier or parallel design (unified `Item` catalog with `BATCH_GOODS`/`MADE_TO_ORDER`/`RAW_MATERIAL` types) that was superseded by the `Ingredient`/`Recipe`/`PurchaseRequest`/`PurchaseOrderV2` models actually in the schema. It is unwired, untested (tests skipped), and references non-existent tables. Do not use it as a spec for V2 — it would mislead. |

### 1.5 Culinary Schedule (class sessions)

| | |
|---|---|
| API routes | 1 file, multiple verbs: `GET/POST /api/culinary/schedules` (opens rounds; role-gated `SESSION_OPEN_ROLES`) |
| Dashboard pages | `/schedule`, `/schedule/calendar` |
| Prisma models owned | `CourseSchedule` (`schema.prisma:1009-1036`) |
| Workers touched | none found directly wired (CLAUDE.md documents an "auto-absent via QStash" worker but no such route file was found under `/api/workers/` — likely aspirational or renamed; see §5 open questions) |
| Evidence of real use | `src/lib/repositories/scheduleRepo.js` (87 lines); `src/components/schedule/CalendarView.jsx`; courses `CLAUDE.md` documents exact slot-derivation logic (`MORNING`/`EVENING`/`NIGHT`) and role matrix (`KITCHEN`/`MANAGER`/`DEV` may open, `OWNER` explicitly blocked) — a level of specificity that only comes from real, exercised code |
| **Verdict** | **must-have** |
| Cutover risk | H |
| Why | The "who can open a class round" rule diverges from the generic permission matrix (`OWNER` is blocked here despite being read-level-5 elsewhere) — an operations-specific override easy to lose in a reimplementation. Server-side slot derivation (`deriveSessionSlot`) must also be reproduced exactly or client/server logic drifts. |

### 1.6 Attendance / QR check-in

| | |
|---|---|
| API routes | 1: `POST /api/attendance/check-in` |
| Dashboard pages | embedded in `/schedule` via `src/components/schedule/AttendanceMarker.jsx` (manual mark) |
| Prisma models owned | `ClassAttendance` (`schema.prisma:946-968`) |
| Workers touched | `check-completion` (`/api/workers/check-completion`, enqueued fire-and-forget from check-in) |
| Evidence of real use | Full implementation: Redis-backed QR token (`enrollment:qr:{token}`, 15-min TTL), tenant-scoped validation, idempotent upsert (`@@unique([enrollmentId, scheduleId])`), atomic `hoursCompleted` increment, and a downstream QStash enqueue to check certificate-eligibility |
| **Verdict** | **must-have** |
| Cutover risk | M |
| Why | This is the mechanism that drives certificate auto-issuance (§1.8) — a silent break here means students stop earning hours toward certificates. |

### 1.7 Courses / Enrollments (culinary school catalog)

| | |
|---|---|
| API routes | `GET/POST /api/enrollments`, plus catalog under `/api/products`; LINE-facing: `GET /api/liff/courses`, `POST /api/liff/enrollment` (+ test) |
| Dashboard pages | `/courses`, `/courses/list`, `/courses/enrollments`, `/courses/[id]` |
| Prisma models owned | `Enrollment`, `EnrollmentItem`, `Package`, `PackageCourse` (`Course` itself is `Product` with a course `category`) |
| Workers touched | `check-completion` |
| Evidence of real use | `courses/CLAUDE.md` documents a real UI flow (course list → drawer → open round / enroll), integration order ("Order CLOSED before Enrollment can be created" — POS-first rule), and gift-enrollment rules; LIFF endpoints show this area **already has a LINE-native intake path in V1**, unlike kitchen |
| **Verdict** | **must-have** |
| Cutover risk | M |
| Why | Already partly LINE-native (`/api/liff/enrollment`), so V2's "LINE is primary surface" thesis is least risky here — but the web drawer flow (open-round → enroll → view roster) is still the manager/chef's day-to-day tool and needs a console equivalent. |

### 1.8 Certificates

| | |
|---|---|
| API routes | `GET/POST /api/certificates`, `GET /api/certificates/[id]/pdf`, `GET/POST /api/culinary/certificates`, `GET /api/culinary/certificates/[id]` |
| Dashboard pages | `/certificates` (not in main sidebar nav — reachable by direct link only) |
| Prisma models owned | `Certificate` (`schema.prisma:972-1007`) |
| Workers touched | `cert-nightly` (23:00 ICT cron) — scans all `IN_PROGRESS` enrollments, issues/upgrades certs at `BASIC_30H`/`PRO_111H`/`MASTER_201H` milestones, idempotent via `upsert` |
| Evidence of real use | Both the nightly worker and the on-demand PDF route (`src/lib/pdf/generate.js`, `certificateRepo.js` at 189 lines) are complete, non-trivial implementations; `Certificate.enrollment` uses a documented composite-FK pattern (ADR-086 D3) specifically to prevent divergence |
| **Verdict** | **must-have** |
| Cutover risk** | L |
| Why | Fully automated (cron-driven), self-contained, well-isolated. Low risk to lift as-is; the real risk is elsewhere (attendance feeding it correctly). |

### 1.9 Employees (staff records, roles)

| | |
|---|---|
| API routes | `GET/POST /api/employees`, `GET/PATCH /api/employees/[id]`, `PATCH /api/employees/[id]/password`, `GET /api/employees/stats` |
| Dashboard pages | `/employees`, `/employees/roles`, `/employees/[id]` |
| Prisma models owned | `Employee` (`schema.prisma:264-315`) |
| Workers touched | none |
| Evidence of real use | `employeeRepo.js` + `employeeRepo.test.js`; FEAT20 (Interactive Employee Card / Deck View — `src/components/employees/CardDeckView.jsx`) is a built, KPI-driven UI feature, not a stub; `ADR-068` (persona RBAC) is directly implemented in `src/lib/permissionMatrix.js:52-58` |
| **Verdict** | **must-have** |
| Cutover risk | H |
| Why | See §3 — `Employee` is tenant-scoped by design (own password, `@@unique([email, tenantId])`), which is the exact assumption V2's `Person`+`Membership` model breaks. |

### 1.10 Team invite / join

| | |
|---|---|
| API routes | `POST/GET /api/team/invite`, `GET /api/team/invite/[token]`, `POST /api/team/join`, `GET/POST /api/team/invitations` |
| Dashboard pages | none found directly under `(dashboard)/team` — invite UI is presumably embedded in `/employees` or `/settings` (not confirmed; see open question) |
| Prisma models owned | `InvitationToken` |
| Workers touched | none |
| Evidence of real use | Full transactional flow: `team/invite/route.js` (FEAT21/ADR-077) creates a token + sends email; `team/join/route.js` creates the `Employee` row inside a transaction, double-checks the token, and logs `AUDIT_TYPES.MEMBER_JOIN` |
| **Verdict** | **must-have** |
| Cutover risk | H |
| Why | This is the literal onboarding path that instantiates the single-tenant `Employee` row V2 is replacing. Every design decision in `Person`+`Membership` has to answer: "what does `/api/team/join` become?" |

### 1.11 Runner / Kitchen Display (KDS)

| | |
|---|---|
| API routes | consumes POS order endpoints (`/api/pos/**`), no dedicated API of its own found |
| Dashboard pages | `/runner` |
| Prisma models owned | none (reads `Order`/`OrderItem`/`PosTable`) |
| Workers touched | none |
| Evidence of real use | **`src/lib/device.js:32` and `src/middleware.js:30` both hard-route iOS devices to `/runner` as their home page** (`deviceHomePath`) — this is a dedicated kitchen-runner tablet UI, not a page someone stumbles into |
| **Verdict** | **must-have** |
| Cutover risk | H |
| Why | See §2 — this is physical hardware pointed at a URL. It is the clearest "cannot become a chat interface" screen in the whole area. |

---

## 2. Operational screens that cannot become a chat interface

These are screens where V1 code shows **device- or workflow-level commitment**, not just a nav link — they must exist in the V2 web console on day one of any cutover for this area:

1. **`/runner` (Kitchen Order Runner / KDS)** — `src/app/(dashboard)/runner/page.jsx`. Confirmed as the boot page for iOS tablets via `deviceHomePath()` in both `src/lib/device.js` and `src/middleware.js`. A physical tablet in the kitchen/pass is pointed at this URL; a chat interface cannot replace a glanceable, large-touch-target order board that a cook operates hands-dirty, order-by-order, in real time.
2. **`/pos/monitor` (Seating/Kitchen ticket monitor)** — polls every 30s, zone-filterable. Technically POS-owned but directly adjacent to kitchen flow; called out because it's the other half of the "food is cooking" visibility loop.
3. **`/schedule/calendar` (class calendar, drag-and-drop reschedule)** — `courses/CLAUDE.md` explicitly requires a confirm-modal gate on manager drag-and-drop reschedule; this is inherently a direct-manipulation UI, not a conversational one.
4. **`/kitchen/stock` and `/kitchen/ingredients` (FEFO lot table)** — a chef scanning/checking expiry dates lot-by-lot before service needs a scannable table, not a chat answer, especially under the "must use oldest lot first" rule.
5. **`/kitchen/procurement` (PO lifecycle board)** — multi-status Kanban-style tracking (draft→sent→confirmed→received→closed) that a kitchen manager works against visually.
6. **`/employees/roles`** — permission-matrix editing is exactly the kind of rare, high-stakes, must-see-the-whole-grid action that stays in the console per CLAUDE.md's own framing (LINE = intake, web = "detail, complex edits and audit").

---

## 3. Employee/identity coupling — migration hazard

V1's `Employee` model hard-codes "one person, one tenant, one password":

- **`G:\zuri\prisma\schema.prisma:264-315`** — `Employee.tenantId` is a plain required field (not a join table); `passwordHash` lives directly on `Employee`; `@@unique([email, tenantId])` — the same email can exist as a *different* Employee row per tenant, with no link between them.
- **`G:\zuri\src\lib\repositories\employeeRepo.js`** — every function (`findByEmail`, `findById`, `getEmployees`, `createEmployee`, `updateEmployee`, `deleteEmployee`) takes `tenantId` as a required scoping parameter; `createEmployee` checks `email` uniqueness only `{ email, tenantId }` (line 109); there is no concept of "this person also works at tenant B."
- **`G:\zuri\src\app\api\team\join\route.js`** — public join-by-token flow **creates a brand-new `Employee` row** (with its own `passwordHash`) scoped to `invite.tenantId`; if the same person is invited to two tenants, V1 produces two unrelated Employee records with two independent passwords.
- **`G:\zuri\src\app\api\team\invite\route.js:33`** — `emailAlreadyMember(email, tenantId)` — membership check is tenant-scoped, confirming the same design intent.
- **`G:\zuri\prisma\schema.prisma:2246`** — even `AgentStyle.employeeId` comment says `// Employee.id (not employeeId string)`, i.e. every downstream FK assumes one canonical `Employee.id` per tenant per human.
- Twelve back-relations on `Employee` (`schema.prisma:297-310`, called out in a code comment as "FEAT-033 / ADR-086") all point at this single tenant-scoped id: `assignedCustomers`, `soldEnrollments`, `instructedSchedules` (the culinary-school instructor!), `closedOrders`, `approvedOrders`, `auditLogs`, etc.

**Consequence for V2**: any V School / business-group tenant that shares staff across shops (explicitly the scenario ADR-003 and `Membership` are designed for) will, under V1's model, require that person to have N separate logins, N separate passwords, and N unrelated audit trails — with no way to see "this person" as one entity across the business group. Migrating to `Person`+`Membership` means either (a) collapsing N `Employee` rows per real human into one `Person` with N `Membership`s (data-merge problem — which email/phone is canonical when they differ across tenants?), or (b) treating each V1 `Employee` as its own `Membership` under a freshly-minted `Person` (loses any pre-existing cross-tenant identity, but is safe and reversible). No code in V1 attempts (a); it structurally cannot, since nothing links two `Employee` rows for the same human.

---

## 4. Industry-specific logic (culinary vs. generic)

Cleanly separated in `G:\zuri\src\modules\industry\culinary\`:

- **`culinary/index.js`** — explicit plugin manifest: `name: 'culinary'`, `displayName: 'Culinary School'`, lists the models it owns, the nav entries it registers, and the two core-event hooks it subscribes to (`order.created` → `enrollment/handlers/onOrderCreated`, `schedule.started` → `kitchen/handlers/onClassStarted`).
- **`culinary/index.js` doc comment**: "Culinary Industry Plugin — V School and culinary schools" — confirms the vertical.
- **Restaurant/school-specific**: FEFO lot expiry (food safety), `Recipe`↔`Course` linkage (a recipe exists to teach or serve a dish), `Certificate` milestones (`BASIC_30H`/`PRO_111H`/`MASTER_201H` — clearly a culinary-school credential ladder, not a generic loyalty tier), QR class attendance, session slots (`MORNING`/`EVENING`/`NIGHT` mapped to cooking-class time blocks).
- **Generic, reusable beyond culinary**: the procurement engine (`Supplier`/`PurchaseRequest`/`PurchaseOrderV2`/GRN — §1.3), `Warehouse`/`WarehouseStock`/`StockMovement`, and the `Employee`/RBAC system itself.
- **Separability**: **Good, at the model/hook layer** — `loadIndustryPlugin(industryName)` (`src/modules/industry/index.js`) dynamically imports the plugin by `tenant.config.industry`, so a non-culinary tenant never touches this code. **Weaker at the UI layer** — `kitchen/menu/page.jsx` directly imports `src/components/pos/RecipeLinker.jsx` and calls `/api/products/[id]/recipes`, i.e. the "generic" POS module already has recipe-linking baked in, so "drop culinary, keep POS" is not a clean cut without also touching POS's product API.
- The `food-erp/` submodule (§1.4) attempted a more industry-agnostic "unified Item catalog" (RAW_MATERIAL/BATCH_GOODS/MADE_TO_ORDER) — likely a step toward generalizing beyond culinary — but it's dead/broken, so it is not evidence of a working generalization path.

---

## 5. Lift blockers and open questions for the owner

**Lift blockers:**
- **`food-erp/` is dead code that shares a directory with live code** (§1.4). Anyone lifting `industry/culinary/kitchen/` wholesale needs to explicitly exclude `food-erp/` or they will import a broken, schema-mismatched engine.
- **Production DB lineage predates the migration history** — `G:\zuri\prisma\migrations\20260724020000_hotfix_overview_stock_deduction_marker\migration.sql` line 1-3: *"Production database lineage predates the repository migration history. Keep this additive and idempotent; do not run `prisma migrate deploy` against production until the two histories have been reconciled."* Any migration tooling built for cutover must account for this — `prisma migrate deploy` against `G:\zuri`'s actual production DB is explicitly unsafe today per this comment (informational only — not verified against the live DB, and no live-DB access was taken).
- **Module manifests (`docs/product/module-manifests/kitchen.yaml`, `enrollment.yaml`) describe a different, more elaborate design than what's implemented** — different API paths (`/api/ingredients` vs. actual `/api/kitchen/ingredients`), extra models that don't exist (`RecipeEquipment`, `StockDeductionLog`, `CourseMenu`, `CourseEquipment`, `PackageGift`, `PackageEnrollment`, `PackageEnrollmentCourse`, `InventoryItem`), and `status: scaffold` markers on both. These manifests should **not** be used as the parity source of truth for planning — the per-directory `CLAUDE.md` files and the actual schema/routes were used instead for this report and are more trustworthy.

**Open questions for the owner (only where the answer changes a verdict):**
1. **Allergen disclosure**: `kitchen/CLAUDE.md` calls allergen listing a legal requirement, but no `allergen` field exists in `Ingredient`/`Recipe`/the recipe UI. Is this (a) unimplemented and still owed, (b) tracked outside this codebase, or (c) no longer required? If (a), it changes the kitchen verdict from "must-have as-is" to "must-have + must-fix-before-cutover."
2. **Auto-absent worker**: `schedule/CLAUDE.md` documents an "auto-mark ABSENT via QStash worker" and the `enrollment.yaml` manifest lists `attendance-automark` — no such route file was found under `src/app/api/workers/`. Does it run under a different name/path, or was it never built? Changes whether attendance data can be trusted as complete.
3. **Team invite UI location**: no `(dashboard)/team/**` page directory was found, yet `/api/team/invite` and `/api/team/join` are fully built. Is the invite UI embedded inside `/employees` or `/settings`? Needed to scope the "web console must have X on day one" list precisely.
4. **`food-erp` intent**: was this FEAT22 engine meant to *replace* the current Ingredient/Recipe/Procurement design (i.e., is a schema migration to a unified `Item` catalog already planned), or is it an abandoned experiment safe to ignore entirely for V2 planning? This determines whether V2 should look at `food-erp`'s `BATCH_GOODS`/`MADE_TO_ORDER` split as a *forward-looking* spec worth honoring, or noise.
5. **Cross-tenant staff**: does the business currently have any real-world case of one person working at two tenants under V1 today (two separate logins)? If yes, the `Person`+`Membership` migration needs an explicit manual reconciliation step for those specific people before cutover.

---

## Writer Report — P4 Operations
**Status**: DONE_WITH_CONCERNS
**Output file**: docs/.rwang-tasks/parity-operations.md
**Sub-areas covered**: Kitchen (ingredients/lots/FEFO), Recipes/Menu, Procurement (Supplier/PR/PO/GRN), FEAT22 food-erp (flagged dead), Culinary Schedule (class sessions), Attendance/QR check-in, Courses/Enrollments, Certificates, Employees, Team invite/join, Runner/KDS
**Verdict counts**: must-have 10 · later 0 · drop 1 (food-erp dead code) · rebuild 0
**Screens that cannot be chat**: /runner (kitchen order runner, iOS-tablet home page), /pos/monitor (seating/kitchen ticket monitor), /schedule/calendar (drag-and-drop class reschedule), /kitchen/stock + /kitchen/ingredients (FEFO lot table), /kitchen/procurement (PO lifecycle board), /employees/roles (permission matrix editor)
**Concerns**: (1) `food-erp/` FEAT22 engine is dead/broken code co-located with live kitchen code — must be excluded from any lift, not used as a design reference. (2) Module manifest docs (kitchen.yaml, enrollment.yaml) are stale/aspirational and disagree with actual code — do not use them as the parity source of truth. (3) Allergen disclosure is documented as a legal requirement but appears unimplemented — needs owner confirmation before verdict is final. (4) `Employee` is structurally single-tenant (own password, tenant-scoped uniqueness) with 12 downstream FKs — the Person+Membership migration for this area is high-risk and has no existing V1 mechanism for merging one human's multiple tenant identities. (5) Production DB lineage predates migration history per an explicit in-repo hotfix comment — flagged as-is from the comment, not independently verified against the live database.
