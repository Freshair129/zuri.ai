# Definition of Done (DoD)

GoVibe enforces a strict 3-gate verification process for every task to ensure stability and maintainability.

## 🟢 Gate 1: Acceptance Criteria
- [ ] **Spec/Doc Approved**: Documentation-First (DDD) mandate must be met. Approval from Boss/Architect is required before coding.
- [ ] **Docs Updated**: Relevant files updated (`README.md`, `GEMINI.md`, or JSDoc).
- [ ] **Test Plan Approved**: Verification steps are defined and agreed upon.

## 🔵 Gate 2: Success Criteria
- [ ] **Code Complete**: No `TODO`, `FIXME`, or unused debug logs.
- [ ] **Type Safety**: TypeScript strict mode passed (no `any` without extreme justification).
- [ ] **Formatting**: Code follows `Prettier` and `ESLint` rules.
- [ ] **Visual Fidelity**: UI matches the Glassmorphism theme and original Master Template.
- [ ] **Build Check**: `npm run dev` and `cargo tauri dev` run without errors.

## 🔴 Gate 3: Exit Criteria
- [ ] **Tests Passed**: Automated tests (Vitest/Rust tests) or manual verification evidence provided.
- [ ] **Regression-Free**: Existing features remain functional.
- [ ] **Surgical Review**: Git diff contains only lines relevant to the specific task scope.
- [ ] **Risk Mitigated**: Any identified risks during the process are addressed or documented.

---
*Failure at any gate prevents the task from being marked as DONE.*

## CHANGELOG

| Version | Date | Status | Summary |
|---------|------|--------|---------|
