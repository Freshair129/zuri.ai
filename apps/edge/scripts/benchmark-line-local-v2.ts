import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createOpenAiCompatiblePort } from '../src/answer/providers/openai-compatible.js';
import type { InvocationReceipt } from '../src/answer/context-injection.js';
// @spec ZAI:FR-150 — smoke timings are not LINE or full RAG/MemoryOS qualification.
// Public synthetic prompts only; no customer corpus, credentials or model answers are logged.
const model = 'qwen3.5:9b';
const base = 'http://127.0.0.1:11434';
const tags = await fetch(base + '/api/tags', { signal: AbortSignal.timeout(10000) }).then(r => r.json()) as {
  models: Array<{ name: string; digest: string; details: { quantization_level: string } }> };
const selected = tags.models.find(item => item.name === model);
if (!selected || selected.details.quantization_level !== 'Q4_K_M') throw new Error('EXACT_MODEL_PROFILE_REQUIRED');
const residency = await fetch(base + '/api/ps', { signal: AbortSignal.timeout(10000) }).then(r => r.json()) as {
  models: Array<{ name: string; size_vram: number; context_length: number }> };
const port = createOpenAiCompatiblePort({ provider: 'openai-compatible', model, baseUrl: base + '/v1', effort: 'low', numCtx: 8192 });
const rows = [];
for (const [index, question] of [
  'สวัสดี ช่วยบอกสั้น ๆ ว่าคุณเป็นผู้ช่วยอะไร',
  'ถ้ายังไม่มีข้อมูลราคา ควรตอบลูกค้าว่าอย่างไร ห้ามยกตัวเลขหรือสินค้าตัวอย่าง',
  'ถ้าผู้ใช้ยังไม่ยืนยันแก้ไขงาน ให้แจ้งสถานะสั้น ๆ โดยไม่บอกว่าบันทึกแล้ว',
].entries()) {
  const receipts: InvocationReceipt[] = [];
  const started = performance.now();
  try {
    const result = await port.generate({ system: 'ตอบภาษาไทยสั้น ๆ ตามข้อมูลที่มี ห้ามสมมุติข้อมูลสินค้า ราคา หรืองาน',
      messages: [{ role: 'user', content: question }], tools: [], maxIterations: 1, maxOutputTokens: 512,
      timeoutMs: 24000, signal: AbortSignal.timeout(24000),
      context: { authorized: true, maxBudgetBytes: 32768, onReceipt: receipt => receipts.push(receipt) } });
    rows.push({ case: index + 1, durationMs: Math.round(performance.now() - started), status: result.text.trim() ? 'MODEL_ANSWER' : 'EMPTY',
      answerChars: result.text.length, receipts: receipts.length, promptBytes: receipts[0]?.budget.used });
  } catch {
    rows.push({ case: index + 1, durationMs: Math.round(performance.now() - started), status: 'FAILED_OR_TIMEOUT', receipts: receipts.length });
  }
}
const report = { schemaVersion: 'line-local-smoke.v1', evidence: 'MODEL_ONLY_SYNTHETIC_SMOKE_NOT_E2E',
  observedAt: new Date().toISOString(), model, digest: selected.digest, quantization: selected.details.quantization_level,
  residentBefore: residency.models.find(item => item.name === model) ?? null, rows,
  fullFlowQualification: 'NOT_RUN', limitations: ['No LINE provider call', 'No published corpus', 'No MSP process or remote Work tools', 'No hardware isolation or concurrent-load qualification'] };
const output = process.argv[2];
if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
