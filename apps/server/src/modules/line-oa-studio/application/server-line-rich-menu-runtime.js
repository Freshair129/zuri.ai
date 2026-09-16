import prisma from '@/lib/db'
import { resolveServerLineAccount } from '@/platform/integrations/providers/line/server-line-transport'
import { createLineSecretManagerFromEnv } from '@/platform/integrations/core/secret-store/dispatching-secret-manager'
import { createServerLineRichMenuTransport } from '@/platform/integrations/providers/line/server-line-rich-menu-transport'
import { resolveFileAssetContent } from '@/modules/project-manager/application/file-asset-service'

// @req FR-152 — deployment composition of the rich menu worker: the same
//   secret manager and account resolver as the conversation worker (FR-149),
//   the Integration lane's rich menu port, and the file lane's content
//   resolver for the version's image. No credential is returned to a client.
// @req FR-223 — the secret manager is the dispatching one (SDD-097).
// @spec ADR-061 D1, D8, SDD-097
// @tested tests/unit/line-oa-rich-menu-jobs-routes.test.js

export function serverLineRichMenuPorts(env = process.env, db = prisma) {
  if (env.ZURI_LINE_SERVER_ENABLED !== 'true') throw Object.assign(new Error('LINE_SERVER_DISABLED'), { status: 503 })
  const secretManager = createLineSecretManagerFromEnv(env, { db })
  return {
    resolveAccount: (accountId) => resolveServerLineAccount({ accountId, db, secretManager }),
    richMenuTransport: createServerLineRichMenuTransport(),
    readImage: async ({ fileAssetId, businessId }) => {
      const { asset, content } = await resolveFileAssetContent(fileAssetId, { db, visibleBusinessIds: [businessId] })
      return { bytes: new Uint8Array(content), mime: asset.mime }
    },
  }
}
