# FR-045 W0 task brief

Freeze the implemented FR-037 ProjectFile request/response/routes, count current
SQLite rows, hash/classify the external mock filesystem without mutation, and define
exclusive write seams for W1/W2/W3. Inputs: ADR-016, FR-045, ZV2-CR-001, current
Prisma schema, ProjectFile service/routes/tests and the external mock root.

Exit: focused compatibility test passes; inventory is exact and non-destructive;
W1/W2/W3 share no write-owned file.
