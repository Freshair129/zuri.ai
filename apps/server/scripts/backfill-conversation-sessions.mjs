// Run with: npx vite-node --config vitest.config.js scripts/backfill-conversation-sessions.mjs [-- --apply] [-- --tenant <tenantId>]
// (omit --apply for a dry run). The Vite runtime supplies the repository's @/*
// alias for server modules, the same way scripts/enable-smartgift-knowledge-candidates.mjs does.
//
// @req FR-243 — assigns every existing Message and ConversationEvent to its
//   conversation session by the application's own rule (ADR-094 D2), after
//   migration 20260916090000_crm_conversation_sessions is applied. Idempotent:
//   a second run finds nothing to assign.
// @spec ADR-094, SDD-102, ADR-057
// @tested tests/integration/crm-conversation-sessions.test.js (the backfill
//   service this script calls; the script itself is a thin operator wrapper)
//
// NOT RUN by this change. Running it against production is the operator step
// of TASK-ZAI-108, on the owner's instruction: dry run first, then --apply.
import prisma from '@/lib/db'
import { backfillConversationSessions } from '@/modules/crm/conversation-session-backfill'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const tenantIndex = args.indexOf('--tenant')
const tenantId = tenantIndex >= 0 ? args[tenantIndex + 1] : undefined

try {
  const result = await backfillConversationSessions({ db: prisma, apply, tenantId })
  console.log(JSON.stringify({ event: 'crm.conversation-sessions.backfill', ...result }))
} finally {
  await prisma.$disconnect()
}
