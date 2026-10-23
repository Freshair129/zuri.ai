import prisma from '@/lib/db'
import { parseLineProductFactsRequest, resolveLineProductFacts } from './line-product-facts'
import { normalizeLineProductFactsReply, recordLineProductFactsDecision } from '@/modules/line-oa-studio/application/line-product-facts-decision'

// @req FR-291 — intercept only the explicit customer product-fact command,
//   answer with the shared deterministic resolver, and persist its private decision.
// @spec ADR-106, SDD-110 — the Server worker and Core share the owner resolver;
//   this wrapper never gives model fallback to a recognized product command.
// @tested tests/integration/conversation-runtime-product-facts.test.js
export function withLineProductFactsCommand(answer, {
  db = prisma,
  now = () => new Date(),
  parse = parseLineProductFactsRequest,
  resolve = resolveLineProductFacts,
  productFactsOptions = {},
} = {}) {
  if (typeof answer !== 'function' || typeof parse !== 'function' || typeof resolve !== 'function') {
    throw new Error('LINE_PRODUCT_FACTS_COMMAND_PORTS_REQUIRED')
  }
  if (!productFactsOptions || typeof productFactsOptions !== 'object' || Array.isArray(productFactsOptions)
    || Object.keys(productFactsOptions).some(key => key !== 'knowledgeReaderFactory')
    || (productFactsOptions.knowledgeReaderFactory !== undefined && typeof productFactsOptions.knowledgeReaderFactory !== 'function')) {
    throw new Error('LINE_PRODUCT_FACTS_OPTIONS_INVALID')
  }
  return async function answerWithLineProductFacts(job, options) {
    const parsed = parse(job?.inbound?.body)
    if (parsed === null) return answer(job, options)
    const resolved = await resolve(job, { ...productFactsOptions, db, now })
    const text = normalizeLineProductFactsReply(resolved?.text)
    await recordLineProductFactsDecision(db, job, { binding: resolved?.binding, replyText: text, now })
    return { text }
  }
}
