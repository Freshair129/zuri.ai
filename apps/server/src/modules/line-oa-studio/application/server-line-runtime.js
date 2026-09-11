import prisma from '@/lib/db'
import { createServerLineSecretManagerFromEnv, resolveServerLineAccount, createServerLineReplyTransport, createServerLinePushTransport } from '@/platform/integrations/providers/line/server-line-transport'
import { createMspTransportFromEnvironment } from '@/modules/agent/msp-stdio-transport'
import { createMspThreadMemoryPort } from '@/modules/agent/msp-thread-memory-port'
// @req FR-149 — deployment composition, no credentials returned to clients.
// @spec ADR-061
// @tested tests/integration/server-line-jobs.test.js

function createServerLineThreadMemory(env) {
  // The admission flag is intentionally absent here. It enrolls new jobs only;
  // an already-enrolled pending receipt remains recoverable after an operator
  // disables admission, provided the independent MSP service configuration is
  // still present. Incomplete configuration simply leaves the optional scanner
  // absent so the normal LINE worker can continue and the receipt stays pending.
  const serviceKey = env.ZURI_MSP_THREAD_SERVICE_KEY
  if (typeof serviceKey !== 'string' || serviceKey.length < 32) return null
  const transport = createMspTransportFromEnvironment(env)
  if (!transport) return null
  return createMspThreadMemoryPort({
    transport,
    actor: env.ZURI_MSP_THREAD_MEMORY_ACTOR ?? 'zuri-line-agent',
    serviceKey,
    maxContextBytes: Number(env.ZURI_MSP_CONTEXT_MAX_BYTES ?? 24000),
    idleTimeoutMinutes: Number(env.MSP_THREAD_IDLE_TIMEOUT_MINUTES ?? 30),
    recentExchangeCount: Number(env.ZURI_MSP_RECENT_EXCHANGES ?? 6),
  })
}

export function serverLinePorts(env = process.env, db = prisma) {
  if (env.ZURI_LINE_SERVER_ENABLED !== 'true') throw Object.assign(new Error('LINE_SERVER_DISABLED'), { status: 503 })
  const secretManager = createServerLineSecretManagerFromEnv(env)
  return { resolveAccount: accountId => resolveServerLineAccount({ accountId, db, secretManager }),
    replyTransport: createServerLineReplyTransport(), pushTransport: createServerLinePushTransport(),
    threadMemory: createServerLineThreadMemory(env) }
}
