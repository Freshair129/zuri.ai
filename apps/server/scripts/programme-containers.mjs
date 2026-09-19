import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// @req FR-105 — the programme board's Task Containers, generated from the YAML
//   blocks of the derived 24-week projection joined with its Backlog Items table.
// @req FR-105 — task/phase/sprint delivery state is read from the canonical
//   ROADMAP.md ledger so the projection cannot become a second status source.
// @req FR-219 — each container also carries its priority, the FR/NFR/FEAT ids it
//   delivers, whether each declared link still resolves in the repository, and
//   its subtasks; link existence is checked here because the production image
//   carries neither docs/ nor tests/.
// @req FR-216, FR-217 — and the Delivery Telemetry blocks (sizing table, work
//   lanes, measured usage) become the board's telemetry module.
// @spec ADR-086 D2, D3, D6; ADR-048 D3
// @tested tests/unit/programme-containers.test.js
//
// Usage: node scripts/programme-containers.mjs [--check]
// The blocks are a fixed schema, so a line-based reader is used instead of a
// YAML library: the prose fields (title, changelog, criteria) carry ": " and
// quotes that a strict YAML parser rejects.

export const PROGRAMME_DOCUMENT = 'docs/roadmap/ROADMAP-zuri-ai-24w-program.md'
export const ROADMAP_DOCUMENT = 'docs/roadmap/ROADMAP.md'
export const CONTAINERS_MODULE = 'apps/server/src/modules/platform-control/program-roadmap-containers.js'
export const TELEMETRY_MODULE = 'apps/server/src/modules/platform-control/program-roadmap-telemetry.js'
export const ROADMAP_SOT_MODULE = 'apps/server/src/modules/platform-control/roadmap-sot.js'

const PLAN_BLOCK = /<!-- programme-delivery-plan:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- programme-delivery-plan:end -->/
const USAGE_BLOCK = /<!-- programme-usage:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- programme-usage:end -->/
const TASK_LEDGER_BLOCK = /<!-- roadmap-task-ledger:start -->\s*([\s\S]*?)\s*<!-- roadmap-task-ledger:end -->/
const ROADMAP_SOT_BLOCK = /<!-- roadmap-sot:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- roadmap-sot:end -->/
const UNATTRIBUTABLE_BRANCHES = new Set(['main', 'master', 'HEAD'])
const STATUS_VALUES = new Set(['planned', 'in-progress', 'review', 'done', 'blocked'])
const PROOF_SCOPE_VALUES = new Set(['SPEC', 'UNKNOWN', 'LOCAL', 'ISOLATED', 'HOSTED_CI', 'PRODUCTION'])
const IMPLEMENTATION_STATE_VALUES = new Set(['NOT_STARTED', 'IN_PROGRESS', 'LOCAL', 'ISOLATED_ACCEPTED', 'MERGED', 'DEPLOYED', 'ACTIVE', 'BLOCKED', 'UNKNOWN'])

export class ProgrammeDocumentError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProgrammeDocumentError'
  }
}

export function parseBacklogRows(markdown) {
  const rows = new Map()
  for (const line of markdown.split('\n')) {
    const m = /^\| (TASK-ZAI-\d{3}) \| (SPR-ZAI-\d{2}) \| task \| (.*?) \| (P\d) \| (.*?) \| (.*?) \| (.*?) \| (.*?) \|$/.exec(line)
    if (m) rows.set(m[1], { sprint: m[2], title: m[3], priority: m[4], owner: m[5], status: m[6], deps: m[7], evidence: m[8] })
  }
  return rows
}

