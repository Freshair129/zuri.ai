import prisma from '@/lib/db'
import { createServerLineSecretManagerFromEnv, resolveServerLineAccount, createServerLineReplyTransport, createServerLinePushTransport } from '@/platform/integrations/providers/line/server-line-transport'
// @req FR-149 — deployment composition, no credentials returned to clients.
// @spec ADR-061
// @tested tests/integration/server-line-jobs.test.js
export function serverLinePorts(env = process.env, db = prisma) {
  if (env.ZURI_LINE_SERVER_ENABLED !== 'true') throw Object.assign(new Error('LINE_SERVER_DISABLED'), { status: 503 })
  const secretManager = createServerLineSecretManagerFromEnv(env)
  return { resolveAccount: accountId => resolveServerLineAccount({ accountId, db, secretManager }),
    replyTransport: createServerLineReplyTransport(), pushTransport: createServerLinePushTransport() }
}
