---
version: "0.1.0b"
created_at: "2026-09-28T07:35:00+07:00,MC0"
last_update: "2026-09-28T07:35:00+07:00,MC0"
status: "open - model credential pending"
attributes:
  domain: "line-oa"
  doc_type: "root-cause-analysis"
  scope: "The Zuri test LINE OA gave no successful reply from 2026-09-14 onward"
---

# RCA - Zuri LINE OA silent since 2026-09-14

## Complexity and risk

- **Complexity:** C-3 - configuration drift across LINE, the server env and per-business settings
- **Risk:** MEDIUM - the Zuri OA is the platform's internal test OA (4-5 testers), not a customer OA

## Symptom

The Zuri OA's last `RECORDED` job was on 2026-09-14. From 2026-09-14 to 2026-09-22 all 35 jobs
ended `FAILED`: `EXECUTION_FAILED` 16, `EXECUTION_EXPIRED` 9, `LINE_HTTP_400` 6 and
`LOCAL_POLICY_UNAVAILABLE` 4. From 2026-09-22 no traffic arrived at all. Nothing alerted on it.

## Causes (four layers, found one after another on 2026-09-28)

1. **The LINE webhook pointed somewhere else.** ngrok logged no LINE request, while a public probe
   of `/api/line-oa/accounts/<id>/webhook` answered 401 as designed. The account had no
   `webhookStateJson`. Fixed through the app's own FR-227 flow ("ลงทะเบียนและทดสอบกับ LINE"): LINE
   test `LINE_OK` 200, `active: true`.
2. **`ZURI_PHASE1_RUNTIME_SOURCE` was missing from `.env`.** With `NODE_ENV=production`, the
   phase-1 runtime refuses to start without it (`PHASE1_RUNTIME_SOURCE_REQUIRED`). `.env.example`
   says production must set `PRODUCTION_LINE`. This probably also explains the `EXECUTION_FAILED`
   jobs after 09-14 (unverified). Fixed: set to `PRODUCTION_LINE`.
3. **Legacy model placeholders in `.env`.** `ZURI_MODEL_PROVIDER`, `ZURI_MODEL_NAME` and
   `ZURI_MODEL_CREDENTIAL` held the example placeholders (`SET_PROVIDER` / `SET_MODEL_NAME`).
   `PRODUCTION_LINE` forbids any of them (`PHASE1_PRODUCTION_LEGACY_MODEL_CONFIG_FORBIDDEN`).
   Fixed: the three lines are commented out.
4. **No model credential for the business.** The SmartGift business has no `MODEL_PROVIDER`
   integration connection, so there is no model to call. **Open:** the owner chose to test local
   (`prp`), Codex CLI and Claude CLI engines. The CLI bridge is not built yet, and `prp`/LiteLLM is
   still in development and stopped.

## Why it went unnoticed

- The Zuri OA has few testers, and a failed job sends no reply, so silence looked normal.
- FR-190 transport health would have flagged the endpoint, but its hourly sweep logs only to the
  container, and those logs are lost when a container is recreated.
- The readiness journey in LINE Studio showed steps 3 and 5 as pending, but no one was watching it.

## Follow-ups

- Build the CLI model bridge (Codex/Claude), or enable `prp` when it is ready. Then run a test
  message end to end.
- Consider alerting when a `serverEnabled` account has more than N consecutive `FAILED` jobs, and
  when an endpoint probe is not OK.
- Consider a boot-time config self-check: `PRODUCTION_LINE` set, no legacy model env, a
  business model credential present for each `serverEnabled` account.