export function parseRoadmapTaskLedger(markdown) {
  const block = TASK_LEDGER_BLOCK.exec(markdown)
  if (!block) throw new ProgrammeDocumentError('ROADMAP.md has no roadmap-task-ledger block')
  const rows = new Map()
  for (const line of block[1].split('\n')) {
    if (!/^\| TASK-ZAI-\d{3} \|/.test(line)) continue
    const cells = line.slice(1, -1).split('|').map((cell) => cell.trim())
    if (cells.length !== 9) throw new ProgrammeDocumentError(`canonical task ledger row has ${cells.length} cells: ${line}`)
    const [id, sprint, title, status, proofScope, implementationState, dependsOn, authority, evidence] = cells
    if (rows.has(id)) throw new ProgrammeDocumentError(`canonical task ledger declares ${id} twice`)
    if (!/^TASK-ZAI-\d{3}$/.test(id) || !/^SPR-ZAI-\d{2}$/.test(sprint)) throw new ProgrammeDocumentError(`canonical task ledger has invalid identity: ${id} / ${sprint}`)
    if (!title || !STATUS_VALUES.has(status) || !PROOF_SCOPE_VALUES.has(proofScope) || !IMPLEMENTATION_STATE_VALUES.has(implementationState)) {
      throw new ProgrammeDocumentError(`canonical task ledger has invalid state for ${id}`)
    }
    if (!authority || !evidence) throw new ProgrammeDocumentError(`canonical task ledger needs authority and evidence for ${id}`)
    rows.set(id, { id, sprint, title, status, proofScope, implementationState, dependsOn, authority, evidence })
  }
  if (!rows.size) throw new ProgrammeDocumentError('canonical task ledger has no TASK-ZAI rows')
  return rows
}

export function parseRoadmapSot(markdown) {
  const block = ROADMAP_SOT_BLOCK.exec(markdown)
  if (!block) throw new ProgrammeDocumentError('ROADMAP.md has no roadmap-sot block')
  try {
    return JSON.parse(block[1])
  } catch (error) {
    throw new ProgrammeDocumentError(`the roadmap-sot block is not valid JSON: ${error.message}`)
  }
}

export function buildRoadmapDag(ledger) {
  const rows = [...ledger.values()]
  const ids = new Set(rows.map((row) => row.id))
  const children = new Map(rows.map((row) => [row.id, []]))
  const indegree = new Map(rows.map((row) => [row.id, 0]))
  const missingDependencies = new Set()
  let edgeCount = 0

  for (const row of rows) {
    const deps = String(row.dependsOn || '')
      .split(';')
      .map((value) => value.trim())
      .filter((value) => value && value !== '—')
    for (const dep of deps) {
      if (!ids.has(dep)) {
        missingDependencies.add(dep)
        continue
      }
      children.get(dep).push(row.id)
      indegree.set(row.id, indegree.get(row.id) + 1)
      edgeCount += 1
    }
  }

  let frontier = rows.filter((row) => indegree.get(row.id) === 0).map((row) => row.id).sort()
  const waves = []
  while (frontier.length) {
    waves.push({ wave: waves.length + 1, taskIds: frontier })
    const next = []
    for (const id of frontier) {
      for (const child of children.get(id)) {
        indegree.set(child, indegree.get(child) - 1)
        if (indegree.get(child) === 0) next.push(child)
      }
    }
    frontier = next.sort()
  }

  return {
    algorithm: 'kahn-topological-layers',
    nodeCount: rows.length,
    edgeCount,
    waveCount: waves.length,
    missingDependencies: [...missingDependencies].sort(),
    cycles: rows.filter((row) => indegree.get(row.id) > 0).map((row) => row.id).sort(),
    parallelPolicy: 'same-wave tasks have no declared dependency path; run them in parallel only after lane, ownership and shared-file conflict checks pass',
    waves,
  }
}

