---
domain: inventory
feature: FR-210
module: inventory
source: v2-native
bundle: FEAT-032
requirements:
  - FR-210
version: "0.1.0"
status: building
---

# FR-210 — The LINE `#sku` command

## Intent

A shop owner is on LINE all day and at a computer rarely. Adding a new product
from a supplier's message, or attaching the barcode printed on a carton to the
SKU it belongs to, should not wait for the back office. This FR lets that owner
do it from LINE through the same catalogue intake Excel and JSON use (FR-208),
so the phone gets exactly the same resolve-before-create and all-or-nothing
guarantees as a spreadsheet of 500 rows.

## How it is used

```text
#sku
รหัส: TMB-BLK
ชื่อ: แก้วเก็บความเย็น สีดำ
สินค้าหลัก: PM-TUMBLER
บาร์โค้ด: 8850123456786
หน่วยแปลง: BOX12=12
---
รหัส: TMB-RED
สินค้าหลัก: PM-TUMBLER
```

The reply is the preview: one line per item saying whether it creates a SKU,
matches an existing one (and by barcode or by code), or cannot be saved and why,
followed by `#sku ยืนยัน CIT-XXXXXXXX`. Nothing is written until that
confirmation arrives. `#sku ยกเลิก CIT-XXXXXXXX` discards it; `#sku` alone
replies with the help text. A new master needs `หมวด:` and `ชื่อสินค้าหลัก:`.

## Decisions worth recording

**A command, not a model tool.** The runtime has no tool-calling loop and no
LINE confirm mechanism, and building both to add products would put model
output on a write path. A deterministic grammar needs neither; the preview reply
is the confirmation step (ADR-084 D4).

**Who may use it (BR-042).** A direct chat, from a sender whose LINE channel
identity for that account is verified (FR-097), whose person resolves to a viewer
with Inventory write authority — Business OWNER or `INVENTORY_MANAGER` — in the
account's own Business. Tenant and Business come from the claimed job, never
from the message.

**Everyone else gets the normal answer.** A customer typing `#sku`, a member
without write authority, an unverified sender or a group chat is answered by the
model as if the command did not exist, so probing it reveals nothing.

**Only the previewer confirms.** A confirmation or cancellation naming someone
else's preview is answered "not found", as a 404 would be.

**A digit run is a GTIN.** Eight, twelve, thirteen or fourteen digits under
`บาร์โค้ด` are declared a GTIN, so a mistyped digit fails its check digit and is
reported instead of being stored as a barcode nobody can scan.

**Unknown keys stop the preview.** Silently dropping a line such as `ราคา: 99`
would commit less than the person meant, so the reply names the line and nothing
is previewed.

**Refusals are replies.** A stale plan, an expired preview or a writer's refusal
becomes a Thai reply; throwing would fail the LINE job and the person would get
no answer at all.

**Thread memory is not appended.** A command message bypasses the model and its
MSP thread memory; the message itself is still recorded as a conversation message
at admission, as every inbound message is.

## Delivered (local, 2026-09-13)

- `src/modules/inventory/import/catalog-line-command.js` — parser and reply formatters.
- `src/modules/agent/line-catalog-command.js` — `withLineCatalogCommand`, `lineCatalogViewer`.
- `src/app/api/line-oa/worker/route.js` — the worker's answer port is wrapped.
- Tests: `tests/unit/inventory-catalog-line-command.test.js`,
  `tests/unit/agent-line-catalog-command.test.js`,
  `tests/integration/fr210-line-catalog-command.test.js`.

## Not in this slice

Files or images sent over LINE (the native path admits text only); stock
quantities; editing an existing SKU's name or price from LINE; the legacy
`POST /api/agent/line-webhook` path, which never serves a `serverEnabled` account.
