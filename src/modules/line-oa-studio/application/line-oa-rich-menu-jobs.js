import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { LINE_OA_RICH_MENU_JOB_KINDS } from '@/lib/validation/enums'
import {
  LINE_OA_RICH_MENU_JOB_ENTITY,
  RICH_MENU_JOB_LEASE_MS,
  RICH_MENU_JOB_TTL_MS,
  buildLineRichMenuObject,
  initialStage,
  retryDelayMs,
  settleOutcome,
} from '../domain/line-oa-rich-menu-publish'
import { assertMayPublish, assertMayView, notFound } from './line-oa-account-authority'

// @req FR-152 — the only writer of LineOaRichMenuJob: a publisher queues one
//   job per rich menu (PUBLISH a frozen version, SET_DEFAULT or SET_ALIAS a
//   published one), reads the job ledger, acknowledges an UNKNOWN outcome;
//   the server worker claims with compare-and-set and a bounded lease, walks
//   the job's stages through the Integration lane's rich menu port, and
//   settles — writing the external richMenuId and the version's PUBLISHED
//   state only on the provider's acceptance. Never holds a token: the
//   account's credential is resolved per attempt by the port the runtime
//   supplies, and the job row carries none of it.
// @spec ADR-061 D1 (server-owned; Studio owns durable job state), D6
//   (compare-and-set claims, bounded leases, acceptance ≠ delivery), D7 (an
//   ambiguous create is UNKNOWN and visible; stale leases cannot settle;
//   pause/ownership change fences waiting work); ADR-060 D3, D11; SEC-001
// @tested tests/integration/fr152-line-oa-rich-menu-jobs.test.js

const OPEN = ['QUEUED', 'CLAIMED']
const failure = (status, message, details) => Object.assign(new Error(message), { status, ...(details ? { details } : {}) })

const zQueue = z.object({
  kind: z.enum(LINE_OA_RICH_MENU_JOB_KINDS),
  version: z.number().int().positive(),
}).strict()
const zAcknowledge = z.object({
  jobId: z.string().trim().min(1).max(200),
  version: z.number().int().positive(),
  acknowledgePossibleOutcome: z.literal(true),
}).strict()

const JOB_SELECT = {
  id: true, richMenuId: true, richMenuVersionId: true, accountId: true, kind: true, stage: true, status: true,
  attempts: true, availableAt: true, expiresAt: true, externalRichMenuId: true, providerRequestId: true,
  errorCode: true, correlationId: true, acceptedAt: false, createdAt: true, updatedAt: true, version: true,
}
delete JOB_SELECT.acceptedAt

function jobDto(row) {
  return {
    id: row.id, richMenuId: row.richMenuId, versionId: row.richMenuVersionId, accountId: row.accountId,
    kind: row.kind, stage: row.stage, status: row.status, attempts: row.attempts,
    availableAt: row.availableAt, expiresAt: row.expiresAt, externalRichMenuId: row.externalRichMenuId,
    providerRequestId: row.providerRequestId, errorCode: row.errorCode, correlationId: row.correlationId,
    createdAt: row.createdAt, updatedAt: row.updatedAt, version: row.version,
  }
}

function serverOwned(account) {
  return account?.status === 'CONNECTED' && account.transportMode === 'CLOUD' && account.serverEnabled === true && !account.archivedAt
}

async function atomic(db, work) {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(work) } catch (error) {
      if (attempt >= 2 || !['P2002', 'P2034'].includes(error.code)) throw error
    }
  }
}

/**
 * Queue one job for a rich menu. The menu's `version` is the caller's
 * compare-and-swap, as for every other menu write.
 */
