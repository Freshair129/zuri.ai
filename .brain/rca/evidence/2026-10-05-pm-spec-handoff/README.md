# PM specification RCA context pack

This folder contains byte-preserving snapshots for independent analysis on another machine. Every copy is evidence only: it does not replace the canonical document, accept a candidate, close owner/G0/SPEC gates, or authorize dispatch or implementation.

- ../2026-10-05-pm-spec-dag-two-day-progress-loop.md is the RCA and timeline.
- inputs/delivery-plan-v0.9.46b-precomposition.json is the exact reviewed preimage; SHA-256 9138bb3f...
- inputs/delivery-plan-v0.9.47b-postcomposition.json is the current post-composition candidate plan; SHA-256 2b83dc3b...
- inputs/pmr-025-precomposition-inputs-v0.9.46b.zip and its manifest preserve the verified 49-file prewrite input snapshot.
- The v0.1.8 predecessor, v0.1.9 selected candidate and exact composition proposal are copied under inputs/.
- source/ contains the exact current dashboard input documents, including current edited working-tree versions and generated FEATURE-MAP.
- rca/ contains the dashboard replacement RCA and the referenced PMR-032 source-pin RCA.
- dashboard/pm-execution-progress-r8.html is the refreshed view, plan v0.9.47b, SHA-256 8151b0dc...

The nested .gitattributes disables line-ending conversion for this evidence directory, preserving snapshot bytes across Windows checkouts. Use manifest.json to verify every copied file. The plan remains candidate-only: 43 packages, 90 edges, 13 waves; 3 ACCEPTED, 12 CANDIDATE_READY_FOR_REVIEW, 24 PLANNED, 4 blocked; all PMR-025 questions remain open; dispatchable=false; implementationAuthorized=false. Governance for the post-composition plan, product tests, build and runtime are NOT_RUN.

The handoff branch excludes the unrelated modified/untracked files in the source worktree. Review the branch-base docs/ as repository context, and use these snapshots when an exact working-tree version is needed.