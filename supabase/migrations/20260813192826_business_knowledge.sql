-- @req FR-047 - curated public business knowledge for the LINE pilot.
-- @spec SDD-025, SEC-009 - server-only read; no vector extension or customer/financial fields.
-- @tested tests/unit/supabase-business-knowledge.test.js

create table if not exists public.business_knowledge (
  knowledge_id text primary key,
  business_id text not null,
  knowledge_type text not null check (knowledge_type = 'PRODUCT'),
  product_code text not null,
  name text not null,
  category text,
  description text,
  unit text,
  sell_price numeric(14, 2) check (sell_price is null or sell_price >= 0),
  currency text check (currency is null or char_length(currency) = 3),
  moq integer check (moq is null or moq >= 0),
  colors text[] not null default '{}',
  specification jsonb not null default '{}'::jsonb,
  source_ref text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-fA-F]{64}$'),
  as_of timestamptz not null,
  approved_at timestamptz not null,
  is_active boolean not null default true,
  sensitivity text not null default 'PUBLIC' check (sensitivity = 'PUBLIC'),
  contract_version text not null default '1.0.0' check (contract_version = '1.0.0'),
  unique (business_id, product_code)
);

create index if not exists business_knowledge_active_product_idx
  on public.business_knowledge (business_id, is_active, product_code);

alter table public.business_knowledge enable row level security;
alter table public.business_knowledge force row level security;

revoke all on table public.business_knowledge from anon;
revoke all on table public.business_knowledge from authenticated;
grant select on table public.business_knowledge to service_role;

comment on table public.business_knowledge is
  'FR-047 allow-listed product knowledge. Server-only Phase 1 LINE read projection.';