export async function queueRichMenuJob(menuId, input, { viewer, db = prisma, now = new Date() } = {}) {
  const id = typeof menuId === 'string' ? menuId.trim() : ''
  if (!id) throw notFound()
  const data = zQueue.parse(input)
  const job = await atomic(db, async (tx) => {
    const menu = await tx.lineOaRichMenu.findUnique({ where: { id }, include: { account: true, versions: true } })
    if (!menu) throw notFound()
    assertMayPublish(viewer, menu.businessId)
    if (menu.version !== data.version) throw failure(409, 'LINE_OA_RICH_MENU_VERSION_CONFLICT')
    if (menu.status === 'ARCHIVED') throw failure(409, 'LINE_OA_RICH_MENU_ARCHIVED')
    if (!serverOwned(menu.account)) throw failure(409, 'LINE_OA_ACCOUNT_SERVER_NOT_ENABLED')
    const open = await tx.lineOaRichMenuJob.count({ where: { richMenuId: menu.id, status: { in: OPEN } } })
    if (open) throw failure(409, 'LINE_OA_RICH_MENU_JOB_OPEN')

    const versions = [...menu.versions].sort((a, b) => b.versionNumber - a.versionNumber)
    let target
    if (data.kind === 'PUBLISH') {
      target = versions.find((v) => v.status === 'FROZEN')
      if (!target) throw failure(409, 'LINE_OA_RICH_MENU_NO_FROZEN_VERSION')
    } else {
      target = versions.find((v) => v.status === 'PUBLISHED' && v.externalRichMenuId)
      if (!target) throw failure(409, 'LINE_OA_RICH_MENU_NOT_PUBLISHED')
      if (data.kind === 'SET_ALIAS' && !menu.alias) throw failure(409, 'LINE_OA_RICH_MENU_NO_ALIAS')
    }
    if (data.kind === 'PUBLISH') {
      const built = buildLineRichMenuObject({ menu, version: target })
      if (!built.ok) throw failure(422, built.code)
    }

    const fence = await tx.lineOaRichMenu.updateMany({ where: { id: menu.id, version: menu.version }, data: { version: { increment: 1 } } })
    if (!fence.count) throw failure(409, 'LINE_OA_RICH_MENU_VERSION_CONFLICT')
    const row = await tx.lineOaRichMenuJob.create({
      data: {
        tenantId: menu.tenantId, businessId: menu.businessId, accountId: menu.lineOaAccountId,
        richMenuId: menu.id, richMenuVersionId: target.id, kind: data.kind, stage: initialStage(data.kind),
        status: 'QUEUED', transportEpoch: menu.account.transportEpoch, availableAt: now,
        expiresAt: new Date(now.getTime() + RICH_MENU_JOB_TTL_MS), correlationId: randomUUID(),
        externalRichMenuId: data.kind === 'PUBLISH' ? null : target.externalRichMenuId,
      },
      select: JOB_SELECT,
    })
    await recordAudit(tx, {
      entityType: LINE_OA_RICH_MENU_JOB_ENTITY, entityId: row.id, action: 'LINE_OA_RICH_MENU_JOB_QUEUED',
      actorId: viewer?.principal?.id ?? null,
      payload: { businessId: menu.businessId, accountId: menu.lineOaAccountId, richMenuId: menu.id, versionNumber: target.versionNumber, kind: data.kind, correlationId: row.correlationId },
    })
    return row
  })
  return jobDto(job)
}

/** The job ledger of one menu, newest first. Operational state only; no token exists to leak. */
export async function listRichMenuJobs(menuId, { viewer, db = prisma } = {}) {
  const id = typeof menuId === 'string' ? menuId.trim() : ''
  if (!id) throw notFound()
  const menu = await db.lineOaRichMenu.findUnique({ where: { id }, select: { id: true, businessId: true } })
  if (!menu) throw notFound()
  assertMayView(viewer, menu.businessId)
  const rows = await db.lineOaRichMenuJob.findMany({ where: { richMenuId: menu.id }, orderBy: { createdAt: 'desc' }, take: 100, select: JOB_SELECT })
  return { richMenuId: menu.id, jobs: rows.map(jobDto) }
}

/** An operator closes an UNKNOWN job without claiming the menu exists or does not. */
export async function acknowledgeUnknownRichMenuJob(menuId, input, { viewer, db = prisma } = {}) {
  const id = typeof menuId === 'string' ? menuId.trim() : ''
  if (!id) throw notFound()
  const data = zAcknowledge.parse(input)
  return atomic(db, async (tx) => {
    const job = await tx.lineOaRichMenuJob.findUnique({ where: { id: data.jobId }, select: JOB_SELECT })
    if (!job || job.richMenuId !== id) throw notFound()
    const menu = await tx.lineOaRichMenu.findUnique({ where: { id }, select: { businessId: true, lineOaAccountId: true } })
    if (!menu) throw notFound()
    assertMayPublish(viewer, menu.businessId)
    const result = await tx.lineOaRichMenuJob.updateMany({
      where: { id: job.id, status: 'UNKNOWN', version: data.version },
      data: { status: 'CANCELLED', errorCode: 'OPERATOR_ACKNOWLEDGED_UNKNOWN', version: { increment: 1 } },
    })
    if (!result.count) throw failure(409, 'LINE_OA_RICH_MENU_JOB_VERSION_CONFLICT')
    await recordAudit(tx, {
      entityType: LINE_OA_RICH_MENU_JOB_ENTITY, entityId: job.id, action: 'LINE_OA_RICH_MENU_JOB_UNKNOWN_ACKNOWLEDGED',
      actorId: viewer?.principal?.id ?? null,
      payload: { businessId: menu.businessId, accountId: menu.lineOaAccountId, richMenuId: id, externalRichMenuId: job.externalRichMenuId, possibleOutcome: true },
    })
    return jobDto(await tx.lineOaRichMenuJob.findUnique({ where: { id: job.id }, select: JOB_SELECT }))
  })
}

