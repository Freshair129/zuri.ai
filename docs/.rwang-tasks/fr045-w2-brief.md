# FR-045 W2 task brief — path security and filesystem port

## Role

Local storage security lane owner. Use TDD and touch only the files below.

## Exclusive write scope

- new modules under `src/modules/project-manager/local-files/`
- `tests/unit/fr045-path-security.test.js`
- `tests/unit/fr045-filesystem-port.test.js`
- `docs/.rwang-tasks/fr045-w2-report.md`

## Contract

- Normalize a client relative path without allowing absolute, UNC, drive-relative,
  empty or `..` traversal input.
- Resolve paths under an explicit mount root and fail closed when lexical or final
  real path escapes through a symlink/junction/reparse point.
- Provide an injectable filesystem port for stage/write, atomic promote/rename,
  read/stat and cleanup. It must not import Prisma or infer Business authorization.
- Use a caller-provided staging name/root; do not watch folders, launch Explorer,
  implement cache or mutate the external mock.

## TDD / exit

RED security/port tests first, including Windows path forms and injected final-path
escape. GREEN with the smallest API. Run focused tests and `git diff --check`.
