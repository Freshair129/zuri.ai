-- FR-122 — a Profile states who the person is, not just what to call them.
--
-- Given name, family name and telephone number, collected at FR-066's Profile
-- step over the display name it already took.
--
-- Nullable on purpose, and the reason is a constraint rather than a preference:
-- Person rows already exist that can never satisfy these columns. `prisma/seed.js`
-- and FR-107's operator bootstrap create people from a code and a display name,
-- and FR-023's LINE ingest creates one on first contact from a `lineUserId`
-- alone — it has a channel subject and nothing else to offer. A NOT NULL here
-- would make that intake path unwritable and take the primary surface down.
--
-- The requirement lives at the profile boundary instead, which is the only
-- place a person states these things themselves.
ALTER TABLE "Person" ADD COLUMN "firstName" TEXT;
ALTER TABLE "Person" ADD COLUMN "lastName" TEXT;
ALTER TABLE "Person" ADD COLUMN "phone" TEXT;