export function validateRoadmapSot(sot, ledger) {
  if (sot?.schemaVersion !== 1) throw new ProgrammeDocumentError('roadmap-sot schemaVersion must be 1')
  if (!Array.isArray(sot.statusVocabulary) || !Array.isArray(sot.proofScopeVocabulary) || !Array.isArray(sot.implementationStateVocabulary)) {
    throw new ProgrammeDocumentError('roadmap-sot is missing its state vocabularies')
  }
  for (const row of ledger.values()) {
    if (!sot.statusVocabulary.includes(row.status)) throw new ProgrammeDocumentError(`${row.id} status is outside roadmap-sot vocabulary`)
    if (!sot.proofScopeVocabulary.includes(row.proofScope)) throw new ProgrammeDocumentError(`${row.id} proof scope is outside roadmap-sot vocabulary`)
    if (!sot.implementationStateVocabulary.includes(row.implementationState)) throw new ProgrammeDocumentError(`${row.id} implementation state is outside roadmap-sot vocabulary`)
  }
  const expectedDag = buildRoadmapDag(ledger)
  if (JSON.stringify(sot.dag) !== JSON.stringify(expectedDag)) {
    throw new ProgrammeDocumentError('roadmap-sot DAG is stale or does not match canonical task dependencies')
  }
  if (expectedDag.missingDependencies.length || expectedDag.cycles.length) {
    throw new ProgrammeDocumentError(`roadmap-sot DAG is not runnable: missing=${expectedDag.missingDependencies.join(',') || 'none'} cycles=${expectedDag.cycles.join(',') || 'none'}`)
  }
  const phaseIds = ['PHASE-ZAI-01', 'PHASE-ZAI-02', 'PHASE-ZAI-03', 'PHASE-ZAI-04', 'PHASE-ZAI-05', 'PHASE-ZAI-06']
  const sprintIds = Array.from({ length: 12 }, (_, index) => `SPR-ZAI-${String(index + 1).padStart(2, '0')}`)
  for (const [kind, ids] of [['phase', phaseIds], ['sprint', sprintIds]]) {
    const group = kind === 'phase' ? sot.programme?.phases : sot.programme?.sprints
    for (const id of ids) {
      const row = group?.[id]
      if (!row || !STATUS_VALUES.has(row.status) || !Number.isInteger(row.progress) || row.progress < 0 || row.progress > 100) {
        throw new ProgrammeDocumentError(`roadmap-sot has no valid ${kind} progress for ${id}`)
      }
    }
  }
  const entries = [...(sot.subplans || []), ...(sot.coverage || [])]
  if (!Array.isArray(sot.subplans) || !Array.isArray(sot.coverage)) throw new ProgrammeDocumentError('roadmap-sot needs subplans and coverage arrays')
  const duplicateKeys = new Map()
  for (const entry of entries) {
    if (!entry.id && !entry.stageId) throw new ProgrammeDocumentError('roadmap-sot coverage entry has no id')
    if (!entry.status || !STATUS_VALUES.has(entry.status)) throw new ProgrammeDocumentError(`roadmap-sot entry ${entry.id || entry.stageId} has invalid status`)
    if (!PROOF_SCOPE_VALUES.has(entry.proofScope) || !IMPLEMENTATION_STATE_VALUES.has(entry.implementationState)) throw new ProgrammeDocumentError(`roadmap-sot entry ${entry.id || entry.stageId} has invalid evidence state`)
    if (!entry.authority || !entry.evidence || !entry.duplicateKey || !entry.relation) throw new ProgrammeDocumentError(`roadmap-sot entry ${entry.id || entry.stageId} is missing traceability fields`)
    const prior = duplicateKeys.get(entry.duplicateKey) || []
    prior.push(entry)
    duplicateKeys.set(entry.duplicateKey, prior)
  }
  if (sot.coverage.length !== 17) throw new ProgrammeDocumentError(`roadmap-sot must enumerate 17 stages, got ${sot.coverage.length}`)
  for (const [key, rows] of duplicateKeys) {
    if (rows.length > 1 && rows.some((row) => !/(adapter|legacy|fallback|replaces)/i.test(row.relation))) {
      throw new ProgrammeDocumentError(`duplicate implementation key ${key} needs an adapter/legacy/fallback/replaces relation`)
    }
  }
  return sot
}

export function reconcileDerivedProgramme({ markdown, ledger, sot }) {
  const lines = markdown.split('\n').map((line) => {
    const taskId = /^\| (TASK-ZAI-\d{3}) \|/.exec(line)?.[1]
    if (taskId && ledger.has(taskId)) {
      const cells = line.slice(1, -1).split('|').map((cell) => cell.trim())
      if (cells.length === 9) {
        cells[6] = ledger.get(taskId).status
        return `| ${cells.join(' | ')} |`
      }
    }
    const phaseId = /^\| (PHASE-ZAI-\d{2}) \|/.exec(line)?.[1]
    const sprintId = /^\| (SPR-ZAI-\d{2}) \|/.exec(line)?.[1]
    const state = phaseId ? sot.programme.phases[phaseId] : sprintId ? sot.programme.sprints[sprintId] : null
    if (state) return line.replace(/\| (planned|in-progress|review|done|blocked) \| \d+ \|$/, `| ${state.status} | ${state.progress} |`)
    return line
  })
  return lines.join('\n')
}

