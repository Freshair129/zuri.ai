import { formatQualifiedIdentity, parseQualifiedIdentity } from './document-identity-format.mjs'

const BARE_REQUIREMENT = /(?<![A-Za-z0-9_:./-])(?:FR|NFR|BR|SEC|SDD)-\d{3}(?![A-Za-z0-9_/-])/g
const SLASH_SEPARATED_ID = /(?<![A-Za-z0-9_:./-])(?:FR|NFR|BR|SEC|SDD|ADR)-\d{3}(?:\/(?:(?:FR|NFR|BR|SEC|SDD|ADR)-)?\d{3})+(?![A-Za-z0-9_/-])/g
const TRACE_LINE = /^[ \t]*(?:\/\/|\/\*+|\*|#)?[ \t]*@trace[ \t]+([A-Za-z][A-Za-z_-]*)[ \t]+(.+?)[ \t]*(?:\*\/)?$/gm
const OLD_REQUIREMENT = /^(?:FR|NFR|BR|SEC|SDD)-\d{3}$/

function addUnique(list, value) {
  if (!list.includes(value)) list.push(value)
}

function traceTargets(rest) {
  const withoutNote = rest.split(/\s+—\s+/)[0].trim()
  return withoutNote.split(/[,;]/).map(value => value.trim()).filter(Boolean)
}

function addFinding(findings, line, relation, target, code, message) {
  findings.push({ line, relation, target, code, message })
}

/** Return only complete, unqualified legacy 3-digit requirement tokens. */
export function legacyRequirementIds(text) {
  const ids = []
  const normalized = String(text ?? '').replace(SLASH_SEPARATED_ID, value => value.replaceAll('/', ' '))
  for (const match of normalized.matchAll(BARE_REQUIREMENT)) {
    if (/^\.md\b/i.test(normalized.slice(match.index + match[0].length))) continue
    addUnique(ids, match[0])
  }
  return ids
}

/**
 * Adapt source-qualified @trace annotations into the current graph vocabulary.
 * Identity evidence is accepted only for exact ZAI references; aliases are not consulted.
 */
export function adaptTraceAnnotations(text, { resolveIdentity } = {}) {
  const found = { req: [], spec: [], verifiedRequirements: [], findings: [] }
  const body = String(text ?? '')
  for (const match of body.matchAll(TRACE_LINE)) {
    const relation = match[1]
    const line = body.slice(0, match.index).split(/\r?\n/).length
    const targets = traceTargets(match[2])
    if (!['implements', 'specified_by', 'decided_by', 'verifies'].includes(relation)) {
      addFinding(found.findings, line, relation, match[2].trim(), 'UNSUPPORTED_TRACE_RELATION', `Unsupported @trace relation: ${relation}.`)
      continue
    }
    for (const target of targets) {
      let parsed
      try {
        parsed = parseTraceIdentity(target)
      } catch (error) {
        addFinding(found.findings, line, relation, target, error.code || 'INVALID_TRACE_IDENTITY', error.message)
        continue
      }
      if (!parsed.qualified) {
        addFinding(found.findings, line, relation, target, 'UNQUALIFIED_TRACE_IDENTITY', 'Trace evidence requires an explicit namespace.')
        continue
      }
      if (parsed.namespace !== 'ZAI') {
        addFinding(found.findings, line, relation, target, 'NON_CANONICAL_TRACE_IDENTITY', 'Only an exact ZAI identity may contribute current graph evidence.')
        continue
      }
      if (typeof resolveIdentity !== 'function') {
        addFinding(found.findings, line, relation, target, 'IDENTITY_RESOLVER_REQUIRED', 'No identity resolver was supplied for trace evidence.')
        continue
      }
      let identity
      try {
        identity = resolveIdentity(target)
      } catch (error) {
        addFinding(found.findings, line, relation, target, error.code || 'IDENTITY_NOT_FOUND', error.message)
        continue
      }
      if (identity?.namespace !== 'ZAI' || identity?.id !== parsed.id) {
        addFinding(found.findings, line, relation, target, 'IDENTITY_RESOLUTION_MISMATCH', 'Resolver did not return the exact ZAI declaration requested.')
        continue
      }
      if (relation === 'implements') {
        if (!OLD_REQUIREMENT.test(identity.id)) {
          addFinding(found.findings, line, relation, target, 'UNSUPPORTED_IMPLEMENTATION_ID', 'The current graph accepts implementation annotations only for complete 3-digit requirement IDs.')
          continue
        }
        addUnique(found.req, identity.id)
      } else if (relation === 'specified_by' || relation === 'decided_by') {
        addUnique(found.spec, formatQualifiedIdentity(identity))
      } else {
        addUnique(found.verifiedRequirements, formatQualifiedIdentity(identity))
      }
    }
  }
  return found
}

function parseTraceIdentity(value) {
  if (typeof value !== 'string') throw Object.assign(new Error('Trace target must be a string.'), { code: 'INVALID_TRACE_IDENTITY' })
  const target = value.trim()
  const identity = parseQualifiedIdentity(target)
  return identity ? { ...identity, qualified: true } : { id: target, qualified: false }
}
