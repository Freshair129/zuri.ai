// @req FR-038 — the pure view model behind the "add a member to a Business"
// form on /platform/users: which Businesses it may offer, whether the typed
// input is submittable, and what each server refusal means in Thai.
// @req FR-106 — and the pure view model behind the Enterprise API key panel on
// the same page: the row shape, and the guarantee that no row can carry key
// material even if a future server change started returning it.
// @spec SDD-017, SEC-001, SEC-006, SEC-003
// @tested tests/unit/platform-users-view.test.js
//
// This module holds no JSX and no I/O on purpose. The page it serves is a
// client component, and the parts of it that can actually be *wrong* — a
// refusal shown as a success, a revoked key offering a live revoke button, a
// secret rendered into a list — are decisions, not markup. Decisions are
// testable; markup is not, which is why they are separated here rather than
// inlined into the component the way the rest of this page's logic was.

import { DOMAINS } from '@/config/domains'

/** The grantable domain checkboxes, in registry order. */
export const DOMAIN_OPTIONS = DOMAINS.map((domain) => ({ key: domain.key, label: domain.label }))

const DOMAIN_KEYS = new Set(DOMAIN_OPTIONS.map((option) => option.key))

/**
 * The Businesses the form may offer, and which one it opens on.
 *
 * Sourced from the shell's own inventory rather than from the Membership rows
 * on screen: a Business created through FR-074(c) binds its creator
 * *tenant-wide* (`businessId: null`), so it can legitimately hold zero
 * per-Business Membership rows — deriving the options from the roster would
 * hide exactly the new Business an owner most wants to staff.
 *
 * Visibility is not ownership, so this list can name a Business the caller
 * cannot write to. That is deliberate and safe: the server is the authority and
 * refuses one 404-shaped, indistinguishable from a Business that does not
 * exist. The list is a convenience; it is never the check.
 */
export function inviteBusinessOptions({ businesses = [], activeBusinessId = null } = {}) {
  const options = (Array.isArray(businesses) ? businesses : [])
    .filter((business) => business && typeof business.id === 'string')
    .map((business) => ({
      id: business.id,
      label: business.name
        ? (business.code ? `${business.name} · ${business.code}` : business.name)
        : (business.code || business.id),
    }))
  const defaultId = options.some((option) => option.id === activeBusinessId)
    ? activeBusinessId
    : (options[0]?.id ?? null)
  return { options, defaultId }
}

/**
 * Is this form submittable, and what does the server get?
 *
 * Trims the identifier here as well as on the server, because a trailing space
 * pasted out of a chat window would otherwise fail an exact match with no
 * visible reason. Unknown domain keys are dropped rather than rejected: the
 * checkbox list is generated from the same registry, so an unknown key can only
 * come from stale client state, and refusing the whole submission for it would
 * turn a cosmetic drift into a dead form.
 */
export function validateMemberInvite({ businessId, identifier, domainKeys = [] } = {}) {
  const trimmed = typeof identifier === 'string' ? identifier.trim() : ''
  if (!businessId) return { ok: false, error: 'เลือกธุรกิจก่อนเพิ่มสมาชิก' }
  if (!trimmed) return { ok: false, error: 'กรอกรหัสบุคคล (Person code) หรืออีเมล' }
  const keys = (Array.isArray(domainKeys) ? domainKeys : []).filter((key) => DOMAIN_KEYS.has(key))
  return { ok: true, error: null, payload: { businessId, identifier: trimmed, domainKeys: keys } }
}

/**
 * The Thai sentence for a refusal, keyed on the server's own error string.
 *
 * The two named codes are the only ones this form can produce that a person can
 * act on, and they must not read alike: "that Business is not yours" and "that
 * person is not in the system" call for completely different next steps, and an
 * earlier draft of this surface collapsed both into a generic red box.
 */
