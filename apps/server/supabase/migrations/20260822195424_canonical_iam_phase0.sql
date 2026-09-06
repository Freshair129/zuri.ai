-- @req FR-094, FR-095, FR-096, FR-097, FR-098 — canonical Person/session/channel
-- identity and one server-owned authorization boundary across protected surfaces.
-- @spec ADR-045 D1-D6, SDD-052, BR-020, SEC-018
-- @tested tests/unit/canonical-iam-migration.test.js
--
-- Additive production artifact. It intentionally does not insert into
-- supabase_migrations.schema_migrations; the Supabase migration runner owns
-- that history. Apply only after remote schema/role/grant/RLS preflight,
-- backup/PITR evidence and the production IAM gate are approved.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table "Membership"
  add column if not exists "status" text not null default 'ACTIVE',
  add column if not exists "updatedAt" timestamp(3) not null default current_timestamp,
  add column if not exists "version" integer not null default 1;

create index if not exists "Membership_personId_status_idx"
  on "Membership" ("personId", "status");
create index if not exists "Membership_tenantId_status_idx"
  on "Membership" ("tenantId", "status");

create table if not exists "Session" (
  "id" text not null,
  "personId" text not null,
  "tokenHash" text not null,
  "status" text not null default 'ACTIVE',
  "assurance" text not null default 'PASSWORD',
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,
  "lastSeenAt" timestamp(3) not null default current_timestamp,
  "expiresAt" timestamp(3) not null,
  "revokedAt" timestamp(3),
  "revokeReason" text,
  "version" integer not null default 1,
  constraint "Session_pkey" primary key ("id"),
  constraint "Session_personId_fkey"
    foreign key ("personId") references "Person" ("id") on delete cascade on update cascade
);

create unique index if not exists "Session_tokenHash_key"
  on "Session" ("tokenHash");
create index if not exists "Session_personId_status_idx"
  on "Session" ("personId", "status");
create index if not exists "Session_expiresAt_status_idx"
  on "Session" ("expiresAt", "status");

create table if not exists "ChannelIdentity" (
  "id" text not null,
  "personId" text not null,
  "tenantId" text not null,
  "channel" text not null,
  "channelAccountId" text not null,
  "providerSubject" text not null,
  "status" text not null default 'PENDING',
  "verifiedAt" timestamp(3),
  "linkedAt" timestamp(3),
  "revokedAt" timestamp(3),
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,
  "version" integer not null default 1,
  constraint "ChannelIdentity_pkey" primary key ("id"),
  constraint "ChannelIdentity_personId_fkey"
    foreign key ("personId") references "Person" ("id") on delete cascade on update cascade,
  constraint "ChannelIdentity_tenantId_fkey"
    foreign key ("tenantId") references "Tenant" ("id") on delete restrict on update cascade
);

create unique index if not exists "ChannelIdentity_tenantId_channel_channelAccountId_providerS_key"
  on "ChannelIdentity" ("tenantId", "channel", "channelAccountId", "providerSubject");
create index if not exists "ChannelIdentity_personId_status_idx"
  on "ChannelIdentity" ("personId", "status");
create index if not exists "ChannelIdentity_tenantId_status_idx"
  on "ChannelIdentity" ("tenantId", "status");

-- Application identity tables are server-owned. Keep them out of the exposed
-- Data API and require the already-approved server database boundary.
alter table "Membership" enable row level security;
alter table "Membership" force row level security;
alter table "Session" enable row level security;
alter table "Session" force row level security;
alter table "ChannelIdentity" enable row level security;
alter table "ChannelIdentity" force row level security;

revoke all on table "Membership", "Session", "ChannelIdentity"
  from public, anon, authenticated, service_role;

commit;