const unquote = (s) => {
  const t = s.trim()
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1)
  return t
}

export function parseContainerBlock(text) {
  const y = { symbol_links: {}, dod: {}, telemetry: {}, delivers: [], subtasks: [] }
  let section = null
  let critList = null
  let crit = null
  let subtask = null
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue
    const indent = raw.length - raw.trimStart().length
    const line = raw.trim()
    if (indent === 0) {
      const i = line.indexOf(':')
      section = line.slice(0, i)
      const value = line.slice(i + 1)
      if (value.trim() !== '' && section !== 'delivers' && section !== 'subtasks') y[section] = unquote(value)
      if (section === 'delivers') {
        // `delivers: []` is a statement ("this task delivers no FR, NFR or FEAT"),
        // not an omission, so it switches the title fallback off.
        y.deliversDeclared = true
        if (value.trim().startsWith('[')) y.delivers = value.trim().slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)
      }
      continue
    }
    if (section === 'symbol_links' && indent === 2) {
      const i = line.indexOf(':')
      y.symbol_links[line.slice(0, i)] = unquote(line.slice(i + 1))
    } else if (section === 'definition_of_done') {
      if (indent === 2) { critList = line.replace(/:$/, ''); y.dod[critList] = [] }
      else if (indent === 4 && line.startsWith('- criterion:')) { crit = { criterion: unquote(line.slice('- criterion:'.length)), checked: false }; y.dod[critList].push(crit) }
      else if (indent === 6 && line.startsWith('checked:')) { crit.checked = line.slice('checked:'.length).trim() === 'true' }
    } else if (section === 'token_telemetry' && indent === 2) {
      const i = line.indexOf(':')
      y.telemetry[line.slice(0, i)] = line.slice(i + 1).trim()
    } else if (section === 'delivers' && indent === 2 && line.startsWith('- ')) {
      y.delivers.push(unquote(line.slice(2)))
    } else if (section === 'subtasks') {
      if (indent === 2 && line.startsWith('- id:')) { subtask = { id: unquote(line.slice('- id:'.length)), title: '', status: '' }; y.subtasks.push(subtask) }
      else if (indent === 4 && subtask && line.startsWith('title:')) subtask.title = unquote(line.slice('title:'.length))
      else if (indent === 4 && subtask && line.startsWith('status:')) subtask.status = unquote(line.slice('status:'.length))
    }
  }
  return y
}

/**
 * The FR, NFR and FEAT ids a title names, with "FR-154 to FR-156" ranges
 * expanded, in first-seen order (ADR-086 D6). ADR, BR and SDD ids are sources,
 * not deliverables, and are ignored.
 */
export function extractDeliveredIds(text) {
  const ids = []
  const add = (id) => { if (!ids.includes(id)) ids.push(id) }
  const re = /\b(FR|NFR|FEAT)-(\d{3})(?:\s+to\s+(?:\1-)?(\d{3}))?\b/g
  let m
  while ((m = re.exec(text))) {
    const [, family, from, to] = m
    if (!to) { add(`${family}-${from}`); continue }
    const start = Number(from)
    const end = Number(to)
    if (end < start || end - start > 40) throw new ProgrammeDocumentError(`implausible id range ${m[0]}`)
    for (let n = start; n <= end; n += 1) add(`${family}-${String(n).padStart(3, '0')}`)
  }
  return ids
}

const linkState = (link, fileExists) => {
  if (!link || link === 'unavailable') return 'unavailable'
  return fileExists(link) ? 'present' : 'missing'
}

