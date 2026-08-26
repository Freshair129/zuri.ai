# The approval surfaces, exactly

## 1. Project gate

A Gate belongs to a Project (optionally to a Workstream), is `required` or not, carries
free-form `evidence`, and has one of four statuses: `OPEN`, `PASSED`, `BLOCKED`,
`WAIVED`. Progress calculators stop treating a gate as blocking once it is `PASSED` **or**
`WAIVED` — which is why a waiver is a real decision, not paperwork.

Read: `GET /api/milestones?projectId=<id>` returns `{ milestones, gates }`, gates with
their parsed `evidence`.

Write: `PATCH /api/gates/{id}`

```json
{
  "status": "PASSED",
  "evidence": {
    "approvedBy": "<the human who decided>",
    "approvedAt": "2026-08-20T11:15:00+07:00",
    "reviewTicket": "SEC-4412",
    "note": "penetration test report attached in SEC-4412"
  }
}
```

`evidence` is **merged** into what is already stored, so a partial patch never erases the
prior record. Authority: the server requires write authority over the Business that
governs the project; a viewer without it gets a refusal that is deliberately
indistinguishable from "gate not found" — do not try to tell them apart.

## 2. Customer import review queue

A Business-scoped, redacted duplicate-review queue. It records decisions; it does **not**
publish Customer rows — applying them is a separate, governed step.

Read: `GET /api/platform/customer-import-reviews?businessId=<id>` (and
`/targets` for masked candidates). Names come back masked; that is the contract, not a
rendering accident.

Write: `POST /api/platform/customer-import-reviews/{caseId}/decisions`

```json
{
  "businessId": "<business id>",
  "expectedVersion": 3,
  "decisions": [
    { "provenanceId": "<provenance id>", "action": "LINK_EXISTING", "targetCustomerId": "<customer id>" },
    { "provenanceId": "<provenance id>", "action": "CREATE_SEPARATE" }
  ]
}
```

Rules the server enforces, so build the payload to match:

- permission `customer.import.review.decide` at that Business, and an authenticated
  actor — the decision is bound to the person, not the session;
- `expectedVersion` must equal the version you read (optimistic lock; `409` = re-read);
- each `provenanceId` appears at most once per request;
- `LINK_EXISTING` requires `targetCustomerId`; no other action may carry one;
- free-text `note` is rejected — the queue holds no raw PII.

## 3. Knowledge source approval artifact

Not an endpoint: a file, validated against
`contracts/business-knowledge-approval.schema.json`.

```json
{
  "contractVersion": "1.0.0",
  "sources": [
    {
      "source_sha256": "<64 hex chars — the exact bytes approved>",
      "approved_by": "<named human>",
      "approved_at": "2026-08-20T11:15:00+07:00",
      "as_of": "2026-08-19T00:00:00Z",
      "publish_price": false
    }
  ]
}
```

- `source_sha256` binds the approval to **those bytes**. Change the source, and the old
  approval is void — produce a new one; never edit the old file's hash or timestamp.
- `publish_price` is a deliberate, separate consent. Default it to `false` and only set it
  when the human said so about that specific source.

## Reading a refusal

| Status | Meaning | Correct next move |
|---|---|---|
| `401` | no authenticated session | stop; re-establish the connection with the human |
| `403` | this viewer holds no authority there | report it, name the record and Business, stop |
| `404` | absent **or** not yours — intentionally identical | ask the human for the id; never enumerate |
| `409` | the record moved since you read it | re-read, show what changed, ask again |

A refusal is an answer from the system of record. Reporting it accurately is the job;
routing around it is the one thing this skill exists to prevent.