export function describeInviteFailure(error) {
  const message = typeof error === 'string' ? error : (error?.message || '')
  if (message.includes('PERSON_NOT_FOUND')) {
    return 'ไม่พบบุคคลที่ตรงกับรหัสหรืออีเมลนี้ — บุคคลต้องมีบัญชีในระบบก่อน จึงจะเพิ่มเข้าธุรกิจได้'
  }
  if (message.includes('MEMBERSHIP_ALREADY_EXISTS')) {
    return 'บุคคลนี้เป็นสมาชิกของธุรกิจนี้อยู่แล้ว'
  }
  if (Number(error?.status) === 404 || /outside your owned scope/i.test(message)) {
    return 'ไม่พบธุรกิจนี้ในสิทธิ์ของคุณ'
  }
  if (Number(error?.status) === 403) return 'ต้องเป็นเจ้าของธุรกิจจึงจะเพิ่มสมาชิกได้'
  return message || 'เพิ่มสมาชิกไม่สำเร็จ'
}

const STATUS_LABELS = { ACTIVE: 'ใช้งานอยู่', REVOKED: 'ถูกเพิกถอนแล้ว' }

// Any field that could carry a bearer secret. `keyPrefix` is deliberately NOT
// here: it is 8 characters of a 24-byte random secret, kept precisely so a key
// is identifiable in a listing, and the server selects it on purpose.
const FORBIDDEN_KEY_FIELDS = ['key', 'rawKey', 'keyHash', 'secret', 'token']

/**
 * One row of the Enterprise API key panel.
 *
 * Reads only the metadata fields and rebuilds the row from scratch, so a raw
 * secret arriving in the payload — from a future server change, a cached
 * response, or a mint result reused as a list row — cannot reach the DOM by
 * being spread through. This is belt-and-braces over the server's own `select`,
 * and it is worth the duplication: the whole design of FR-106 rests on the raw
 * key existing exactly once, and the cost of that promise failing silently on a
 * page an owner leaves open is a leaked long-lived credential.
 */
export function apiKeyRow(key = {}) {
  const revoked = key.status === 'REVOKED'
  return {
    id: key.id,
    label: key.label,
    tenantId: key.tenantId,
    prefix: key.keyPrefix ? `${key.keyPrefix}…` : '—',
    status: key.status,
    statusLabel: STATUS_LABELS[key.status] || key.status || '—',
    createdAt: key.createdAt ?? null,
    revokedAt: key.revokedAt ?? null,
    lastUsedAt: key.lastUsedAt ?? null,
    revoked,
    // A revoked key is shown, never re-revokable: `revokeApiAccessKey` is a
    // no-op on it and would report `revoked: false`, which reads as a failure.
    canRevoke: !revoked,
  }
}

/** True when the object carries anything that could be a bearer secret. */
export function carriesKeyMaterial(row) {
  if (!row || typeof row !== 'object') return false
  return FORBIDDEN_KEY_FIELDS.some((field) => row[field] !== undefined && row[field] !== null)
}

/**
 * The whole panel: whether to render it at all, the Tenants the mint form may
 * name, and the rows.
 *
 * `available` is the server's answer, not a client guess — an empty `tenants`
 * array is exactly what `listApiAccessKeys` returns for a viewer who is neither
 * the installation operator nor a tenant-wide owner, so the panel disappears
 * for the same people the routes would refuse.
 */
export function buildApiKeyPanel({ tenants = [], keys = [] } = {}) {
  const tenantList = (Array.isArray(tenants) ? tenants : []).filter((tenant) => tenant && tenant.id)
  const rows = (Array.isArray(keys) ? keys : []).map(apiKeyRow)
  const tenantLabels = new Map(tenantList.map((tenant) => [tenant.id, tenant.name || tenant.code || tenant.id]))
  return {
    available: tenantList.length > 0,
    tenants: tenantList,
    defaultTenantId: tenantList[0]?.id ?? null,
    rows: rows.map((row) => ({ ...row, tenantLabel: tenantLabels.get(row.tenantId) || row.tenantId || '—' })),
    activeCount: rows.filter((row) => !row.revoked).length,
  }
}
