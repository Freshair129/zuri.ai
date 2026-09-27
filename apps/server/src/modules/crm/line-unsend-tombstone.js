// @req FR-229 — the one string an unsent message's body carries, distinct from the PDPA
//   erasure tombstone in conversation-redaction-service.js: the customer withdrew the
//   message themselves, which is a different fact than "erased by legal request", so
//   the two must read differently in the FR-091 inbox. A leaf module so the chat
//   evidence archive writer can name it without importing the LINE ingest service;
//   re-exported from line-ingest-service.js unchanged.
// @tested tests/integration/line-non-text-admission.test.js, tests/integration/crm-archive-group-speakers.test.js

export const LINE_UNSEND_TOMBSTONE = '[ข้อความถูกเรียกคืนโดยผู้ส่ง]'
