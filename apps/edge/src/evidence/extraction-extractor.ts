/**
 * Reading a document with the model this device already runs.
 *
 * WHAT THIS CAN ACTUALLY DO TODAY — read this before trusting anything below
 * ------------------------------------------------------------------------
 * This runtime's local ladder is `qwen3.5:9b` with `pathumma-thaillm-8b` behind it
 * (`docs/LOCAL-MODEL-SELECTION.md`). **Neither can see an image.** They are text models.
 * So on a device configured exactly as that document describes, this extractor reads
 * nothing at all, and every job it is handed is failed with a reason that says so.
 *
 * That is the deliberate behaviour, not a gap left to fix later. A candidate is reviewed
 * by a Human in the cloud console who reads it as *what a machine saw in the document*.
 * A text model handed no picture will still happily produce a plausible receipt — vendor,
 * date, total — and that fabrication is worse than a failed job in the precise way that
 * matters: the failed job is obviously unfinished, while the fabrication is approved.
 *
 * So the extractor demands, before it will read anything:
 *   - a configured vision model (`ZURI_EXTRACTION_VISION_MODEL`), named separately from
 *     `ZURI_LLM_MODEL` so that turning on the conversational model can never silently
 *     enrol a text model into document reading;
 *   - an `openai-compatible` port, i.e. a daemon this business runs. Sending a customer's
 *     evidence to a hosted API would defeat the entire reason this lane exists.
 * Anything else fails the job with a reason an operator can act on.
 *
 * PDFs are refused for the same reason. A local chat daemon takes images, not PDFs, and
 * this repository has no rasteriser; converting one would be a new dependency and a new
 * failure mode, so until that is a deliberate piece of work a PDF job says so honestly.
 */

import type { ModelPort } from '../answer/model-port.js';
import {
  EXTRACTION_DOCUMENT_TYPES,
  ExtractionJob,
  ExtractionResult,
  MAX_CANDIDATE_FIELDS,
  normaliseCandidate,
  scrubSecrets,
} from './extraction-contract.js';

/**
 * The device cannot read this document, and no retry will change that.
 *
 * Distinct from an ordinary error so the worker can report it as a plain fail without
 * dressing it up as a transient fault. The message is the text the console shows a Human,
 * so it is written for that reader — Thai first, with the operator's English in brackets.
 */
export class ExtractionUnsupportedError extends Error {
  constructor(message: string) {
    super(scrubSecrets(message));
    this.name = 'ExtractionUnsupportedError';
  }
}

/** MIME types a local vision daemon accepts directly, with no conversion step. */
const VISION_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface LocalExtractorOptions {
  /**
   * The port to read with, or `null` when no vision model is configured — which is the
   * default state of this repository and must stay expressible, because pretending a
   * model exists is how fabricated candidates get made.
   */
  port: ModelPort | null;
  /** Hard ceiling on one document. Far longer than a chat turn: nothing is waiting on it. */
  timeoutMs: number;
  /** Why `port` is null, in the words the console should show. Only used when it is null. */
  unavailableReason?: string;
}

export type LocalExtractor = (input: {
  bytes: Buffer;
  mime: string;
  job: ExtractionJob;
}) => Promise<ExtractionResult>;

const SYSTEM_PROMPT = [
  'You read Thai and English business documents and report only what is visibly printed on them.',
  'Reply with one JSON object and nothing else — no prose, no markdown fence, no explanation.',
  'Shape: {"documentType": "<TYPE>", "fields": [{"field": "<name>", "value": <string|number|boolean|null>, "page": <int|null>, "anchor": "<the printed label you read it next to>"}]}',
  `documentType must be one of: ${EXTRACTION_DOCUMENT_TYPES.join(', ')}.`,
  'Use camelCase English field names, e.g. vendorName, documentDate, totalAmount, taxId, invoiceNumber.',
  'Write dates as YYYY-MM-DD and amounts as plain numbers with no currency symbol or thousands separator.',
  'If a value is not legible in the image, use null. Never infer, complete, or guess a value that is not printed.',
  'Report no more than 40 fields.',
].join('\n');

/**
 * Build the extractor for the configured device.
 *
 * Returning a function that always fails (rather than refusing to build) is on purpose:
 * a device with no vision model must still run the worker loop, claim its jobs and report
 * each one failed with a readable reason. A worker that would not start would instead
 * leave jobs sitting QUEUED with nothing in the console to explain why.
 */
