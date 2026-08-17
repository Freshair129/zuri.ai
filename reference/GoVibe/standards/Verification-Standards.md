# Verification Standards

Priority of evidence for marking a task as verified:

1.  **Automated Tests**:
    - Frontend: `Vitest` for unit/component tests.
    - Backend: `cargo test` for Rust logic.
    - IPC: Integration tests between React and Rust.
2.  **Reproduction Scripts**: Scripts or `curl` commands that prove a bug is fixed or a feature works.
3.  **Static Analysis**:
    - `tsc` for type checking.
    - `eslint` for code style.
    - `cargo clippy` for Rust best practices.
4.  **Visual Evidence**: Screenshots or screen recordings for UI/UX changes (comparing against Master Template).
5.  **Manual Inspection**: Peer review of the logic and surgical nature of the changes.

*Evidence must be attached to the Task/PR for final sign-off.*
