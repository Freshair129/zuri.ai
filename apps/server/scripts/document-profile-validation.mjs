import path from 'node:path'
import { buildCanonicalGraphEntries } from './canonical-document-registry.mjs'

const ID_PATTERN = /\b(FEAT|FR|NFR|BR|SEC|SDD)-\d{3,}\b/g
const REQUIRED_SRS_HEADINGS = [
  '1. Purpose and boundary',
  '2. Process and capability map',
  '3. Requirements index',
  '4. Domain and service contracts',
  '5. Acceptance and verification references',
  '6. Exclusions and unresolved conflicts',
  '7. Change history',
]

function decodePath(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function tableFirstCellLinks(markdown) {
  const result = []
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^\|\s*\[`([^`]+)`\]\(([^)]+)\)\s*\|/.exec(line)
    if (match) result.push({ label: match[1], href: match[2] })
  }
  return result
}

function registerNames(markdown, wantDirectory) {
  const names = new Set()
  for (const { label } of tableFirstCellLinks(markdown)) {
    const decodedLabel = decodePath(label)
    const isDirectory = decodedLabel.endsWith('/')
    if (isDirectory !== wantDirectory) continue
    const name = decodedLabel.replace(/\/$/, '')
    if (name && !name.includes('/')) names.add(name)
  }
  return [...names].sort()
}

/** Parse the first-column links in ROOT-FILE-REGISTER.md. */
export function parseDirectRootFileRegister(markdown) {
  return registerNames(markdown, false)
}

/** Parse the first-column links in DOCS-DIRECTORY-REGISTER.md. */
export function parseDirectDirectoryRegister(markdown) {
  return registerNames(markdown, true)
}

/** Compare named direct docs entries while ignoring only explicitly named generated files. */
export function compareDocumentationInventory({
  registeredRootFiles = [],
  registeredDirectories = [],
  actualRootFiles = [],
  actualDirectories = [],
  generatedRootFiles = [],
}) {
  const registeredFiles = new Set(registeredRootFiles)
  const registeredDirs = new Set(registeredDirectories)
  const actualFiles = new Set(actualRootFiles.filter(name => !generatedRootFiles.includes(name)))
  const actualDirs = new Set(actualDirectories)
  const difference = (left, right) => [...left].filter(value => !right.has(value)).sort()
  return {
    missingRootFiles: difference(registeredFiles, actualFiles),
    unregisteredRootFiles: difference(actualFiles, registeredFiles),
    missingDirectories: difference(registeredDirs, actualDirs),
    unregisteredDirectories: difference(actualDirs, registeredDirs),
  }
}

function frontmatter(body) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body)
  if (!match) return { text: '', fields: new Map() }
  const fields = new Map()
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([a-z][a-z0-9_]*):\s*(.*?)\s*$/i.exec(line)
    if (field) fields.set(field[1], field[2].replace(/^(["'])(.*)\1$/, '$2'))
  }
  return { text: match[1], fields }
}

function section(body, heading) {
  const lines = body.split(/\r?\n/)
  const start = lines.findIndex(line => line.trim() === `## ${heading}`)
  if (start < 0) return ''
  const endOffset = lines.slice(start + 1).findIndex(line => /^##\s+/.test(line))
  const end = endOffset < 0 ? lines.length : start + 1 + endOffset
  return lines.slice(start + 1, end).join('\n')
}

function tableRows(markdown) {
  return markdown.split(/\r?\n/)
    .filter(line => /^\s*\|/.test(line))
    .filter(line => !/^\s*\|\s*:?-{3,}/.test(line))
    .map(line => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => cell.replace(/\\\|/g, '|').trim()))
}

