# Documentation Requirements

Every change must be accompanied by the appropriate documentation tier.

| Change Type | Required Document | Template / Link |
|-------------|-------------------|-----------------|
| **Bug Fix** | `RCA` (Root Cause Analysis) | `standards/RCA-Standard.md` |
| **New Feature** | `Feature Spec` | `.agents/doc_writer/template/FEAT-template.md` |
| **Rust IPC / API** | `API Contract` (JSON Spec) | `.agents/doc_writer/template/API-CONTRACT-template.md` |
| **Schema Change** | `Migration Plan` | `.agents/doc_writer/template/MIGRATION-PLAN-template.md` |
| **Architecture** | `ADR` (Architecture Decision Record) | `.agents/doc_writer/template/ADR-template.md` |

### Validation Gate
Run `npm run docs:validate` before implementation and before marking multi-agent work done.
Run `npm run baseline:check` before the next feature begins.

The validator enforces `.agents/doc_writer/template/` as the canonical template source, checks document identifiers and frontmatter, detects stale source references, and reports legacy AC/SC/DoD gaps before they cause agent context drift.

### Approval Workflow
1. Agent proposes the document.
2. User/Architect reviews and provides "APPROVED".
3. Agent implements code based *strictly* on the approved document.
4. Document version is updated in `GEMINI.md` or `MEMORY.md`.

## CHANGELOG

| Version | Date | Status | Summary |
|---------|------|--------|---------|
