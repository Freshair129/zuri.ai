---
name: zuri-calendar-meeting
description: Create and verify Google Calendar meetings from Thai chat notes, including Friday scheduling, exact venue, bounded end-time assumptions, and a handoff link. Use when a user asks to add a meeting, appointment, or extracted chat schedule to Google Calendar.
---

# Zuri Calendar Meeting

Create one authoritative calendar event from a meeting brief, then verify the saved title, date, timezone, time range, and location.

## Required input

- `summary`: concise meeting title.
- `date`: explicit date, or a resolvable phrase such as `วันศุกร์นี้` in `Asia/Bangkok`.
- `startTime` and `endTime`: local time. If the request says `หลัง 18:00 เป็นต้นไป` without a fixed end, use a bounded operational default of 19:00 only when the user has accepted that assumption; put the continuation wording in the description.
- `location`: preserve the source spelling exactly. Current example: `Workwize ชั้น 3, The Street Ratchada`.
- `description`: agenda, responsibilities, source links, and any continuation note.

## Account and safety

1. Prefer a connected Google Calendar connector/API. If unavailable, use the logged-in Chrome Calendar UI.
2. Verify the visible account email before creating anything. For this workflow the requested account is `etohcolsgroup@gmail.com`; if it is not logged in, stop at the account chooser and ask the user to sign in. Never enter or request a password or OTP.
3. Creating an event is an external write. Proceed only when the user explicitly asked to create it (as in this workflow).
4. Do not add attendees, send invitations, or change sharing unless the user explicitly requests those actions.

## Workflow

1. Convert relative dates using `Asia/Bangkok` and state the resolved date in the event description.
2. Use a clear title, for example `ประชุมทีม SmartGift — เตรียมประชุมใหญ่วันศุกร์`.
3. Set the exact venue in the Calendar location field.
4. Put the Google Docs report URL and the responsibility checklist in the description. Do not paste secrets or private tokens.
5. Save the event.
6. Re-read the event detail and verify: account, date, start, end, timezone, location, title, and link.
7. Report the saved event link and the resolved time. If verification fails, report `ยังยืนยันการบันทึกไม่ได้` instead of claiming success.

## Current meeting mapping

- Time: `12:00–19:00` as the bounded calendar window when the source says `12:00 ถึงหลัง 18:00 เป็นต้นไป`; description must say `ดำเนินต่อเนื่องหลัง 18:00 น. เป็นต้นไป`.
- Place: `Workwize ชั้น 3, The Street Ratchada`.
- Include the supplied Google Docs meeting-report link.
- Keep the event on the requested account only.
