// @tested tests/unit/schema-migration-drift.test.js
//
// The rules behind preflight Check 18 (schema-migration-drift), kept out of
// doc-preflight.mjs for the same reason scripts/table-integrity.mjs and
// scripts/untracked-docs.mjs are: that script is straight-line and derives
// ROOT from its own location, so it cannot be pointed at a fixture. Everything
// with judgement in it — what a Prisma field is, what a migration creates, and
// which identifier is which — lives here, where a test can reach it.
//
// Filesystem-free by construction: the schema text, the migration texts and the
// baseline are injected.
//
// ## What this check is for
//
// One question: does every column the production schema declares exist on the
// production database? Asked statically, by reading what the migrations say
// they create, because a check that needs a database cannot run in CI and a
// check that only an operator can run is a check nobody runs.
//
// `RawExternalRecord.artifactId` entered prisma/schema.prisma at ced1fba
// (2026-08-29, FR-109 AC-109.3, PR #165) with an index, a repository read, a
// unit suite and a real-database integration test — and no migration in either
// migration tree. Local development never noticed: the dev database is SQLite
// under `prisma db push`, which reconciles the file and the database directly,
// so a field with no migration is the normal case there. Production Supabase
// is migrated by hand from supabase/migrations/*.sql, and no file there added
// the column. `GET /api/backup/export` selects every column of every snapshot
// model, so it failed on production with "The column RawExternalRecord.artifactId
// does not exist" from that day until the column was noticed on 2026-09-05 —
// seven days — while every check in the repository stayed green
// (.brain/rca/2026-09-06-a-schema-column-with-no-migration.md).
//
// ## Why it anchors on the GENERATED Postgres schema and nothing else
//
// The obvious guard — "every field in prisma/schema.prisma needs a migration"
// — is wrong for this repository and would be disabled within a week. That
// file is the SQLite dev schema, its workflow is `prisma db push`, and a field
// appearing there with no migration file is legitimate; prisma/migrations/ is
// kept for parity, not applied by the dev loop. A check on it fires on every
// normal change, and a check that fires on every normal change is muted.
//
// prisma/schema.postgres.prisma is different in kind: it is what production is
// SUPPOSED to match (generated from the canonical schema by
// scripts/gen-postgres-schema.mjs, ADR-004), and supabase/migrations/ is the
// only thing that ever changes production. Those two are the pair whose
// disagreement IS the defect, so those two are the pair this file compares.
//
// ## What it deliberately does not do
//
// It does not check types, nullability, defaults, indexes or constraints. A
// column that exists with the wrong type is a different, rarer failure, and a
// checker that tries to understand DDL well enough to catch it would be wrong
// often enough to be muted for the same reason as above. Presence is the
// failure that happened; presence is mechanically decidable; presence is what
// this file decides.

/**
 * Prisma scalar types — a field of one of these (or of an enum the schema
 * declares) is a column; a field whose type is another model is a relation
 * and has no column of its own. `Unsupported("...")` is a column too.
 */
const PRISMA_SCALARS = new Set([
  'String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal', 'DateTime', 'Json', 'Bytes',
])

/**
 * Strip SQL comments so prose cannot satisfy or fail the check.
 *
 * Walks the text once, tracking the three things that can hide a comment
 * marker or hide a statement: single-quoted string literals (`''` escapes),
 * double-quoted identifiers, and dollar-quoted bodies (`$$ ... $$`,
 * `$tag$ ... $tag$`). Comments — `--` to end of line, and nestable block
 * comments — are replaced by a single space so token boundaries survive.
 * String literal CONTENT is blanked to `''`: a migration that says
 * `execute 'alter table x add column y'` is not read as creating `y`, because a
 * string is data to this parser exactly as a plan is data to the runtime, and
 * a migration that means to create a column can say so in plain DDL.
 * Dollar-quoted bodies are kept (with their own comments stripped) because
 * `DO $ ... $` blocks are how this repository writes conditional DDL, and the
 * statements inside them are real.
 */