export function buildContainers({ markdown, fileExists }) {
  const rows = parseBacklogRows(markdown)
  const out = {}
  const blockRe = /### TC-(TASK-ZAI-\d{3})\n\n```yaml\n([\s\S]*?)\n```/g
  let match
  while ((match = blockRe.exec(markdown))) {
    const id = match[1]
    const y = parseContainerBlock(match[2])
    const row = rows.get(id)
    if (!row) throw new ProgrammeDocumentError(`no backlog row for ${id}`)
    const crit = (list) => ({ text: list[0].criterion, checked: Boolean(list[0].checked) })
    for (const sub of y.subtasks) {
      if (!/^P\d$/.test(sub.id)) throw new ProgrammeDocumentError(`${id} subtask id "${sub.id}" is not P0..P9`)
      if (!sub.title || !sub.status) throw new ProgrammeDocumentError(`${id} subtask ${sub.id} needs a title and a status`)
    }
    const delivers = y.deliversDeclared ? y.delivers : extractDeliveredIds(y.title || row.title)
    for (const d of delivers) if (!/^(FR|NFR|FEAT)-\d{3}$/.test(d)) throw new ProgrammeDocumentError(`${id} delivers "${d}", which is not an FR, NFR or FEAT id`)
    const links = { code: y.symbol_links.code, doc: y.symbol_links.doc, test: y.symbol_links.test }
    out[id] = {
      container: y.task_container_id,
      phase: y.parent_phase_id,
      sprint: y.parent_sprint_id,
      version: y.version,
      priority: row.priority,
      pic: y.pic,
      executor: y.executor,
      approver: y.approver,
      auditor: y.auditor,
      links,
      linkState: { code: linkState(links.code, fileExists), doc: linkState(links.doc, fileExists), test: linkState(links.test, fileExists) },
      delivers,
      subtasks: y.subtasks,
      dod: {
        acceptance: crit(y.dod.acceptance_criteria),
        success: crit(y.dod.success_criteria),
        exit: crit(y.dod.exit_criteria),
      },
      changelog: y.changelog,
      created: y.created_at,
      predictedTokens: Number(y.telemetry.predicted_token_usage),
      totalTokens: Number(y.telemetry.total_token_usage),
      dependsOn: row.deps === '-' ? [] : row.deps.split(';').map((s) => s.trim()).filter(Boolean),
      evidence: row.evidence,
    }
  }
  return out
}

export function parseDeliveryPlan(markdown) {
  const m = PLAN_BLOCK.exec(markdown)
  if (!m) throw new ProgrammeDocumentError('the programme document has no programme-delivery-plan block')
  try {
    return JSON.parse(m[1])
  } catch (error) {
    throw new ProgrammeDocumentError(`the programme-delivery-plan block is not valid JSON: ${error.message}`)
  }
}

export function parseUsageBlock(markdown) {
  const m = USAGE_BLOCK.exec(markdown)
  if (!m) throw new ProgrammeDocumentError('the programme document has no programme-usage block')
  try {
    return JSON.parse(m[1])
  } catch (error) {
    throw new ProgrammeDocumentError(`the programme-usage block is not valid JSON: ${error.message}`)
  }
}

export function replaceUsageBlock(markdown, usage) {
  if (!USAGE_BLOCK.test(markdown)) throw new ProgrammeDocumentError('the programme document has no programme-usage block')
  return markdown.replace(USAGE_BLOCK, `<!-- programme-usage:start -->\n\`\`\`json\n${JSON.stringify(usage, null, 2)}\n\`\`\`\n<!-- programme-usage:end -->`)
}

