---
name: zuri-line-flex-report
description: Build and send Thai-first Zuri LINE Flex reports, meeting summaries, checklists, and corrected cards to a verified LINE group. Use when a user asks to create, preview, correct, or push a Flex Message, especially a report with a Google Docs CTA.
---

# Zuri LINE Flex Report

Use this skill for the complete report-card path: gather the approved content, build a UTF-8 Flex payload, verify the Zuri channel and destination, push it, and report the provider result.

## Governance boundary

This skill calls `https://api.line.me/v2/bot/message/push` directly with a LINE channel token —
the exact capability `AGENTS.md`'s permission matrix denies for the `zuri-command-agent` runtime
in `src/`. It predates that build order and is not part of it: it was found already present in
this repository, not authored under the S1–S8 sequence, and is not gated behind the outbox or
governed delivery path `src/` uses for everything else.

**Recorded decision (2026-08-31):** kept as an intentionally separate, ungoverned demonstration
path rather than retired or gated — see [Appendix E §E.4](../../docs/appendices/E-risk-matrix.md).
Retiring it or routing it through the governed outbox remains open for the owner to choose; this
note exists so that choice is visible the next time someone reads this skill, not so the skill
stops working. Until that decision is made, do not extend this skill's reach (new triggers, more
templates, other channels) without raising the same question again.

## Guardrails

- Use Zuri's voice: warm, calm, precise, capable, and non-judgmental. Thai copy uses feminine first person (`ซูริ...นะคะ`, `ฉัน...ค่ะ`).
- Never claim a message was delivered until LINE returns HTTP 200 from the push endpoint.
- Never print, commit, or write a channel token, secret, device token, or raw credential JSON. Read secrets from the approved secret store or an ignored environment file only.
- The destination must be a verified group binding. Do not invent a group ID or accept an arbitrary browser-supplied ID. For the current local POC, a user-provided group-log filename may identify the group only after the channel identity is verified.
- Treat a correction as a new card. LINE cannot edit a sent message; label it `แก้ไขข้อมูล` and state which values are authoritative.

## Workflow

1. Normalize the request into `title`, `sections`, `facts`, `links`, `destination`, and `correctionOf`.
2. Confirm factual fields against the supplied source. Keep unknown values out of the card.
3. Use the approved Zuri tokens: `zuri-amber-500 #E8820C`, `zuri-amber-700 #B86A08`, `warm-surface #FFF8F0`, `sepia-950 #1A1710`, and `rest-blue-700 #3D7A9E`.
4. Keep the card scannable. For two large sections, use a two-bubble carousel. All bubbles in a carousel must use the same `size` (`giga` is the safe default).
5. Keep `altText` short and descriptive. Use URI actions only for user-supplied, verified URLs such as the meeting Google Doc.
6. Serialize with UTF-8 and send to `https://api.line.me/v2/bot/message/push` using `{to, messages:[{type:"flex",altText,contents}]}`.
7. Verify the token with `/v2/bot/info` first and confirm the returned bot is Zuri. If the bot is EVA or another channel, stop and select the correct Zuri credential.
8. On success, report only the HTTP result, destination label, and card sections. Never echo the token or full payload.

## Standard meeting-card shape

- Bubble 1: `รายงานการประชุม` + short status + `เปิดรายงานการประชุม` URI button.
- Bubble 2: `Checklist ก่อนประชุมใหญ่` + one wrapped block per person + appointment block.
- For a correction, use one bubble with `แก้ไขข้อมูลนัดหมาย`, the corrected time, exact place, and `ข้อมูลล่าสุด` wording.

## Failure handling

- `400`: inspect the provider details. Common causes are mixed carousel sizes, invalid Flex fields, or a malformed action URL. Correct and retry once.
- `400 Failed to send messages`: verify that the Zuri bot is a member of the group and that the group ID belongs to the same channel.
- `401/403`: stop; rotate/reload the credential through the secret store. Do not ask the user to paste it into a file.
- Network timeout: do not claim delivery; return `ส่งไม่สำเร็จ` with the retryable error.
