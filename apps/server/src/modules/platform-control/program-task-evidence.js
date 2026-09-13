// @req FR-219 — evidence badges for each task card: DOC, CODE and TEST from the
//   container links, FR, NFR and FEAT from the ids the task delivers read against
//   the FR-124 snapshot, plus domain code name, complexity and priority. Pure, and
//   run on the server so the client receives badges, not the whole snapshot.
// @spec ADR-086 D6; FR-124; NFR-008 (a colour never travels without its word)
// @tested tests/unit/program-task-evidence.test.js

export const BADGE_TONES = ['done', 'review', 'fix', 'empty']
export const TONE_WORD = { done: 'เสร็จ', review: 'รอรีวิว', fix: 'ต้องแก้', empty: 'ว่าง' }

const LINK_KEYS = [['DOC', 'doc'], ['CODE', 'code'], ['TEST', 'test']]
const NOT_BUILT = new Set(['planned', 'blocked', 'not_implemented'])

/** id → { status, domain } for every FR, NFR and FEAT the snapshot knows. */
export function snapshotIndex(snapshot) {
  const index = new Map()
  if (!snapshot) return index
  for (const feature of snapshot.features || []) {
    if (feature.id?.startsWith('FEAT-')) {
      const status = feature.readiness === 'ready' ? 'verified' : (feature.progressPercent || 0) > 0 ? 'partial' : 'planned'
      index.set(feature.id, { status, domain: feature.primaryDomain || null })
    }
    for (const req of feature.requirementIds || []) {
      if (!index.has(req)) index.set(req, { status: null, domain: feature.primaryDomain || null })
    }
  }
  for (const [domainKey, domain] of Object.entries(snapshot.domains || {})) {
    for (const req of domain.requirements || []) {
      const known = index.get(req.id)
      index.set(req.id, { status: known?.status || req.status, domain: known?.domain || domainKey })
    }
  }
  for (const nfr of snapshot.nonFunctionalRequirements || []) {
    index.set(nfr.id, { status: nfr.status, domain: nfr.domains?.[0] || null })
  }
  // An FR seen only through a FEAT's requirementIds has no status of its own.
  for (const [id, entry] of index) if (!entry.status) index.set(id, { ...entry, status: 'unknown' })
  return index
}

function linkBadge(label, state, path, taskStatus) {
  if (state === 'unavailable' || !state) return { key: label, tone: 'empty', detail: 'ไม่มีลิงก์ใน Task Container' }
  if (state === 'missing') return { key: label, tone: 'fix', detail: `${path} ไม่มีใน repository แล้ว` }
  if (taskStatus === 'done') return { key: label, tone: 'done', detail: path }
  if (taskStatus === 'review') return { key: label, tone: 'review', detail: path }
  return { key: label, tone: 'empty', detail: `${path} · task ยังไม่ถึง review` }
}

function familyBadge(family, ids, index, taskStatus) {
  if (!ids.length) return { key: family, tone: 'empty', detail: `ไม่ได้ส่งมอบ ${family}`, ids }
  const entries = ids.map((id) => ({ id, ...(index.get(id) || { status: 'unknown', domain: null }) }))
  const unknown = entries.filter((e) => e.status === 'unknown')
  if (unknown.length) return { key: family, tone: 'fix', detail: `${unknown.map((e) => e.id).join(', ')} ไม่อยู่ใน snapshot`, ids }
  const claimed = taskStatus === 'done' || taskStatus === 'review'
  const notBuilt = entries.filter((e) => NOT_BUILT.has(e.status))
  if (claimed && notBuilt.length) return { key: family, tone: 'fix', detail: `task เป็น ${taskStatus} แต่ ${notBuilt.map((e) => `${e.id} ${e.status}`).join(', ')}`, ids }
  const summary = entries.map((e) => `${e.id} ${e.status}`).join(', ')
  if (entries.every((e) => e.status === 'verified')) return { key: family, tone: 'done', detail: summary, ids }
  if (entries.some((e) => e.status === 'partial' || e.status === 'verified')) return { key: family, tone: 'review', detail: summary, ids }
  return { key: family, tone: 'empty', detail: summary, ids }
}

function domainOf({ delivers, index, container }) {
  const feat = delivers.find((id) => id.startsWith('FEAT-') && index.get(id)?.domain)
  if (feat) return index.get(feat).domain
  const req = delivers.find((id) => index.get(id)?.domain)
  if (req) return index.get(req).domain
  const m = /(?:^|\/)src\/modules\/([a-z0-9-]+)\//.exec(container?.links?.code || '')
  return m ? m[1] : null
}

/** Badges for one task card (ADR-086 D6). */
export function taskEvidence({ task, container, index }) {
  const [, , , type, complexity, , status] = task
  const delivers = container?.delivers || []
  const evidence = [
    ...LINK_KEYS.map(([label, key]) => linkBadge(label, container?.linkState?.[key], container?.links?.[key], status)),
    familyBadge('FR', delivers.filter((id) => id.startsWith('FR-')), index, status),
    familyBadge('NFR', delivers.filter((id) => id.startsWith('NFR-')), index, status),
    familyBadge('FEAT', delivers.filter((id) => id.startsWith('FEAT-')), index, status),
  ]
  const domain = domainOf({ delivers, index, container })
  return {
    evidence,
    descriptors: [
      { key: 'DOMAIN', label: domain ? `DOM-${domain.toUpperCase()}` : 'DOM-—', detail: domain ? `โดเมน ${domain}` : 'ไม่พบโดเมนจาก id หรือลิงก์โค้ด' },
      { key: 'COMPLEXITY', label: complexity, detail: `ความซับซ้อน ${complexity} · ${type}` },
      { key: 'PRIORITY', label: container?.priority || 'P—', detail: container?.priority ? `ลำดับความสำคัญ ${container.priority}` : 'ไม่มีลำดับความสำคัญในแถว backlog' },
    ],
  }
}

/** Every task's badges, keyed by task id, computed once on the server. */
export function projectTaskEvidence({ tasks, containers, snapshot }) {
  const index = snapshotIndex(snapshot)
  return Object.fromEntries(tasks.map((task) => [task[0], taskEvidence({ task, container: containers[task[0]], index })]))
}