async function maintenance(db, now) {
  await db.lineOaRichMenuJob.updateMany({
    where: { status: 'QUEUED', expiresAt: { lte: now } },
    data: { status: 'FAILED', errorCode: 'EXECUTION_EXPIRED', version: { increment: 1 } },
  })
  // A claim whose lease ran out may have made an external call whose answer
  // never came back; it is UNKNOWN for an operator, never silently re-run.
  await db.lineOaRichMenuJob.updateMany({
    where: { status: 'CLAIMED', leaseExpiresAt: { lte: now } },
    data: { status: 'UNKNOWN', errorCode: 'LEASE_EXPIRED_OUTCOME_UNKNOWN', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } },
  })
}

async function settle(db, job, { status, stage, claimantId, now, patch = {} }) {
  const changed = await db.lineOaRichMenuJob.updateMany({
    where: { id: job.id, status: 'CLAIMED', claimantId, version: job.version },
    data: {
      status, stage: stage ?? job.stage, claimantId: null, leaseExpiresAt: null,
      availableAt: status === 'QUEUED' ? new Date(now.getTime() + retryDelayMs(job.attempts)) : now,
      version: { increment: 1 }, ...patch,
    },
  })
  return changed.count === 1
}

/**
 * One bounded tick of the rich menu worker. Returns what happened to at most
 * one job so the supervising loop can log it; `IDLE` when nothing is due.
 */
