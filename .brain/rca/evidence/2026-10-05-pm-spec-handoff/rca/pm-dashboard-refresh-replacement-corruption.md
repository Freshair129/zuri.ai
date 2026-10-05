# RCA: PM execution dashboard refresh replacement corruption

Date: 2026-10-05

## Symptom

The first refresh attempt produced an HTML file whose embedded dashboard JSON could not be parsed. The dashboard was restored from its verified prewrite snapshot, then refreshed using literal replacement and prewrite JSON validation.

## Evidence

- Verified dashboard preimage SHA-256: `50a607b36530ac3390ca0f59fb3dd47cb84da91d7ceb0fda88bb9f26d5de773a`.
- Failed write SHA-256: `244b6391d7c2f2827a2adaaefc1cdf556826c21c3af0c00a6931e3e3266c7e12`.
- `ConvertFrom-Json` failed at `requirementTrace[176].title`; the extracted context showed HTML markup inside the JSON script element.
- The rollback restored the exact preimage SHA. The successful refresh parsed before writing and after writing; final SHA-256: `5108e97d8a78188a0531467f72f4da0630bcefedf27a6933c6edfb625a48aaa5`.

## Root Cause

The refresh used `.NET Regex.Replace` with a replacement string for the full JSON payload. The dashboard data contains regular-expression text with `$` end anchors, and regex replacement strings interpret `$` sequences as substitution syntax. That altered the payload and inserted part of the surrounding HTML.

## Why the issue escaped detection

The first attempt parsed the dashboard JSON only after writing the file. The prewrite guard checked source replacement counts but not the complete serialized payload.

## Proposed prevention

Validate the complete edited JSON in memory before writing. Replace the captured script block with literal `String.Replace`, not regex replacement-string semantics. Keep the verified prewrite backup and parse the payload again after writing.
