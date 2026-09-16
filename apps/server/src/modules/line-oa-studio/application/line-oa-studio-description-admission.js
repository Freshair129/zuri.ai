import prisma from '@/lib/db'
import { admitKnowledge as defaultAdmitKnowledge, corpusKeyFor } from '@/modules/knowledge/knowledge-admission-service'
import { withdrawKnowledgeSource as defaultWithdrawKnowledgeSource } from '@/modules/knowledge/knowledge-corpus-service'
import { createKnowledgeRepository } from '@/modules/knowledge/knowledge-repository'

// @req FR-238 — on a publisher action, the human-readable description of a
//   published rich menu, LIFF app or bot profile is admitted as one
//   LINE_STUDIO_DESCRIPTION TEXT source through the existing ADR-072
//   admission service (knowledge-admission-service.js) — never the Flex or
//   rich menu JSON, never a coordinate, a URL, a postback `data` string or a
//   LIFF app code. Unpublishing withdraws the source through the existing
//   withdrawal path (knowledge-corpus-service.js). This module is the one
//   place that composes that description text and calls both; the three
//   line-oa-studio services (account, rich menu, LIFF app) each call it from
//   the exact point their own action already made the item live or dead —
//   they never talk to the knowledge lane directly, and this module never
//   opens their tables.
// @spec ADR-090 D7; ADR-072 D1; SEC-001
// @tested tests/unit/line-oa-studio-description-admission.test.js, tests/integration/fr238-line-studio-description-admission.test.js

/**
 * The caller (account/rich-menu/LIFF-app service) has already proved OWNER or
 * `LINE_OA_PUBLISHER` authority over this Business via
 * `line-oa-account-authority.js`'s `assertMayPublish`, exactly as FR-236's
 * `decideKnowledgeCandidate` trusts its own caller's prior check (ADR-090 D6).
 * Knowledge's own generic write gate is owner-only (`resolveKnowledgeScope`),
 * which would wrongly refuse a `LINE_OA_PUBLISHER` who is not the Business
 * owner — so this module authorizes on the caller's behalf, never a second,
 * looser check.
 */
const trustedAuthorization = async () => ({ authorized: true })