export function createLocalEvidenceExtractor(options: LocalExtractorOptions): LocalExtractor {
  const { port, timeoutMs } = options;
  const unavailableReason =
    options.unavailableReason ??
    'อุปกรณ์นี้ยังไม่ได้ตั้งค่าโมเดลอ่านภาพ จึงยังอ่านเอกสารไม่ได้ ' +
      '(this Zuri Edge Device has no vision-capable local model configured; set ZURI_EXTRACTION_VISION_MODEL)';

  return async function extract({ bytes, mime, job }) {
    if (!port) throw new ExtractionUnsupportedError(unavailableReason);

    if (mime === 'application/pdf') {
      throw new ExtractionUnsupportedError(
        'อุปกรณ์นี้ยังอ่านไฟล์ PDF ไม่ได้ กรุณาแนบเป็นรูปภาพแทน ' +
          '(this device cannot rasterise PDF; the local vision daemon accepts images only)'
      );
    }
    if (!VISION_MIME_TYPES.has(mime)) {
      throw new ExtractionUnsupportedError(
        `อุปกรณ์นี้ไม่รองรับไฟล์ชนิดนี้ (unsupported evidence type "${mime.replace(/[^\w/+.-]/g, '')}")`
      );
    }
    if (!bytes || bytes.length === 0) {
      throw new ExtractionUnsupportedError('ไฟล์หลักฐานว่างเปล่า (the cloud served zero bytes for this evidence)');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let text: string;
    try {
      const reply = await port.generate({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(job) }],
        // No tools: a document reader has nothing to look up, and every tool offered is
        // another way for the turn to end without an answer.
        tools: [],
        images: [{ mime, base64: bytes.toString('base64') }],
        maxIterations: 1,
        timeoutMs,
        signal: controller.signal,
      });
      text = reply.text;
    } catch (error) {
      // Includes MODEL_IMAGES_UNSUPPORTED from a port with no image channel, which is
      // exactly the misconfiguration this whole file exists to make loud.
      throw new ExtractionUnsupportedError(
        `โมเดลในเครื่องอ่านเอกสารไม่สำเร็จ (the local model could not read this document: ${describe(error)})`
      );
    } finally {
      clearTimeout(timer);
    }

    const parsed = parseJsonObject(text);
    if (!parsed) {
      throw new ExtractionUnsupportedError(
        'โมเดลในเครื่องตอบกลับมาในรูปแบบที่อ่านไม่ได้ (the local model returned no parseable JSON object)'
      );
    }

    const candidate = normaliseCandidate(parsed, job.evidence?.documentType ?? null);
    if (candidate.fields.length === 0) {
      // A candidate with no fields is not a reading of a document; it is the model
      // having answered in a shape this contract cannot see. Completing the job anyway
      // sets the evidence to EXTRACTED and shows a reviewer an empty result, which reads
      // as "the machine found nothing printed here" — a claim nothing has established.
      // The same argument the top of this file makes against a text model's fabrication
      // applies to a confident blank: fail loudly instead.
      throw new ExtractionUnsupportedError(
        'โมเดลในเครื่องอ่านเอกสารแล้วแต่ไม่ได้ค่าใดเลย ' +
          '(the local model returned JSON with no usable fields; its reply did not match ' +
          'the candidate contract, so nothing was recorded rather than an empty result)'
      );
    }
    if (candidate.fields.length > MAX_CANDIDATE_FIELDS) {
      // normaliseCandidate already caps; this is a belt on the braces, because exceeding
      // it is a 400 that fails the job rather than a warning.
      candidate.fields = candidate.fields.slice(0, MAX_CANDIDATE_FIELDS);
    }
    return { candidate, model: port.model };
  };
}

function buildUserPrompt(job: ExtractionJob): string {
  const hint = job.evidence?.documentType;
  const hinted =
    typeof hint === 'string' && hint.trim()
      ? `The person who uploaded it labelled it ${hint.trim()}; correct that label if the image says otherwise.`
      : 'The document type is not known in advance; decide it from the image.';
  return `Read this document and report its fields as JSON. ${hinted}`;
}

/**
 * Pull the first complete JSON object out of the model's reply.
 *
 * Local models fence their JSON, prefix it with "Here is", or trail a sentence after it,
 * and none of that is worth failing a real extraction over. Brace-matching rather than a
 * greedy regex, so a trailing sentence containing a `}` does not swallow the object.
 */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const source = String(text ?? '');
  const start = source.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const value = JSON.parse(source.slice(start, i + 1));
          return value && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function describe(error: unknown): string {
  if (error instanceof Error) return scrubSecrets(error.message);
  return 'unknown model error';
}
