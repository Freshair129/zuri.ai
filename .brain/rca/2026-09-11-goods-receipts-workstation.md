# Goods Receipts workstation contract mismatch

Risk LOW; C-2. Baseline origin/main f320e888; retained source 412ff1f3.

## Symptom
The retained workstation cannot read a receipt detail reliably and renders
empty product/PO fields or stock-success claims for uncounted lines.

## Evidence
The retained `getGoodsReceiptDetail` spreads `RECEIPT_SELECT`, which does not
select `businessId`, then passes `row.businessId` to `loadBusiness`.
`GoodsReceiptWorkspace` renders `line.orderLine` although the selected receipt
line has only its purchase-order-line id. It prints every line as stocked,
including free-text lines. The POST response's receipt has no joined PO.
The query handler uses unbounded `parseInt`; the UI fetch callback depends on
selection and has no stale Business-response guard.

## Root cause
The prototype assumed DTO fields and posting effects not supplied by the
existing receipt service, and tested synthetic selects rather than the real
schema and viewer boundary.

## Why the issue escaped detection
The retained unit tests do not run real receipt detail joins, Business changes
or the printable result after a POST.

## Proposed prevention
Use an explicit scoped read projection with actual Prisma relations; reuse
the existing writer and its receipt/stock transaction. Validate pagination,
reset state on Business change, and add database and browser regressions.
The owner has authorized completion of this existing FR-165 workstation;
no new schema, receiving policy or production action is required.