function markdownLinks(cell) {
  return [...cell.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((match) => ({ label: match[1], href: match[2] }))
}

function idsIn(value) {
  return [...value.matchAll(new RegExp(ID_PATTERN.source, 'g'))].map(match => match[0])
}

function resolveDocumentPath(fromPath, href) {
  if (/^(?:[a-z]+:|\/\/|#)/i.test(href)) return null
  const withoutSuffix = href.split(/[?#]/, 1)[0]
  const decoded = decodePath(withoutSuffix).replace(/\\/g, '/')
  const resolved = decoded.startsWith('docs/')
    ? path.posix.normalize(decoded)
    : path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), decoded))
  return resolved.startsWith('docs/') ? resolved : null
}

function recordIdentity(item) {
  return item?.record?.id ?? item?.entry?.id
}

function recordPath(item) {
  return item?.entry?.path
}

function addIssue(issues, code, message) {
  issues.push({ code, message })
}

function validateLinkedIds({ cell, expectedFamily, fromPath, recordById, issues, context }) {
  const linkedIds = new Set()
  const links = markdownLinks(cell)
  for (const link of links) {
    for (const id of idsIn(link.label)) {
      linkedIds.add(id)
      const item = recordById.get(id)
      if (!item || (expectedFamily && item.record.family !== expectedFamily)) {
        addIssue(issues, 'canonical-record', `${context} references ${id}, which is not a canonical ${expectedFamily || 'record'}`)
        continue
      }
      const actualPath = resolveDocumentPath(fromPath, link.href)
      if (actualPath !== recordPath(item)) {
        addIssue(issues, 'canonical-path', `${context} ${id} links to ${actualPath || link.href}; canonical path is ${recordPath(item)}`)
      }
    }
  }
  const visibleLabels = cell.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  for (const id of idsIn(visibleLabels)) {
    if (!linkedIds.has(id)) addIssue(issues, 'canonical-link', `${context} must link ${id} to its canonical record`)
  }
  return [...linkedIds]
}

/**
 * Validate only source-linked SRS views explicitly marked `doc_type: domain-srs-view`.
 * Legacy SRS documents remain outside this profile until they opt in.
 */
export function validateDomainSrsView({ relativePath, body, charterPath, charterBody, records = [] }) {
  const { fields, text: metadata } = frontmatter(body)
  if (fields.get('doc_type') !== 'domain-srs-view') return { applicable: false, issues: [] }

  const issues = []
  const recordById = new Map(records.map(item => [recordIdentity(item), item]).filter(([id]) => id))
  const graphNodes = buildCanonicalGraphEntries(records).nodes
  const lifecycleById = new Map(graphNodes.map(node => [node.id.replace(/^(?:req|feat):/, ''), node.status]))
  const domainId = fields.get('domain_id')
  const charterFields = frontmatter(charterBody || '').fields
  const charterDomainId = charterFields.get('domain_id')
  if (!domainId || /^REPLACE_WITH_/i.test(domainId)) {
    addIssue(issues, 'domain-id', 'domain-srs-view must declare the domain_id from its source charter')
  } else if (!charterBody) {
    addIssue(issues, 'domain-charter', `source charter is missing at ${charterPath || '(unresolved)'}`)
  } else if (!charterDomainId) {
    addIssue(issues, 'source-domain-id', 'source charter does not declare domain_id; ownership cannot be inferred from its folder')
  } else if (domainId !== charterDomainId) {
    addIssue(issues, 'domain-id', `domain_id ${domainId} differs from charter domain_id ${charterDomainId}`)
  }

  const revision = fields.get('source_revision')
  if (!revision || !/^[a-f0-9]{40}$/i.test(revision)) {
    addIssue(issues, 'source-revision', 'source_revision must be a full reviewed Git revision')
  }
  if (!fields.get('status') || !fields.get('version')) addIssue(issues, 'document-control', 'domain-srs-view must declare status and version')
  if (/REPLACE_WITH_[A-Z0-9_]+/.test(body)) addIssue(issues, 'placeholder', 'domain-srs-view still contains template placeholders')

  const relationTarget = /^\s*target:\s*["']?([^\s"']+)/m.exec(metadata)?.[1]
  const resolvedRelation = relationTarget && resolveDocumentPath(relativePath, relationTarget)
  if (!relationTarget || resolvedRelation !== charterPath) {
    addIssue(issues, 'charter-link', `frontmatter relation must target ${charterPath || 'the exact source charter'}`)
  }

  for (const heading of REQUIRED_SRS_HEADINGS) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!new RegExp(`^##\\s+${escaped}\\s*$`, 'm').test(body)) addIssue(issues, 'profile-heading', `required profile section is missing: ${heading}`)
  }

  const requirements = new Map()
  const requirementSection = section(body, '3. Requirements index')
  const rows = tableRows(requirementSection)
  if (!rows[0]?.includes('Canonical lifecycle')) {
    addIssue(issues, 'profile-table', 'requirements index must label the derived status column "Canonical lifecycle"')
  }
  for (const cells of rows.slice(1)) {
    const id = idsIn(cells[0] || '')[0]
    if (!id) {
      if ((cells[0] || '').trim()) addIssue(issues, 'canonical-id', `requirements index row has no canonical ID: ${cells[0]}`)
      continue
    }
    if (requirements.has(id)) addIssue(issues, 'duplicate-canonical-id', `${id} appears more than once in the requirements index`)
    const item = recordById.get(id)
    if (!item) {
      addIssue(issues, 'canonical-record', `requirements index references unknown canonical record ${id}`)
      continue
    }
    const links = markdownLinks(cells[1] || '')
    const href = links[0]?.href
    if (!href) addIssue(issues, 'canonical-link', `${id} must link to its canonical record path`)
    const listedPath = href ? resolveDocumentPath(relativePath, href) : null
    if (listedPath !== recordPath(item)) {
      addIssue(issues, 'canonical-path', `${id} lists ${listedPath || '(no source path)'}; canonical path is ${recordPath(item)}`)
    }
    const lifecycle = lifecycleById.get(id)
    if (!lifecycle || cells[2] !== lifecycle) {
      addIssue(issues, 'source-lifecycle', `${id} lifecycle is ${cells[2] || '(blank)'}; canonical source value is ${lifecycle || '(unavailable)'}`)
    }
    requirements.set(id, item)
  }

  const capabilitySection = section(body, '2. Process and capability map')
  for (const cells of tableRows(capabilitySection).slice(1)) {
    const featureIds = validateLinkedIds({ cell: cells[1] || '', expectedFamily: 'FEAT', fromPath: relativePath, recordById, issues, context: 'process map' })
    const requirementIds = validateLinkedIds({ cell: cells[2] || '', expectedFamily: 'FR', fromPath: relativePath, recordById, issues, context: 'process map' })
    for (const frId of requirementIds) {
      if (!requirements.has(frId)) addIssue(issues, 'requirements-index', `${frId} appears in the process map but not in the requirements index`)
    }
    for (const featId of featureIds) {
      const feature = recordById.get(featId)?.record
      for (const frId of requirementIds) {
        const fr = recordById.get(frId)?.record
        if (feature && fr && (!(feature.requirementKeys || []).includes(frId) || fr.featureId !== featId)) {
          addIssue(issues, 'feat-membership', `${frId} is listed under ${featId}, but canonical FEAT-to-FR membership does not include it`)
        }
      }
    }
  }

  return { applicable: true, issues }
}