function trim(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function joinLines(parts) {
  return parts.map(trim).filter(Boolean).join('\n')
}

// ---- content composers -----------------------------------------------------
// Each composer takes only the human-authored copy fields of its aggregate —
// never the image, the layout grid, bounds, a `uri`, `data`, `liffAppCode`,
// `richMenuAlias`, `endpointUrl`, `scopes`, a `liffId` or an `externalRichMenuId`.

/**
 * A rich menu's chat-bar text and each area's visible label/message text —
 * the copy a customer actually reads or taps, never its tap target. A
 * POSTBACK area contributes its `displayText` (what LINE shows), never its
 * `data` string (what the bot receives); a URI/LIFF/RICHMENU_SWITCH area
 * contributes only its optional `label`.
 */
export function composeRichMenuDescription({ name, chatBarText, areas = [] } = {}) {
  const areaLines = (Array.isArray(areas) ? areas : []).map((area, index) => {
    const action = area?.action || {}
    const label = trim(action.label)
    const spoken = action.type === 'MESSAGE' ? trim(action.text)
      : action.type === 'POSTBACK' ? trim(action.displayText)
      : ''
    const parts = [label, spoken].filter(Boolean)
    return parts.length ? `พื้นที่ ${index + 1}: ${parts.join(' — ')}` : null
  }).filter(Boolean)
  return joinLines([trim(name), chatBarText ? `แถบแชท: ${trim(chatBarText)}` : '', ...areaLines])
}

/** A LIFF app's name and its operator-authored purpose/description only. */
export function composeLiffAppDescription({ name, description } = {}) {
  return joinLines([trim(name), trim(description)])
}

/** A bot profile's persona/greeting/fallback copy only. */
export function composeBotProfileDescription({ greeting, fallbackText, personaLabel } = {}) {
  return joinLines([
    trim(personaLabel),
    greeting ? `คำทักทาย: ${trim(greeting)}` : '',
    fallbackText ? `ข้อความสำรอง: ${trim(fallbackText)}` : '',
  ])
}

// ---- admission / withdrawal -------------------------------------------------

/**
 * Admit one composed description as a LINE_STUDIO_DESCRIPTION TEXT source.
 * Best-effort and non-blocking: the caller has already completed its own
 * publisher action (the rich menu version is PUBLISHED, the LIFF app is
 * ACTIVE, the account is CONNECTED) before calling this, and a knowledge
 * admission failure — most commonly `KNOWLEDGE_RUNTIME_UNAVAILABLE`, the
 * default everywhere until a Business's knowledge runtime is configured
 * (ADR-090 Consequences: "nothing changes for any account until a publisher
 * switches its mode") — must never undo or fail that action. Every genuine
 * success is still audited, through `admitKnowledge`'s own audit write; a
 * swallowed failure is not separately audited (there is nothing to record —
 * no source, no ingestion).
 *
 * Idempotent: `idempotencyKey` and `source.version` are both derived from
 * `(sourceKey, version)`, so retrying the exact same publish event is a
 * no-op (`unchanged: true` from the admission service), and a still-revoked
 * source under the same `sourceKey` is un-revoked by the admission service's
 * own `admitOneRecord` (it always clears `revokedAt` when it reuses an
 * existing source row) — a republish after an unpublish needs no separate
 * "reactivate" step here.
 */
export async function admitLineStudioDescription({
  businessId, sourceKey, version, title, content,
}, { db = prisma, now = new Date(), admit = defaultAdmitKnowledge } = {}) {
  const text = trim(content)
  if (!text) return { admitted: false, code: 'LINE_STUDIO_DESCRIPTION_EMPTY' }
  try {
    const result = await admit({
      businessId,
      idempotencyKey: `line-studio-description:${sourceKey}:${version}`,
      source: { kind: 'LINE_STUDIO_DESCRIPTION', sourceKey, version: String(version), title, content: text },
    }, { db, now, authorization: trustedAuthorization })
    return { admitted: true, result }
  } catch (error) {
    return { admitted: false, code: error?.code || 'LINE_STUDIO_DESCRIPTION_ADMISSION_FAILED' }
  }
}

/**
 * Withdraw a previously admitted LINE_STUDIO_DESCRIPTION source (unpublish).
 * A no-op, not an error, when nothing was ever admitted under this
 * `sourceKey` (knowledge was disabled at publish time, the item was never
 * published, or it was already withdrawn) — so the account/menu/app's own
 * ARCHIVE action never fails on this side effect either.
 */
export async function withdrawLineStudioDescription({
  businessId, sourceKey,
}, {
  db = prisma,
  now = () => new Date(),
  repository = createKnowledgeRepository(db),
  withdraw = defaultWithdrawKnowledgeSource,
} = {}) {
  try {
    const corpus = await repository.findCorpusByKey(corpusKeyFor(businessId, null))
    if (!corpus || corpus.deletedAt) return { withdrawn: false, code: 'LINE_STUDIO_DESCRIPTION_NOT_ADMITTED' }
    const source = await repository.findSource(corpus.id, sourceKey)
    if (!source || source.revokedAt || source.deletedAt) return { withdrawn: false, code: 'LINE_STUDIO_DESCRIPTION_NOT_ADMITTED' }
    await withdraw(source.id, { expectedVersion: source.version }, { db, now, authorization: trustedAuthorization })
    return { withdrawn: true }
  } catch (error) {
    return { withdrawn: false, code: error?.code || 'LINE_STUDIO_DESCRIPTION_WITHDRAWAL_FAILED' }
  }
}

export const LINE_STUDIO_DESCRIPTION_KIND = 'LINE_STUDIO_DESCRIPTION'
export const lineStudioDescriptionSourceKey = {
  richMenu: (menuId) => `line-studio-description:rich-menu:${menuId}`,
  liffApp: (appId) => `line-studio-description:liff-app:${appId}`,
  botProfile: (accountId) => `line-studio-description:bot-profile:${accountId}`,
}
