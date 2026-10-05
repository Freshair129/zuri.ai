---
status: active
superseded_by: null
version: "0.1.0"
---

# PostgreSQL mirror guard execution authority

## Symptom

Unrelated native CRM AuditEvent redaction fails after installing the candidate PostgreSQL mirror, although direct report access must remain denied.

## Evidence

Independent review identified the audit trigger's invoker-mode SELECT of MarketingExternalReport and the migration's direct runtime grant revocation/forced RLS. Actual isolated PostgreSQL QA reproduced `42501` for the existing redaction shape (`reason=NULL, payloadJson='{}'`) under zuri_app_runtime with authorized AuditEvent SELECT/UPDATE and zero external reports. Business title, Plan title and Initiative lifecycle edits passed. The native caller is `customer-retention-consent-service.js`, which updates unrelated retention-consent AuditEvent rows.

## Root cause

The trigger checks private machine-custody relationships using the native caller's privileges. Denying that caller direct custody access also denies the trigger's lookup. The audit trigger is attached to all AuditEvent updates, so unrelated redaction cannot reach the intended no-linked-report branch. Native scope guards have the same authority mismatch when their private relationship lookup is required.

## Why the issue escaped detection

The first portability QA compiled DDL and proved anonymous/direct-access denial, but did not exercise existing native writes under a restricted runtime role. SQLite has no comparable database-role privilege model; its passing native tests do not qualify PostgreSQL trigger execution authority.

## Proposed prevention

Keep direct report access denied. Only the audit and native-scope guard trigger functions use narrow definer execution for their private relationship lookup, with fixed public/pg_temp search_path, no public/client/runtime EXECUTE grant and an explicit BYPASSRLS/superuser migration-owner prerequisite. No general-purpose reader/writer or SECURITY DEFINER receiver is introduced. Prove unrelated native updates succeed, linked audit/scope mutation still fails, and all direct custody access remains denied under the restricted role. PostgreSQL receiver runtime stays disabled and unqualified.
