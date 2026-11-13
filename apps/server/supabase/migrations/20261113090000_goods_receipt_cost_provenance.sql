BEGIN;

-- FR-165 / FR-175: retain the inputs and locked conversion used for receipt landed cost.
ALTER TABLE "GoodsReceipt"
  ADD COLUMN IF NOT EXISTS "fxCostSheetId" TEXT,
  ADD COLUMN IF NOT EXISTS "fxRateLocked" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "landedCostsJson" TEXT;

ALTER TABLE "GoodsReceiptLine"
  ADD COLUMN IF NOT EXISTS "unitCostSatang" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'GoodsReceipt_fxCostSheetId_fkey'
      AND conrelid = '"GoodsReceipt"'::regclass
  ) THEN
    ALTER TABLE "GoodsReceipt"
      ADD CONSTRAINT "GoodsReceipt_fxCostSheetId_fkey"
      FOREIGN KEY ("fxCostSheetId") REFERENCES "SupplierCostSheet"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "GoodsReceipt_fxCostSheetId_idx" ON "GoodsReceipt"("fxCostSheetId");

COMMIT;
