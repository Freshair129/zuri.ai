# FR-054 W2 task brief — runtime isolation probe

Implement only the environment-fed, redacted runtime-role isolation probe and focused tests under
FR-054/SEC-011. Own `src/modules/knowledge/runtime-isolation-probe.js`,
`scripts/verify-line-runtime-isolation.mjs` and `tests/unit/runtime-isolation-probe.test.js`. Do not
edit shared indexes, `package.json`, migrations or remote state.

Exit: AC-054-01..02 pass with an injected fake client; mutation assertion always rolls back; output
cannot contain password, full connection URL or authorization material. Live remote state remains
`NOT_RUN`.
