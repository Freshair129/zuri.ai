// @req FR-084 — one pure input contract for canvas and server validation.
// @spec BR-017, ADR-035
// @tested tests/unit/handoff-contract.test.js, tests/unit/pipeline-edge-interactions.test.js
import { z } from 'zod'
const uuid = z.string().uuid().transform(value => value.toLowerCase())
const text = z.string().transform(value => value.trim().normalize('NFC'))
  .refine(value => [...value].length >= 1 && [...value].length <= 2000)
const gate = z.object({ kind: z.literal('GATE'), gateId: uuid }).strict()
const manual = z.object({ kind: z.literal('MANUAL'), satisfied: z.boolean() }).strict()
export const zHandoffContractV1 = z.object({
  version: z.literal(1), deliverable: text,
  acceptance: z.discriminatedUnion('kind', [manual, gate]),
}).strict()
export { uuid, text, gate, manual }