export function stripSqlComments(sql) {
  const text = String(sql ?? '')
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    const next = text[i + 1]
    if (ch === '-' && next === '-') {
      while (i < n && text[i] !== '\n') i++
      out += ' '
      continue
    }
    if (ch === '/' && next === '*') {
      let depth = 1
      i += 2
      while (i < n && depth > 0) {
        if (text[i] === '/' && text[i + 1] === '*') { depth++; i += 2; continue }
        if (text[i] === '*' && text[i + 1] === '/') { depth--; i += 2; continue }
        i++
      }
      out += ' '
      continue
    }
    if (ch === "'") {
      i++
      while (i < n) {
        if (text[i] === "'" && text[i + 1] === "'") { i += 2; continue }
        if (text[i] === "'") { i++; break }
        i++
      }
      out += "''"
      continue
    }
    if (ch === '"') {
      let j = i + 1
      while (j < n && text[j] !== '"') j++
      out += text.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (ch === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i))
      if (m) {
        // Dollar quote: emit the delimiter, then continue scanning the body as
        // SQL (comments inside it are comments). The closing delimiter is
        // matched by the same branch when the scan reaches it.
        out += m[0]
        i += m[0].length
        continue
      }
    }
    out += ch
    i++
  }
  return out
}

/**
 * One SQL identifier, as Postgres would resolve it: quoted keeps its case,
 * unquoted folds to lower case, and a schema qualifier is dropped because the
 * question is about the table. `public."Tenant"` → `Tenant`; `zuri_core.Tenant`
 * → `tenant`, which is NOT the Prisma model `Tenant` — and that difference is
 * real, since Prisma quotes every identifier it emits.
 */
export function normalizeIdentifier(raw) {
  const parts = []
  const re = /"([^"]*)"|([A-Za-z_][A-Za-z0-9_$]*)/g
  let m
  while ((m = re.exec(String(raw ?? '')))) parts.push(m[1] !== undefined ? m[1] : m[2].toLowerCase())
  return parts.length ? parts[parts.length - 1] : ''
}

const IDENT = '(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)'
const QUALIFIED = `${IDENT}(?:\\s*\\.\\s*${IDENT})*`

/**
 * The columns each model declares in a Prisma schema — the production shape,
 * when the schema is prisma/schema.postgres.prisma.
 *
 * Returns Map<tableName, string[]>. A field is a column when its type is a
 * Prisma scalar or an enum the same schema declares; a field typed as another
 * model is a relation and is skipped, as is anything marked `@ignore`.
 * `@map`/`@@map` are honoured so a renamed column or table is compared under
 * the name the database sees (this repository uses neither today).
 */
export function parsePrismaColumns(schemaText) {
  const text = String(schemaText ?? '').replace(/\r\n/g, '\n')
  const enums = new Set()
  for (const m of text.matchAll(/^\s*enum\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/gm)) enums.add(m[1])

  const models = new Map()
  const modelRe = /^\s*model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)^\s*\}/gm
  for (const m of text.matchAll(modelRe)) {
    const modelName = m[1]
    const body = m[2]
    let tableName = modelName
    const columns = []
    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/\/\/.*$/, '').trim()
      if (!line) continue
      if (line.startsWith('@@')) {
        const mapped = /^@@map\(\s*"([^"]+)"\s*\)/.exec(line)
        if (mapped) tableName = mapped[1]
        continue
      }
      const field = /^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*(?:\([^)]*\))?)(\[\])?(\?)?(.*)$/.exec(line)
      if (!field) continue
      const [, name, typeToken, , , rest] = field
      const baseType = typeToken.replace(/\(.*$/, '')
      const isColumn = PRISMA_SCALARS.has(baseType) || baseType === 'Unsupported' || enums.has(baseType)
      if (!isColumn) continue
      if (/@ignore\b/.test(rest)) continue
      const mapped = /@map\(\s*"([^"]+)"\s*\)/.exec(rest)
      columns.push(mapped ? mapped[1] : name)
    }
    models.set(tableName, columns)
  }
  return models
}

