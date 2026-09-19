-- @req FR-094, FR-095 — multi-factor authentication factors (TOTP, SMS) and session assurance.
-- @spec ADR-045 D2, D5, SDD-052, SEC-018
--
-- Additive production migration for P2 Enterprise IAM readiness.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table "Session"
  add column if not exists "assuranceLevel" text not null default 'AAL1',
  add column if not exists "elevatedUntil" timestamp(3);

create table if not exists "MfaFactor" (
  "id" text not null,
  "personId" text not null,
  "type" text not null,
  "secret" text not null,
  "label" text,
  "status" text not null default 'PENDING',
  "verifiedAt" timestamp(3),
  "revokedAt" timestamp(3),
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp,
  "version" integer not null default 1,
  constraint "MfaFactor_pkey" primary key ("id"),
  constraint "MfaFactor_personId_fkey"
    foreign key ("personId") references "Person" ("id") on delete cascade on update cascade
);

create index if not exists "MfaFactor_personId_status_idx"
  on "MfaFactor" ("personId", "status");

commit;
