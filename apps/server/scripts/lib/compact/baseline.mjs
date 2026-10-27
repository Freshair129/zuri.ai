// @spec ADR-115 — exact fresh schema artifact and current security snapshot, never history replay.
// @tested tests/node/compact-baseline.test.mjs, tests/postgres/compact-fresh-install.test.js
import { CompactError } from './manifest.mjs'
import { digest, stableJson } from './files.mjs'
import { exactKeys, assertCompactJson } from './target.mjs'
import { COMPACT_SECURITY_SQL, PHASE_B_SOURCE, CURRENT_SCHEMA_CONTRACTS } from './security.mjs'
const fail = () => { throw new CompactError('COMPACT_BASELINE_INVALID') }
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const header = revision => `-- Zuri Compact fresh baseline v1\n-- sourceRevision: ${revision}\n`
const securitySuffix = `\n-- COMPACT SECURITY SNAPSHOT\n${COMPACT_SECURITY_SQL}`

export function assertCompactBaselineSql(sql) {
  if (typeof sql !== 'string' || !sql.length || sql.length > 32 * 1024 * 1024 || /[\\\x00`]/.test(sql)) fail()
  let cleaned = '', quote = null, dollar = null, block = 0, line = false
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], next = sql[i + 1]
    if (line) { if (c === '\n') { line = false; cleaned += ' ' }; continue }
    if (block) { if (c === '/' && next === '*') { block++; i++ } else if (c === '*' && next === '/') { block--; i++ }; continue }
    if (quote) { if (c === quote) { if (next === quote) i++; else quote = null }; continue }
    if (dollar) { if (sql.startsWith(dollar, i)) { i += dollar.length - 1; dollar = null }; continue }
    if (c === '-' && next === '-') { line = true; cleaned += ' '; i++; continue }
    if (c === '/' && next === '*') { block = 1; cleaned += ' '; i++; continue }
    if (c === "'" || c === '"') { quote = c; cleaned += ' Q '; continue }
    if (c === '$') { const tag = /^(?:\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/.exec(sql.slice(i))?.[0]; if (tag) { dollar = tag; i += tag.length - 1; cleaned += ' Q '; continue } }
    cleaned += c
  }
  if (quote || dollar || block) fail()
  const statements = cleaned.split(';').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean)
  if (!statements.length || statements.some(s => !/^(?:CREATE (?:TABLE|(?:UNIQUE )?INDEX|ROLE|POLICY|SCHEMA|TYPE|(?:OR REPLACE )?FUNCTION|TRIGGER)\b|ALTER (?:TABLE|DEFAULT PRIVILEGES)\b|GRANT\b|REVOKE\b|DO\b|COMMENT ON\b)/i.test(s))) fail()
  return sql
}
export function buildCompactBaseline({ ddl, canonicalSchema, postgresSchema, sourceRevision } = {}) {
  if (typeof canonicalSchema !== 'string' || typeof postgresSchema !== 'string' || !/^[a-f0-9]{40}$/.test(sourceRevision)) fail()
  const normalize = s => s.replaceAll('\r\n', '\n'), canonical = normalize(canonicalSchema), postgres = normalize(postgresSchema)
  const body = s => { const offset = s.search(/^model\s+/m); if (offset < 0) fail(); return s.slice(offset) }
  if (body(canonical) !== body(postgres) || !/provider\s*=\s*"postgresql"/.test(postgres)) fail()
  assertCompactBaselineSql(ddl)
  const sql = header(sourceRevision) + ddl + securitySuffix
  assertCompactBaselineSql(sql)
  return { sql, metadata: { schemaVersion: 'compact-baseline.v1', sourceRevision, canonicalSchemaSha256: digest(canonical), postgresSchemaSha256: digest(postgres), ddlSha256: digest(ddl), securitySha256: digest(COMPACT_SECURITY_SQL), phaseBSourceSha256: PHASE_B_SOURCE.sha256, sourceContractsSha256: digest(stableJson(CURRENT_SCHEMA_CONTRACTS)), baselineSha256: digest(sql) } }
}
export function validateCompactBaseline(sql, metadata, manifest) {
  assertCompactJson(metadata)
  if (!exactKeys(metadata, ['schemaVersion', 'sourceRevision', 'canonicalSchemaSha256', 'postgresSchemaSha256', 'ddlSha256', 'securitySha256', 'phaseBSourceSha256', 'sourceContractsSha256', 'baselineSha256']) || metadata.schemaVersion !== 'compact-baseline.v1' || metadata.sourceRevision !== manifest.sourceRevision || ['canonicalSchemaSha256', 'postgresSchemaSha256', 'ddlSha256', 'securitySha256', 'phaseBSourceSha256', 'sourceContractsSha256', 'baselineSha256'].some(k => !hash(metadata[k])) || metadata.phaseBSourceSha256 !== PHASE_B_SOURCE.sha256 || metadata.sourceContractsSha256 !== digest(stableJson(CURRENT_SCHEMA_CONTRACTS)) || metadata.securitySha256 !== digest(COMPACT_SECURITY_SQL) || metadata.baselineSha256 !== manifest.schemaBaseline.sha256 || digest(sql) !== metadata.baselineSha256 || !sql.startsWith(header(manifest.sourceRevision)) || !sql.endsWith(securitySuffix)) fail()
  const ddl = sql.slice(header(manifest.sourceRevision).length, -securitySuffix.length)
  if (digest(ddl) !== metadata.ddlSha256) fail()
  assertCompactBaselineSql(sql)
  return sql
}
