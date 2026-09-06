/**
 * The wire shapes of the cloud's edge extraction lane, restated on the device side.
 *
 * The cloud owns this contract — `contracts/edge-extraction-job.schema.json` in the
 * zuri-ai repository, delivering its FR-143 (extraction job lane) and FR-144 (edge
 * device credential). This module is the device's reading of it: the four payloads it
 * sends, the job it receives, and the candidate it must produce. A copy of the schema
 * lives in `tests/fixtures/edge-extraction-job.schema.json` and a contract test
 * validates a real extractor output against it, so a drift between this file and the
 * cloud's shape fails here rather than at a customer's device.
 *
 * Nothing in this file touches the network or the model. It is types, builders and two
 * pure functions, so the payload rules can be tested without either.
 */

/** The job lifecycle as the device sees it. */
export type ExtractionJobStatus = 'QUEUED' | 'CLAIMED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/**
 * The MIME types the cloud declares it will hand over. Anything else is a contract
 * violation on the cloud side, and the device fails the job rather than guessing.
 */
export const EXTRACTION_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export type ExtractionMime = (typeof EXTRACTION_MIME_TYPES)[number];

/**
 * `ASSET_EVIDENCE_DOCUMENT_TYPES` from the cloud's `src/lib/validation/enums.js`.
 *
 * The cloud is the source of truth and this is a copy, which is a cost worth naming:
 * the device cannot import a JavaScript module out of another repository at runtime, and
 * the alternative — sending whatever string the model produced — makes the cloud reject
 * the candidate and fail the job. A value outside this list is coerced to `OTHER` rather
 * than passed through, so an enum that gains a member degrades to a reviewable candidate
 * instead of a failed job.
 */
export const EXTRACTION_DOCUMENT_TYPES = ['RECEIPT', 'INVOICE', 'PAYMENT_SLIP', 'DELIVERY', 'OTHER'] as const;
export type ExtractionDocumentType = (typeof EXTRACTION_DOCUMENT_TYPES)[number];

export interface ExtractionJobEvidence {
  mime: ExtractionMime;
  byteSize?: number;
  documentType?: string | null;
}

export interface ExtractionJob {
  id: string;
  businessId: string;
  evidenceId: string;
  status: ExtractionJobStatus;
  claimedByDeviceId?: string | null;
  claimedAt?: string | null;
  /** Ten minutes after the claim. Past it the cloud requeues the job and refuses a late report. */
  leaseExpiresAt?: string | null;
  attempts: number;
  provider?: 'openai' | 'edge' | null;
  model?: string | null;
  error?: string | null;
  version: number;
  evidence?: ExtractionJobEvidence;
  createdAt: string;
  updatedAt?: string;
}

/** One extracted field. Strict: the cloud's schema sets `additionalProperties: false`. */
export interface CandidateField {
  field: string;
  value: string | number | boolean | null;
  confidence: number;
  page?: number | null;
  anchor?: string | null;
  bounds?: { x: number; y: number; width: number; height: number } | null;
}

export interface ExtractionCandidate {
  schemaVersion: '1.0';
  status: 'CANDIDATE';
  documentType: string;
  fields: CandidateField[];
}

/** What an extractor returns, and what `complete` posts. */
export interface ExtractionResult {
  candidate: ExtractionCandidate;
  /** The local model that produced it, as the device reports it. Recorded on the job. */
  model: string;
}

/** The cloud caps a candidate at 200 fields; more is a 400 and a failed job. */
export const MAX_CANDIDATE_FIELDS = 200;
/** The cloud caps a fail reason at 1000 characters. */
export const MAX_FAIL_REASON_LENGTH = 1000;

const DEFAULT_BASE_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 30000;
/** Beyond this the curve is flat at the cap; kept explicit so `2 ** attempt` cannot overflow. */
const MAX_BACKOFF_ATTEMPTS_TRACKED = 10;

/**
 * Exponential backoff with a hard cap, for 5xx and network failures only.
 *
 * An empty queue is not a failure and never comes here — it uses the plain poll interval,
 * or a device that has nothing to do would back away from a cloud that is perfectly
 * healthy. `attempt` is 1-based: the first failure waits `baseMs`.
 */
export function computeBackoffMs(
  attempt: number,
  baseMs: number = DEFAULT_BASE_BACKOFF_MS,
  maxMs: number = DEFAULT_MAX_BACKOFF_MS
): number {
  const bounded = Math.min(Math.max(Math.trunc(attempt), 1), MAX_BACKOFF_ATTEMPTS_TRACKED);
  return Math.min(baseMs * 2 ** (bounded - 1), maxMs);
}

/**
 * The claim body: empty by design.
 *
 * The cloud rejects a non-empty body with 400 on purpose (its ADR-059 D2) — scope comes
 * from the credential, so a device naming a Business or a job id could otherwise reach
 * work that is not its own. Sending `{}` rather than nothing keeps the request a
 * well-formed JSON POST while asserting exactly that.
 */
export function buildClaimPayload(): Record<string, never> {
  return {};
}

export function buildCompletePayload(candidate: ExtractionCandidate, model: string): ExtractionResult {
  return { candidate, model };
}

/**
 * The fail body.
 *
 * A reason is shown to a Human in the cloud console, so it is prose, not a stack trace —
 * and the cloud's schema forbids a credential, host or path in it. Both are enforced here
 * rather than trusted to every call site: the reason is scrubbed of anything key-shaped
 * and clipped to the contract's length before it leaves the device.
 */
export function buildFailPayload(reason: unknown): { reason: string } {
  const text = scrubSecrets(typeof reason === 'string' ? reason : String(reason ?? '')).trim();
  const safe = text.length > 0 ? text : 'การอ่านเอกสารล้มเหลวโดยไม่มีรายละเอียด (extraction failed without a reported reason)';
  return { reason: safe.slice(0, MAX_FAIL_REASON_LENGTH) };
}

