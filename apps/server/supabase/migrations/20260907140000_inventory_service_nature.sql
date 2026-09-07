-- FR-168 — SERVICE joins TRACKED and UNTRACKED as a third product nature.
--
-- There is no column to add and no data to move: "Product"."stockPolicy" is a
-- TEXT column with no CHECK constraint, so the new value is already storable
-- (`enums.js` is the source of truth for the vocabulary, per the repository's
-- own convention that enums are strings in the database). What IS wrong after
-- FR-168 is this table's own description, which still tells a reader inspecting
-- the database that there are two natures.
--
-- A comment is not decoration here. It is the only thing a person querying
-- production sees when they ask what `stockPolicy` may hold, and a stale one
-- would say a service is an uncounted good — the exact conflation FR-168
-- exists to end.

COMMENT ON TABLE "Product" IS 'FR-154, FR-168 — product / SKU (product_id): stockPolicy is TRACKED (a counted good: every movement is a ledger row and on-hand is their sum), UNTRACKED (a good the Business chose not to count: no ledger, so no on-hand at all rather than a zero) or SERVICE (not a good: no stock fields, never received into a warehouse, refused by movementRule and by a goods receipt). trackingMode NONE, LOT or SERIAL, and only a TRACKED product may be anything but NONE; safetyStock. On-hand is not stored here — it is the sum of StockMovement.';

COMMENT ON COLUMN "Product"."stockPolicy" IS 'FR-168 — TRACKED | UNTRACKED | SERVICE. The three differ in accounting, not only in bookkeeping: a TRACKED good holds its cost in stock until the goods leave, an UNTRACKED good is still a good but carries no perpetual count, and a SERVICE is not a good at all.';

COMMENT ON COLUMN "Product"."trackingMode" IS 'FR-154, FR-168 — NONE | LOT | SERIAL. Anything without a stock ledger (UNTRACKED or SERVICE) is stored as NONE: it cannot carry lot or serial identity it can never have.';
