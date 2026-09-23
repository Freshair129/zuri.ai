---
version: "0.2.0b"
status: "beta"
attributes:
  domain: "agent-governance"
  doc_type: "complexity-rule"
  scope: "TASK-ZAI-001"
---

# RCA: server LINE work tool rejected a verified subject on a legacy account row

## Symptom

The live signed `/projects` probe reached the server worker, but both the
pending and linked synthetic subjects received the same generic tool refusal.
The linked subject did not reach the expected scoped Project read.

## Evidence

- The live `LineOaAccount` was `CONNECTED`, server-enabled and had a null
  `bindingCode`.
- Admission intentionally derives `channelAccountId` as
  `bindingCode || account.id`.
- The linked `ChannelIdentity` was `ACTIVE`, verified and bound to the canary
  Person, but the live job still produced the generic tool denial.
- `line-project-work-tools.js` compared `job.account.bindingCode` directly to
  the admitted `job.channelAccountId`, so null could never equal the account id.

## Root Cause

The admission path and the server-bound Project/Work tool used different
effective channel-key rules for accounts whose optional binding code is absent.
The tool scope fence therefore rejected a job after admission, even when the
channel identity was verified and the Membership was in scope.

## Why the issue escaped detection

The integration fixture always supplied a non-null `bindingCode`, so the
strict comparison passed in local tests. The production account was an older
row with the optional binding unset.

## Proposed prevention

Use `bindingCode || account.id` in the tool-side scope fence, keep admission and
tool tests on the same effective-key contract, and retain a regression test for
legacy rows with a null binding code.

## Resolution

Applied the surgical fallback and the focused null-binding-code regression test.
The focused integration file passes 16/16 tests, and the fix was deployed in
the production-baseline image
`zuri-ai-web-ki17:task-zai-001-20260922` with manifest digest
`sha256:b727a64c7167f78995188cff8b6801359eb7b3f38b080ffe0581dbf237c66261`.

The post-deploy signed loopback canary confirms the boundary: the linked
verified subject reached `ANSWER_READY` with a non-generic answer, while a new
pending subject stayed `PENDING` and received the generic denial. Both jobs
ended with `LINE_HTTP_400` only because the synthetic reply token is not valid
for provider delivery; no real LINE delivery is claimed. The same result was
repeated after the follow-up MSP allowlist deployment
`zuri-ai-web-ki17:task-zai-001-20260922-r2`.
