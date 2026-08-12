# Appendix B — Database Schema Summary

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Draft |
| **Last Updated** | 2026-08-11 |

Source of truth: `prisma/schema.prisma` (SQLite; Postgres-ready ตาม DB-MIGRATION-NOTES.md)
Conventions: UUID PK · unique human `code` · `createdAt/updatedAt` · `version` บน aggregate
roots · `deletedAt` soft delete · enums เป็น string (Zod validate) · JSON เก็บเป็น string

## Models (19)

| Model | Key fields | หมายเหตุ |
|---|---|---|
| Portfolio | code, name | รากของเครือ (BR-001) |
| Tenant | portfolioId, status | ขอบเขต isolation + การแชร์ข้อมูล |
| LegalEntity / LegalEntityIdentifier | portfolioId; (country,type,value) unique | external identifier ไม่ใช่ PK (BR-002) |
| Business | tenantId, legalEntityId? | ธุรกิจปฏิบัติการ |
| Branch | tenantId, businessId | tenantId ต้องตรงกับ business (tested) |
| Person / Membership | tenant, business?, branch?, role | local demo identity |
| Workspace | scopeType (PORTFOLIO/TENANT/BUSINESS) + denormalized ancestor ids | ต้องมี scope ชัดเจน |
| Project | workspaceId, type, status, startAt/targetAt | soft delete |
| Workstream | projectId, executionMode, progressStrategy, progressWeight, progressCache, viewConfigJson | หัวใจของ 7 โหมด |
| WorkContainer | workstreamId, parentId (hierarchy), subtype, metadataJson | SPRINT/MIGRATION_STAGE/… |
| WorkItem | workstreamId, containerId?, subtype, weight, numericValue, probability, metricDataJson, metadataJson | atomic ทุกโหมด |
| Milestone | projectId, workstreamId?, weight, targetAt, completedAt | |
| Gate | projectId, workstreamId?, required, evidenceJson, status | cap progress (BR-006) |
| Dependency | (sourceType,sourceId,targetType,targetId,dependencyType) unique | cycle-checked ที่ service |
| Repository / ProjectRepository | provider, externalRepoId?, fullName; (projectId,repoId,role) unique | local metadata, m2m |
| AuditEvent | entityType, entityId, action, payloadJson, actorType | append-only (SEC-003) |

## Planned (FR-019)

`ExternalRef { entityType, entityId, system, value, labelAs }` unique(system,value)
— generalization ของ LegalEntityIdentifier/externalRepoId สำหรับ enterprise mapping

`ExternalIdentity { tenantId, personId→Person, provider, providerSubject, verifiedAt, linkedAt, revokedAt }`
unique(tenantId, provider, providerSubject) — FR-021: channel/auth identity (LINE user)
→ Person principal, tenant-scoped; personId is a real FK (V2 unified identity into Person,
ADR-003 §D10, so no polymorphic principal). Distinct from ExternalRef (data mapping).
