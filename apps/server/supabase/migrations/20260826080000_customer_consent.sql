-- FR-103 / SEC-005: PDPA per-tenant CRM-sharing consent on "Customer".
--
-- Existing rows predate this column and were already being served — retroactively
-- defaulting them to PENDING would cut off a live conversation the moment anything
-- starts enforcing consent, so they backfill to GRANDFATHERED instead. Every
-- Customer created from here on defaults to PENDING and needs an explicit staff
-- attestation (src/modules/crm/customer-consent-service.js). Row level security on
-- "Customer" is already enforced by the blanket ENABLE ROW LEVEL SECURITY loop in
-- 20260818084011_application_schema.sql; these are additive columns on an existing
-- table, so no new policy or grant is needed.
alter table "Customer" add column if not exists "consentStatus" text not null default 'PENDING';
alter table "Customer" add column if not exists "consentRecordedAt" timestamptz;
alter table "Customer" add column if not exists "consentRecordedByPersonId" text
  references "Person"("id") on delete set null on update cascade;
alter table "Customer" add column if not exists "consentNote" text;

update "Customer" set "consentStatus" = 'GRANDFATHERED' where "consentStatus" = 'PENDING';

create index if not exists "Customer_consentStatus_idx" on "Customer"("consentStatus");