/**
 * Everything credential-shaped, removed.
 *
 * The device key is never put into a message in the first place — no code path in this
 * folder interpolates it into a URL, a log line or an `Error`. This is the second lock
 * on the same door, because the failure it guards against is silent and permanent: a key
 * printed once into a log or posted once into a `fail` reason is a key that has to be
 * revoked, and nobody finds out from the log itself. `edgk_` is the cloud's device-key
 * prefix (FR-144); `Bearer …` catches a whole header echoed by some future helper.
 */
export function scrubSecrets(text: string): string {
  return String(text)
    .replace(/edgk_[A-Za-z0-9_\-]+/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9_\-.=]+/gi, 'Bearer [REDACTED]');
}

/**
 * The confidence given to a field the local model reported but nothing verified.
 *
 * The local vision models this runtime can run return no per-field probability — no
 * logprob, no self-reported score worth believing — so the number has to be chosen, and
 * choosing it honestly matters more than choosing it precisely. A Human reviews these
 * candidates in the console reading the number as the machine's own certainty. Anything
 * at or above 0.5 says "more likely right than wrong", which nothing here supports;
 * anything near zero would read as "the model found nothing", which is also untrue.
 *
 * 0.3 is deliberately below the midpoint and below any threshold that would auto-accept,
 * and it is identical on every field on purpose: a varying invented number would let a
 * reviewer read differences in confidence that carry no information at all. If a model
 * that reports a real per-field score is wired in later, it should replace this constant
 * rather than be blended with it.
 */
export const UNVERIFIED_FIELD_CONFIDENCE = 0.3;

/**
 * Coerce whatever the model produced into a candidate the cloud will accept.
 *
 * Strictness here is not tidiness: the cloud validates with `additionalProperties: false`
 * and rejects a bad candidate with a 400 that also **fails the job**. So a stray key from
 * a chatty model costs a real extraction, and the fix is to emit only what the contract
 * names, not to hope.
 *
 * `bounds` is dropped entirely. A text-and-image chat model can describe where it saw
 * something, but it cannot measure a box, and a fabricated rectangle would draw a
 * highlight over the wrong part of a document the reviewer is trusting it to point at.
 */
export function normaliseCandidate(
  raw: unknown,
  fallbackDocumentType?: string | null
): ExtractionCandidate {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const documentType = pickDocumentType(source.documentType, fallbackDocumentType);
  const rawFields = toFieldEntries(source.fields);

  const fields: CandidateField[] = [];
  for (const entry of rawFields) {
    if (fields.length >= MAX_CANDIDATE_FIELDS) break;
    const field = normaliseField(entry);
    if (field) fields.push(field);
  }

  return { schemaVersion: '1.0', status: 'CANDIDATE', documentType, fields };
}

/**
 * The two shapes a local model actually replies with, reduced to one.
 *
 * The contract asks for `fields` as an array of `{field, value, page, anchor}`. A
 * document-OCR model asked to read a receipt answers, just as often, with a map from the
 * printed label to what was printed beside it:
 *
 *     "fields": { "เลขที่ / Receipt No.": "RC-2026-00418", ... }
 *
 * That is the same reading, correctly done, in the wrong container. Dropping it produced
 * a job that COMPLETED with zero fields while the model had in fact read every line —
 * the quiet failure this module exists to prevent, wearing a success badge.
 *
 * The key is kept verbatim as both the field name and the anchor, because it IS the
 * printed label the value was read next to, which is exactly what `anchor` means. No
 * English name is invented for it: translating "ผู้ขาย / Vendor" into `vendorName` would be this
 * runtime guessing at meaning, and every other rule in this file forbids that.
 */
function toFieldEntries(rawFields: unknown): unknown[] {
  if (Array.isArray(rawFields)) return rawFields;
  if (!rawFields || typeof rawFields !== 'object') return [];
  return Object.entries(rawFields as Record<string, unknown>).map(([field, value]) => ({
    field,
    value,
    anchor: field,
  }));
}

function pickDocumentType(candidate: unknown, fallback?: string | null): ExtractionDocumentType {
  const allowed = new Set<string>(EXTRACTION_DOCUMENT_TYPES);
  const named = typeof candidate === 'string' ? candidate.trim().toUpperCase() : '';
  if (allowed.has(named)) return named as ExtractionDocumentType;
  const hinted = typeof fallback === 'string' ? fallback.trim().toUpperCase() : '';
  if (allowed.has(hinted)) return hinted as ExtractionDocumentType;
  return 'OTHER';
}

function normaliseField(entry: unknown): CandidateField | null {
  if (!entry || typeof entry !== 'object') return null;
  const source = entry as Record<string, unknown>;
  const name = typeof source.field === 'string' ? source.field.trim().slice(0, 100) : '';
  if (!name) return null;

  const field: CandidateField = {
    field: name,
    value: normaliseValue(source.value),
    // Never the model's own number: see UNVERIFIED_FIELD_CONFIDENCE.
    confidence: UNVERIFIED_FIELD_CONFIDENCE,
  };

  const page = Number(source.page);
  if (Number.isInteger(page) && page >= 1) field.page = page;

  // An anchor is a phrase the model says it read next to the value. It is a locator, not
  // a claim, so it is kept — clipped to the contract's length — while `bounds` is not.
  const anchor = typeof source.anchor === 'string' ? source.anchor.trim().slice(0, 500) : '';
  if (anchor) field.anchor = anchor;

  return field;
}

function normaliseValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  // An object or array is the model answering a different question than it was asked;
  // it is not silently stringified into a field a reviewer would read as a value.
  return null;
}