export async function runLineRichMenuWorker({
  db = prisma, resolveAccount, richMenuTransport, readImage,
  now = () => new Date(), workerId = `server:${randomUUID()}`,
} = {}) {
  const at = now()
  await maintenance(db, at)
  const pending = await db.lineOaRichMenuJob.findFirst({
    where: { status: 'QUEUED', availableAt: { lte: at }, expiresAt: { gt: at } },
    include: { account: true, richMenu: true, menuVersion: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!pending) return { status: 'IDLE' }

  // Fence before any external call: a paused, archived, non-server or
  // re-epoched account cancels the work rather than acting on its behalf.
  if (!serverOwned(pending.account) || pending.account.transportEpoch !== pending.transportEpoch) {
    await db.lineOaRichMenuJob.updateMany({ where: { id: pending.id, version: pending.version }, data: { status: 'CANCELLED', errorCode: 'LINE_ACCOUNT_NOT_SERVER_OWNED', version: { increment: 1 } } })
    return { id: pending.id, status: 'CANCELLED' }
  }
  let account
  try { account = await resolveAccount(pending.accountId) } catch {
    await db.lineOaRichMenuJob.updateMany({ where: { id: pending.id, version: pending.version, status: 'QUEUED' }, data: { status: 'FAILED', errorCode: 'LINE_ACCOUNT_UNAVAILABLE', version: { increment: 1 } } })
    return { id: pending.id, status: 'FAILED' }
  }
  if (account.transportEpoch !== pending.transportEpoch) return { id: pending.id, status: 'FENCED' }

  const claimed = await db.lineOaRichMenuJob.updateMany({
    where: { id: pending.id, version: pending.version, status: 'QUEUED' },
    data: { status: 'CLAIMED', claimantId: workerId, attempts: { increment: 1 }, leaseExpiresAt: new Date(at.getTime() + RICH_MENU_JOB_LEASE_MS), version: { increment: 1 } },
  })
  if (!claimed.count) return { status: 'CONTENDED' }
  const job = { ...pending, version: pending.version + 1, attempts: pending.attempts + 1 }
  const menu = pending.richMenu
  const version = pending.menuVersion

  const finish = async (status, extra = {}) => {
    const ok = await settle(db, job, { status, claimantId: workerId, now: now(), ...extra })
    return { id: job.id, status: ok ? status : 'FENCED', stage: extra.stage ?? job.stage }
  }
  const outcomeOf = async (stage, result) => {
    const verdict = settleOutcome({ stage, result })
    const patch = { providerRequestId: result.requestId ?? null, errorCode: result.code ?? null }
    if (verdict === 'FAILED') return finish('FAILED', { stage, patch })
    if (verdict === 'UNKNOWN') return finish('UNKNOWN', { stage, patch })
    if (verdict === 'RETRY') return finish('QUEUED', { stage, patch })
    return null
  }

  try {
    if (job.kind === 'PUBLISH') {
      let stage = job.stage
      let externalRichMenuId = job.externalRichMenuId
      if (stage === 'CREATE') {
        const built = buildLineRichMenuObject({ menu, version })
        if (!built.ok) return finish('FAILED', { patch: { errorCode: built.code } })
        const result = await richMenuTransport.create({ account, richMenu: built.value })
        const stop = await outcomeOf('CREATE', result)
        if (stop) return stop
        externalRichMenuId = result.richMenuId
        // Persist the id before the upload so a later failure never loses it.
        await db.lineOaRichMenuJob.updateMany({ where: { id: job.id, status: 'CLAIMED', claimantId: workerId }, data: { externalRichMenuId, stage: 'UPLOAD', providerRequestId: result.requestId ?? null } })
        stage = 'UPLOAD'
      }
      if (stage === 'UPLOAD') {
        let image
        try { image = await readImage({ fileAssetId: version.imageFileAssetId, businessId: pending.businessId }) } catch {
          return finish('FAILED', { stage, patch: { externalRichMenuId, errorCode: 'LINE_OA_RICH_MENU_IMAGE_UNAVAILABLE' } })
        }
        const result = await richMenuTransport.uploadImage({ account, richMenuId: externalRichMenuId, bytes: image.bytes, mime: image.mime })
        const stop = await outcomeOf('UPLOAD', result)
        if (stop) return stop
        await atomic(db, async (tx) => {
          await tx.lineOaRichMenuVersion.updateMany({ where: { richMenuId: menu.id, status: 'PUBLISHED' }, data: { status: 'RETIRED' } })
          await tx.lineOaRichMenuVersion.update({ where: { id: version.id }, data: { status: 'PUBLISHED', publishedAt: now(), externalRichMenuId } })
          await recordAudit(tx, {
            entityType: LINE_OA_RICH_MENU_JOB_ENTITY, entityId: job.id, action: 'LINE_OA_RICH_MENU_PUBLISHED', actorId: null,
            payload: { businessId: pending.businessId, accountId: pending.accountId, richMenuId: menu.id, versionNumber: version.versionNumber, externalRichMenuId, correlationId: job.correlationId },
          })
        })
        return finish('ACCEPTED', { stage: 'DONE', patch: { externalRichMenuId, providerRequestId: result.requestId ?? null, errorCode: null } })
      }
      return finish('FAILED', { patch: { errorCode: 'LINE_OA_RICH_MENU_STAGE_INVALID' } })
    }

    if (job.kind === 'SET_DEFAULT') {
      const result = await richMenuTransport.setDefault({ account, richMenuId: job.externalRichMenuId })
      const stop = await outcomeOf('APPLY', result)
      if (stop) return stop
      await atomic(db, async (tx) => {
        await tx.lineOaRichMenu.updateMany({ where: { lineOaAccountId: pending.accountId, isDefault: true, id: { not: menu.id } }, data: { isDefault: false, version: { increment: 1 } } })
        await tx.lineOaRichMenu.update({ where: { id: menu.id }, data: { isDefault: true, version: { increment: 1 } } })
        await recordAudit(tx, {
          entityType: LINE_OA_RICH_MENU_JOB_ENTITY, entityId: job.id, action: 'LINE_OA_RICH_MENU_DEFAULT_SET', actorId: null,
          payload: { businessId: pending.businessId, accountId: pending.accountId, richMenuId: menu.id, externalRichMenuId: job.externalRichMenuId, correlationId: job.correlationId },
        })
      })
      return finish('ACCEPTED', { stage: 'DONE', patch: { providerRequestId: result.requestId ?? null, errorCode: null } })
    }

    if (job.kind === 'SET_ALIAS') {
      const result = await richMenuTransport.setAlias({ account, aliasId: menu.alias, richMenuId: job.externalRichMenuId })
      const stop = await outcomeOf('APPLY', result)
      if (stop) return stop
      await recordAudit(db, {
        entityType: LINE_OA_RICH_MENU_JOB_ENTITY, entityId: job.id, action: 'LINE_OA_RICH_MENU_ALIAS_SET', actorId: null,
        payload: { businessId: pending.businessId, accountId: pending.accountId, richMenuId: menu.id, alias: menu.alias, externalRichMenuId: job.externalRichMenuId, correlationId: job.correlationId },
      })
      return finish('ACCEPTED', { stage: 'DONE', patch: { providerRequestId: result.requestId ?? null, errorCode: null } })
    }
    return finish('FAILED', { patch: { errorCode: 'LINE_OA_RICH_MENU_JOB_KIND_UNKNOWN' } })
  } catch (error) {
    // A thrown transport error is a request never confirmed either way. The
    // create stage may have made a menu; everything else is safe to retry.
    const stage = job.stage
    const verdict = stage === 'CREATE' ? 'UNKNOWN' : 'QUEUED'
    return finish(verdict, { stage, patch: { errorCode: error?.code === 'LINE_SEND_INPUT_INVALID' ? 'LINE_SEND_INPUT_INVALID' : 'LINE_REQUEST_UNCONFIRMED' } })
  }
}
