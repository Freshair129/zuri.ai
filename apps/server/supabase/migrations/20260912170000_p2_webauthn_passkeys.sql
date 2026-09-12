-- @req FR-094, FR-095 — WebAuthn / FIDO2 Passkey credentials.
-- @spec ADR-045 D2, D5, SDD-052, SEC-018
--
-- Additive production migration for P2 WebAuthn / FIDO2 Passkey readiness.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists "PasskeyCredential" (
  "id" text not null,
  "personId" text not null,
  "credentialId" text not null,
  "publicKey" text not null,
  "counter" integer not null default 0,
  "deviceLabel" text,
  "aaguid" text,
  "transports" text,
  "status" text not null default 'ACTIVE',
  "lastUsedAt" timestamp(3),
  "revokedAt" timestamp(3),
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp,
  "version" integer not null default 1,
  constraint "PasskeyCredential_pkey" primary key ("id"),
  constraint "PasskeyCredential_personId_fkey"
    foreign key ("personId") references "Person" ("id") on delete cascade on update cascade
);

create unique index if not exists "PasskeyCredential_credentialId_key"
  on "PasskeyCredential" ("credentialId");

create index if not exists "PasskeyCredential_personId_status_idx"
  on "PasskeyCredential" ("personId", "status");

create index if not exists "PasskeyCredential_credentialId_idx"
  on "PasskeyCredential" ("credentialId");

commit;