/** Refuses a lane the meter could not attribute honestly (ADR-086 D3). */
export function validateDeliveryPlan(plan, containers) {
  const { sizing, lanes } = plan
  for (const band of ['C-1', 'C-2', 'C-3']) {
    if (!Number.isFinite(sizing?.points?.[band]) || !Number.isFinite(sizing?.effortHours?.[band])) {
      throw new ProgrammeDocumentError(`the sizing table has no points or effort hours for ${band}`)
    }
  }
  if (!Number.isFinite(sizing.activeGapCapMinutes) || sizing.activeGapCapMinutes <= 0) throw new ProgrammeDocumentError('the sizing table has no activeGapCapMinutes')
  const branchOwner = new Map()
  const laneIds = new Set()
  for (const lane of lanes) {
    if (!/^LANE-[A-Z0-9-]+$/.test(lane.id)) throw new ProgrammeDocumentError(`lane id "${lane.id}" is not LANE-...`)
    if (laneIds.has(lane.id)) throw new ProgrammeDocumentError(`lane ${lane.id} is declared twice`)
    laneIds.add(lane.id)
    if (!lane.tasks?.length) throw new ProgrammeDocumentError(`lane ${lane.id} names no task`)
    if (!lane.branches?.length) throw new ProgrammeDocumentError(`lane ${lane.id} names no branch`)
    const phases = new Set()
    for (const task of lane.tasks) {
      if (!containers[task]) throw new ProgrammeDocumentError(`lane ${lane.id} names ${task}, which has no Task Container`)
      phases.add(containers[task].phase)
    }
    if (phases.size > 1) throw new ProgrammeDocumentError(`lane ${lane.id} spans phases ${[...phases].join(', ')}; a lane belongs to one phase`)
    for (const branch of lane.branches) {
      if (UNATTRIBUTABLE_BRANCHES.has(branch)) throw new ProgrammeDocumentError(`lane ${lane.id} declares ${branch}, which cannot be attributed`)
      if (branchOwner.has(branch)) throw new ProgrammeDocumentError(`branch ${branch} is claimed by ${branchOwner.get(branch)} and ${lane.id}`)
      branchOwner.set(branch, lane.id)
    }
  }
  const taskLane = new Map()
  for (const lane of lanes) for (const task of lane.tasks) {
    if (taskLane.has(task)) throw new ProgrammeDocumentError(`${task} is in ${taskLane.get(task)} and ${lane.id}`)
    taskLane.set(task, lane.id)
  }
  return plan
}

export function renderContainersModule({ containers, version, updated }) {
  return `// @req FR-105 — the Task Containers of the submitted programme, one per
// backlog row, copied from the YAML blocks of ROADMAP-ZURI-AI-24W-PROGRAM
// (v${version}, ${updated}) so the board can open a task the way the html board
// does: links, container identity, definition of done with the per-criterion
// \`checked\` flags the document records, changelog and dependencies.
// @req FR-219 — plus priority, delivered ids, link state and subtasks.
// @spec ADR-048 D3, ADR-086 D6 — document data, never measured here.
// @tested tests/unit/platform-control-route-contract.test.js, tests/unit/programme-containers.test.js
//
// GENERATED by scripts/programme-containers.mjs from the markdown containers.
// Do not hand-edit; change the document and regenerate.
export const PROGRAMME_CONTAINERS = ${JSON.stringify(containers, null, 2)}
`
}

export function renderTelemetryModule({ plan, usage, version }) {
  return `// @req FR-216, FR-217 — the Delivery Telemetry section of ROADMAP-ZURI-AI-24W-PROGRAM
// (v${version}): the sizing table and work lanes the owner declares, and the usage
// the meter measured from local agent session logs.
// @spec ADR-086 D1-D4 — planned and measured stay separate; usage is never progress.
// @tested tests/unit/programme-containers.test.js, tests/unit/program-delivery-metrics.test.js
//
// GENERATED by scripts/programme-containers.mjs. Do not hand-edit.
export const PROGRAMME_SIZING = ${JSON.stringify(plan.sizing, null, 2)}

export const PROGRAMME_LANES = ${JSON.stringify(plan.lanes, null, 2)}

export const PROGRAMME_USAGE = ${JSON.stringify(usage, null, 2)}
`
}

export function renderRoadmapSotModule({ sot, ledger }) {
  return `// @req FR-105 — canonical delivery status, proof scope and implementation state
// projected from docs/roadmap/ROADMAP.md. The 24-week document is not a second
// status source; it supplies the compatibility topology and Task Containers.
// @spec ADR-048 D3, ADR-086 D3
// @tested tests/unit/programme-containers.test.js
//
// GENERATED by scripts/programme-containers.mjs. Do not hand-edit.
export const ROADMAP_SOT = ${JSON.stringify(sot, null, 2)}

export const ROADMAP_TASK_LEDGER = ${JSON.stringify([...ledger.values()], null, 2)}

export const ROADMAP_TASK_STATUS = Object.freeze(Object.fromEntries(ROADMAP_TASK_LEDGER.map((row) => [row.id, row.status])))
`
}

