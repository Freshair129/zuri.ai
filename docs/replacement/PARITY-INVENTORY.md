# Parity Inventory — what must exist in V2 before a tenant can cut over

| Field | Value |
|-------|-------|
| **Version** | 0.1.0 |
| **Status** | Skeleton — to be filled by `TASK-V2-PARITY` (read-only scan of `G:\zuri`) |
| **Last Updated** | 2026-08-12 |

Every V1 module classified **must-have / later / drop** before its cutover. The
biggest saving in this whole project is the "drop" column — features nobody uses do
not get lifted.

## Method

Read-only scan of `G:\zuri` (never modified). For each module: routes, pages,
models, background workers, tests, and any evidence of real usage. Classify, then
size. Nothing is copied until its module is scheduled for cutover (ADR-003 §D3).

## Known scale (2026-08-12 scan)

| Area | Count |
|---|---|
| Prisma models | 94 |
| `tenantId` references in the schema | 255 |
| `businessId` references | 0 |
| API route handlers | 209 |
| Dashboard pages | 68 (71 of 74 files are `'use client'`) |
| `fetch('/api…')` call sites | 192 |
| Files touching `useTenant`/`TenantProvider` | 21 |
| Repositories | 66 · Test files ~300 · Migrations 12 |
| Velocity | 213 commits / 90 days |

Routes by area: workers 25 · pos 19 · integrations 15 · ai 14 · marketing 12 ·
customers 11 · automations 8 · settings 7 · webhooks 6 · liff 6 · procurement 5 ·
kitchen 5 · invoices 5 · culinary 5 · admin 5 · team 4 · orders 4 · employees 4 ·
auth 4 · products 3 · notifications 3 · inventory 3 · crm 3 · conversations 3 ·
tenant 2.

## Table to fill

| Module | Routes | Pages | Models | Workers | Verdict | Cutover order | Notes |
|---|---|---|---|---|---|---|---|
| auth | 4 | — | Employee, … | — | **rebuild** | before everything | Person/Membership + LINE login (ADR-003 §D10) |
| _(rest to be filled by TASK-V2-PARITY)_ | | | | | | | |

Verdicts: **must-have** (blocks cutover) · **later** (after the tenant is live on V2)
· **drop** (retired with V1) · **rebuild** (V2-native, not lifted).