/**
 * Split a CREATE TABLE body on its top-level commas — a column type like
 * `NUMERIC(10, 2)` or a `CHECK (a IN ('x','y'))` carries commas of its own.
 */
function splitTopLevel(body) {
  const items = []
  let depth = 0
  let cur = ''
  for (const ch of body) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { items.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) items.push(cur)
  return items.map((s) => s.trim()).filter(Boolean)
}

const TABLE_CONSTRAINT_HEAD = /^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|EXCLUDE|LIKE)\b/i
const ADD_ACTION_KEYWORDS = new Set(['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', 'EXCLUDE'])

/**
 * Split comment-stripped SQL into statements on `;` outside parentheses and
 * outside dollar-quoted bodies. A `DO $$ ... $$` block therefore arrives as ONE
 * statement, and the DDL it contains is found by the same regexes below, which
 * are applied with the global flag across the whole statement rather than
 * anchored to its start.
 */
function splitStatements(sql) {
  const out = []
  let cur = ''
  let depth = 0
  let dollar = null
  let i = 0
  const n = sql.length
  while (i < n) {
    if (dollar) {
      if (sql.startsWith(dollar, i)) { cur += dollar; i += dollar.length; dollar = null; continue }
      cur += sql[i++]
      continue
    }
    const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64))
    if (m) { dollar = m[0]; cur += m[0]; i += m[0].length; continue }
    const ch = sql[i++]
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ';' && depth <= 0) { out.push(cur); cur = ''; depth = 0; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

/**
 * Every column a set of migrations creates, applied in the order given.
 *
 * Returns Map<tableName, Set<columnName>>. Understands:
 *   CREATE TABLE [IF NOT EXISTS] [schema.]name ( column defs, table constraints )
 *   ALTER TABLE [IF EXISTS] [ONLY] name ADD [COLUMN] [IF NOT EXISTS] col ..., ADD ...
 *   ALTER TABLE name RENAME [COLUMN] a TO b · RENAME TO newname
 *   ALTER TABLE name DROP [COLUMN] [IF EXISTS] col · DROP TABLE [IF EXISTS] name
 * inside or outside DO blocks, with quoted or unquoted identifiers. Text
 * inside comments and string literals is never read (`stripSqlComments`).
 */
export function parseMigrationColumns(migrations) {
  const tables = new Map()
  const ensure = (t) => { if (!tables.has(t)) tables.set(t, new Set()); return tables.get(t) }

  for (const migration of migrations) {
    const sql = stripSqlComments(migration.sql)
    for (const statement of splitStatements(sql)) {
      // CREATE TABLE ... ( ... ) — possibly several per statement inside a DO block.
      const createRe = new RegExp(`\\bCREATE\\s+(?:UNLOGGED\\s+|TEMP(?:ORARY)?\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QUALIFIED})\\s*\\(`, 'gi')
      let m
      while ((m = createRe.exec(statement))) {
        const table = normalizeIdentifier(m[1])
        const start = m.index + m[0].length
        let depth = 1
        let j = start
        while (j < statement.length && depth > 0) {
          if (statement[j] === '(') depth++
          if (statement[j] === ')') depth--
          j++
        }
        const body = statement.slice(start, j - 1)
        const cols = ensure(table)
        for (const item of splitTopLevel(body)) {
          if (TABLE_CONSTRAINT_HEAD.test(item)) continue
          const first = new RegExp(`^(${IDENT})`).exec(item)
          if (first) cols.add(normalizeIdentifier(first[1]))
        }
      }

      // ALTER TABLE name <actions> — actions are comma-separated and may mix.
      const alterRe = new RegExp(`\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(${QUALIFIED})([\\s\\S]*?)(?=\\bALTER\\s+TABLE\\b|\\bCREATE\\s+(?:UNLOGGED\\s+|TEMP(?:ORARY)?\\s+)?TABLE\\b|\\bDROP\\s+TABLE\\b|$)`, 'gi')
      while ((m = alterRe.exec(statement))) {
        const table = normalizeIdentifier(m[1])
        const actions = m[2]
        const renameTable = new RegExp(`\\bRENAME\\s+TO\\s+(${IDENT})`, 'i').exec(actions)
        if (renameTable && !/\bRENAME\s+COLUMN\b/i.test(actions)) {
          const to = normalizeIdentifier(renameTable[1])
          if (tables.has(table)) { tables.set(to, tables.get(table)); tables.delete(table) }
          continue
        }
        const addRe = new RegExp(`\\bADD\\s+(?:COLUMN\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENT})`, 'gi')
        let a
        while ((a = addRe.exec(actions))) {
          const ident = a[1]
          if (!ident.startsWith('"') && ADD_ACTION_KEYWORDS.has(ident.toUpperCase())) continue
          ensure(table).add(normalizeIdentifier(ident))
        }
        const renameColRe = new RegExp(`\\bRENAME\\s+(?:COLUMN\\s+)?(${IDENT})\\s+TO\\s+(${IDENT})`, 'gi')
        while ((a = renameColRe.exec(actions))) {
          const cols = ensure(table)
          cols.delete(normalizeIdentifier(a[1]))
          cols.add(normalizeIdentifier(a[2]))
        }
        const dropColRe = new RegExp(`\\bDROP\\s+(?:COLUMN\\s+)?(?:IF\\s+EXISTS\\s+)?(${IDENT})`, 'gi')
        while ((a = dropColRe.exec(actions))) {
          const ident = a[1]
          if (!ident.startsWith('"') && ['CONSTRAINT', 'DEFAULT', 'NOT'].includes(ident.toUpperCase())) continue
          ensure(table).delete(normalizeIdentifier(ident))
        }
      }

      const dropTableRe = new RegExp(`\\bDROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(${QUALIFIED})`, 'gi')
      while ((m = dropTableRe.exec(statement))) tables.delete(normalizeIdentifier(m[1]))
    }
  }
  return tables
}

/**
 * The drift between what the production schema declares and what the
 * migrations create.
 *
 * @param {object} input
 * @param {string} input.schemaText           prisma/schema.postgres.prisma
 * @param {{name:string, sql:string}[]} input.migrations  supabase/migrations/*.sql, in apply order
 * @param {string[]} [input.baseline]         "Table.column" keys accepted as known debt
 * @returns {{ missing: {table:string, column:string, key:string}[],
 *             missingTables: string[],
 *             introduced: {table:string, column:string, key:string}[],
 *             repaid: string[],
 *             accepted: string[],
 *             checked: { models: number, columns: number, migrations: number } }}
 *
 * `missing` is every declared column no migration creates. `introduced` is the
 * subset the baseline does not cover — the CRITICAL. `repaid` is every baseline
 * key that is no longer missing — the ratchet's signal to shrink the file.
 */
export function evaluateSchemaMigrationDrift({ schemaText, migrations, baseline = [] }) {
  const declared = parsePrismaColumns(schemaText)
  const created = parseMigrationColumns(migrations)
  const known = new Set(baseline)

  const missing = []
  const missingTables = []
  let columnCount = 0
  for (const [table, columns] of declared) {
    const have = created.get(table)
    if (!have) missingTables.push(table)
    for (const column of columns) {
      columnCount++
      if (!have || !have.has(column)) missing.push({ table, column, key: `${table}.${column}` })
    }
  }
  const missingKeys = new Set(missing.map((m) => m.key))
  const introduced = missing.filter((m) => !known.has(m.key))
  const repaid = baseline.filter((k) => !missingKeys.has(k))
  const accepted = baseline.filter((k) => missingKeys.has(k))
  return {
    missing,
    missingTables,
    introduced,
    repaid,
    accepted,
    checked: { models: declared.size, columns: columnCount, migrations: migrations.length },
  }
}
