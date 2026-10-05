# RCA: PMR-032 source-pin and boundary drift

Date: 2026-10-04
Scope: PMR-032 candidate provenance and plan-boundary metadata only. No change to contract semantics, canonical registration, shared tooling, generated outputs, product code or runtime.

## Symptom

PMR-032 candidate v0.2.5 is selected in the current delivery plan, but its recorded Document 20 source pin no longer matches the live file. The selected candidate path and the package's allowed file boundary also name different versions. The candidate remains unaccepted and is not usable as current-baseline evidence.

## Evidence

- Delivery plan v0.9.42b is SHA-256 a7beb8b95557f2801227c30c3b86f813af1b502746a54a3665951831c19ee670. It selects candidate v0.2.5 at docs/architecture/project-manager-system/contracts/pmr-032-governance-gap.v0.2.5.candidate.json, SHA-256 54a8e72f1ef0b54ace3cc4342957ba5829ebdee1d547aba5fba9c877fe210736, while the PMR-032 package fileBoundary still names contracts/pmr-032-governance-gap.v0.2.2.candidate.json.
- Candidate v0.2.5 records Document 20 v0.9.27b at SHA-256 5f1a3a38ca1281b609416fd339b93ef20eba20349ad02fb41f817c47034b7933. Current Document 20 is v0.9.32b, SHA-256 f502e5e97e0a30bbbacdd187af0a01d69093e368a523755249406a6c4c067ab2. The other 24 of 25 candidate source pins match the current raw worktree.
- Current context hashes are plan a7beb8b95557f2801227c30c3b86f813af1b502746a54a3665951831c19ee670, Document 08 v0.9.28b 8a52953d04305be32b8e3c464c804e694b21bc88804b27f15d35bc8990d74799, and Document 20 v0.9.32b f502e5e97e0a30bbbacdd187af0a01d69093e368a523755249406a6c4c067ab2; they differ from the earlier v0.2.5 context snapshot.
- The PMR-032 package remains CANDIDATE_READY_FOR_REVIEW. Its candidate records nine uncovered gaps OPEN, Identity owner/signatory confirmation OPEN, PMT-032 NOT_RUN/NOT_PROVEN, and acceptance NOT_PROVEN. Global dispatchable and implementationAuthorized flags remain false.
- The independent Luna Max audit returned REWORK on current-source and boundary mismatch. GPT-6-Sol authorized this one-time two-path metadata/RCA preparation with limits, and Astra concurred with limits. Those decisions authorize preparation only.
- Rollback manifest SHA-256 e02433520b0f962edd6f012c4b406e4c5c1dd52cd405aef2a9b1a6633f954507, archive SHA-256 674c757162ad39c520f0972259eb271575933f2e124045eaa57c2d686e40e050; all 34 source copies and ZIP entries were checked.

## Root Cause

The confirmed immediate cause is that versioned metadata snapshots are out of sync: v0.2.5 pins the older Document 20 bytes, while the live Document 20 and delivery plan have advanced; the current plan pointer selects v0.2.5 while its write boundary still names v0.2.2. This prevents treating the candidate's old source pins or path authorization as current.

The candidate's own provenance shows its Document 20 pin was refreshed from dirty-worktree bytes during the v0.2.5 preparation. Later root-composition receipts and the current Document 20 version make subsequent plan-document composition a plausible cause of the new drift. The exact edit or coordination step that left the pin and file boundary unsynchronized is not independently established.

## Why the Issue Escaped Detection

The earlier exact review was bound to its review-time source and context snapshot; it did not establish current-baseline readiness after later document/plan compositions. The current plan reconciliation retained review-time 25/25 wording even though the latest review limitations distinguish current-source drift. The independent current-byte recheck caught the mismatch before any v0.2.6 pointer composition or package acceptance.

## Proposed Prevention

- Before plan composition, verify the selected candidate path, version and digest against the package fileBoundary in the same prewrite snapshot.
- Rehash every declared source and each separately versioned context artifact immediately before review and composition; record review-time counts separately from post-composition current counts.
- When composition changes a pinned source, label the earlier pin as historical and reconcile the package pointer and boundary before downstream use.
- Keep owner confirmation, canonical registration, PMT-032 proof, acceptance, G0/SPEC, dispatch and implementation gates closed until their own evidence exists.

## Status

Documentation/provenance RCA only. No product defect is claimed. Candidate v0.2.6 remains unselected and unaccepted; plan pointer/fileBoundary composition is a separate decision. No tests, governance, build, implementation, runtime, migration, deployment or release were run.