export function buildProgrammeModules({ markdown, roadmapMarkdown = null, fileExists }) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(markdown)?.[1]
  if (!fm) throw new ProgrammeDocumentError('the programme document has no frontmatter')
  const version = /version:\s*"([^"]+)"/.exec(fm)[1]
  const updated = /updated:\s*"([^"]+)"/.exec(fm)[1]
  const containers = buildContainers({ markdown, fileExists })
  const plan = validateDeliveryPlan(parseDeliveryPlan(markdown), containers)
  const usage = parseUsageBlock(markdown)
  for (const laneId of Object.keys(usage.lanes || {})) {
    if (!plan.lanes.some((lane) => lane.id === laneId)) throw new ProgrammeDocumentError(`the usage block measures ${laneId}, which the plan does not declare`)
  }
  let ledger = new Map()
  let sot = null
  if (roadmapMarkdown) {
    ledger = parseRoadmapTaskLedger(roadmapMarkdown)
    sot = validateRoadmapSot(parseRoadmapSot(roadmapMarkdown), ledger)
    const backlog = parseBacklogRows(markdown)
    if (ledger.size !== backlog.size) throw new ProgrammeDocumentError(`canonical task ledger has ${ledger.size} rows but the programme backlog has ${backlog.size}`)
    for (const [id, row] of backlog) {
      const canonical = ledger.get(id)
      if (!canonical) throw new ProgrammeDocumentError(`programme backlog task ${id} is missing from the canonical task ledger`)
      if (canonical.sprint !== row.sprint) throw new ProgrammeDocumentError(`${id} is SPR ${canonical.sprint} in ROADMAP.md but ${row.sprint} in the derived programme`)
    }
  }
  return {
    containers,
    plan,
    usage,
    ledger,
    sot,
    derivedMarkdown: sot ? reconcileDerivedProgramme({ markdown, ledger, sot }) : null,
    containersSource: renderContainersModule({ containers, version, updated }),
    telemetrySource: renderTelemetryModule({ plan, usage, version }),
    sotSource: sot ? renderRoadmapSotModule({ sot, ledger }) : null,
  }
}

export const repositoryRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

export function generateProgrammeModules({ root = repositoryRoot(), check = false } = {}) {
  const markdown = readFileSync(path.join(root, PROGRAMME_DOCUMENT), 'utf8').replace(/\r\n/g, '\n')
  const roadmapMarkdown = readFileSync(path.join(root, ROADMAP_DOCUMENT), 'utf8').replace(/\r\n/g, '\n')
  const fileExists = (link) => !link.includes('..') && existsSync(path.join(root, link))
  const built = buildProgrammeModules({ markdown, roadmapMarkdown, fileExists })
  const targets = [
    ...(built.derivedMarkdown && built.derivedMarkdown !== markdown ? [[PROGRAMME_DOCUMENT, built.derivedMarkdown]] : []),
    [CONTAINERS_MODULE, built.containersSource],
    [TELEMETRY_MODULE, built.telemetrySource],
    [ROADMAP_SOT_MODULE, built.sotSource],
  ]
  const drift = []
  for (const [rel, source] of targets) {
    const file = path.join(root, rel)
    const current = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null
    if (current !== source) {
      drift.push(rel)
      if (!check) writeFileSync(file, source)
    }
  }
  return { ...built, drift }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const check = process.argv.includes('--check')
  try {
    const { containers, drift } = generateProgrammeModules({ check })
    const count = Object.keys(containers).length
    if (check) {
      if (drift.length) {
        console.error(`programme-containers: stale — ${drift.join(', ')} differ from ${PROGRAMME_DOCUMENT} or ${ROADMAP_DOCUMENT}; run node scripts/programme-containers.mjs`)
        process.exit(1)
      }
      console.log(`programme-containers: ${count} containers, modules in step`)
    } else {
      console.log(`programme-containers: ${count} containers · ${drift.length ? `wrote ${drift.join(', ')}` : 'no change'}`)
    }
  } catch (error) {
    console.error(`programme-containers: ${error.message}`)
    process.exit(1)
  }
}
