import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { assertDatabaseIdentity } from './production-migration-target.mjs'

// @req FR-051, SEC-001, SEC-018 — bind independently hashed preflight and
//   logical-backup evidence to one target, schema, ledger and Dependency state.
// @spec ADR-018 D7/D8, ADR-104 D3/D5
// @tested tests/unit/production-migration-evidence.test.js

const DEPENDENCY_BATCH_SIZE = 250

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function assertOutsideRepository(filePath, repositoryRoot) {
  const resolvedPath = path.resolve(filePath)
  const resolvedRoot = fs.realpathSync(repositoryRoot)
  const isWithinRoot = (candidate) => {
    const relative = path.relative(resolvedRoot, candidate)
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  }
  if (isWithinRoot(resolvedPath)) throw new Error('refuse: evidence files must be outside the repository')

  let physicalPath
  if (fs.existsSync(resolvedPath)) {
    physicalPath = fs.realpathSync(resolvedPath)
  } else {
    let existingAncestor = path.dirname(resolvedPath)
    while (!fs.existsSync(existingAncestor)) {
      const parent = path.dirname(existingAncestor)
      if (parent === existingAncestor) break
      existingAncestor = parent
    }
    const realAncestor = fs.realpathSync(existingAncestor)
    const suffix = path.relative(existingAncestor, resolvedPath)
    physicalPath = path.resolve(realAncestor, suffix)
  }
  if (isWithinRoot(physicalPath)) throw new Error('refuse: evidence path resolves inside the repository')
  return resolvedPath
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

export function buildHashedArtifact(payload) {
  return {
    ...payload,
    artifactSha256: sha256(canonicalJson(payload)),
  }
}

export function readHashedArtifact(filePath, expectedFileSha256, expectedMode) {
  if (!/^[a-f0-9]{64}$/.test(expectedFileSha256 ?? '')) {
    throw new Error(`artifact file hash is required for ${path.basename(filePath)}`)
  }
  const bytes = fs.readFileSync(filePath)
  if (sha256(bytes) !== expectedFileSha256) {
    throw new Error(`artifact file hash mismatch for ${path.basename(filePath)}`)
  }

  let artifact
  try {
    artifact = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error(`artifact JSON is invalid for ${path.basename(filePath)}`)
  }
  if (artifact.mode !== expectedMode) throw new Error(`artifact mode must be ${expectedMode}`)

  const { artifactSha256, ...payload } = artifact
  if (!/^[a-f0-9]{64}$/.test(artifactSha256 ?? '') || sha256(canonicalJson(payload)) !== artifactSha256) {
    throw new Error(`artifact embedded content hash mismatch for ${path.basename(filePath)}`)
  }
  return artifact
}

export function assertMatchingArtifacts(preflight, snapshot, expectedTarget) {
  if (canonicalJson(preflight.target) !== canonicalJson(expectedTarget)
      || canonicalJson(snapshot.target) !== canonicalJson(expectedTarget)) {
    throw new Error('refuse: evidence artifact target does not match the verified database target')
  }
  if (!preflight.baselineId || preflight.baselineId !== snapshot.baselineId
      || canonicalJson(preflight.baseline) !== canonicalJson(snapshot.baseline)) {
    throw new Error('refuse: preflight and snapshot baseline evidence does not match')
  }
}

async function readIdentity(client) {
  const result = await client.query(`
    select current_user as "user",
           current_database() as database,
           current_schema() as schema,
           current_setting('server_version') as server_version
  `)
  return result.rows[0]
}

async function readDependencyRows(client, onDependencyRow) {
  const digest = crypto.createHash('sha256')
  const fullDigest = crypto.createHash('sha256')
  let rowCount = 0
  let lastId = null

  while (true) {
    const result = await client.query(`
      select d.id,
             (to_jsonb(d) - 'contractJson')::text as row_json,
             to_jsonb(d)::text as backup_row_json
      from public."Dependency" d
      where ($1::text is null or d.id > $1)
      order by d.id
      limit $2
    `, [lastId, DEPENDENCY_BATCH_SIZE])
    if (result.rows.length === 0) break

    for (const row of result.rows) {
      const line = `${row.row_json}\n`
      digest.update(line, 'utf8')
      const backupLine = `${row.backup_row_json}\n`
      fullDigest.update(backupLine, 'utf8')
      if (onDependencyRow) await onDependencyRow(row.backup_row_json)
      lastId = row.id
      rowCount += 1
    }
  }

  return {
    rowCount,
    rowsSha256: digest.digest('hex'),
    fullRowsSha256: fullDigest.digest('hex'),
  }
}

async function readDependencyCatalog(client) {
  const columns = (await client.query(`
    select column_name, data_type, is_nullable, column_default, udt_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'Dependency'
    order by ordinal_position
  `)).rows
  if (columns.length === 0) throw new Error('refuse: public.Dependency is missing from the target catalog')

  const relation = (await client.query(`
    select c.relrowsecurity as rls,
           c.relforcerowsecurity as forced,
           coalesce(c.relacl::text, '') as acl
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relname = 'Dependency' and c.relkind in ('r', 'p')
  `)).rows
  if (relation.length !== 1) throw new Error('refuse: public.Dependency relation identity is ambiguous')

  const policies = (await client.query(`
    select policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public' and tablename = 'Dependency'
    order by policyname
  `)).rows
  const grants = (await client.query(`
    select grantee, privilege_type, is_grantable
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'Dependency'
    order by grantee, privilege_type, is_grantable
  `)).rows

  return {
    columns,
    security: {
      rls: relation[0].rls,
      forced: relation[0].forced,
      acl: relation[0].acl,
      policies,
      grants,
    },
  }
}

export async function captureDatabaseBaseline(client, target, { onDependencyRow } = {}) {
  const identity = assertDatabaseIdentity(await readIdentity(client), target)
  const migrationHistory = (await client.query(`
    select version, name
    from supabase_migrations.schema_migrations
    order by version, name
  `)).rows
  const dependency = await readDependencyCatalog(client)
  const dependencyRows = await readDependencyRows(client, onDependencyRow)
  const ledger = {
    rowCount: migrationHistory.length,
    sha256: sha256(canonicalJson(migrationHistory)),
  }
  const dependencyBaseline = {
    ...dependency,
    rowCount: dependencyRows.rowCount,
    rowsSha256: dependencyRows.rowsSha256,
    fullRowsSha256: dependencyRows.fullRowsSha256,
  }
  const baseline = {
    target: identity,
    migrationLedger: ledger,
    dependency: dependencyBaseline,
  }
  const baselineId = sha256(canonicalJson(baseline))

  const timing = {
    dependencyTotalBytes: Number((await client.query(`
      select pg_total_relation_size('public."Dependency"'::regclass) as bytes
    `)).rows[0].bytes),
    activeLocks: (await client.query(`
      select mode, granted, count(*)::int as count
      from pg_locks
      where relation = 'public."Dependency"'::regclass
      group by mode, granted
      order by mode, granted
    `)).rows,
    activeTransactions: (await client.query(`
      select count(*)::int as count,
             coalesce(max(extract(epoch from clock_timestamp() - xact_start)), 0)::int as oldestAgeSeconds,
             count(*) filter (where wait_event_type = 'Lock')::int as waitingOnLocks
      from pg_stat_activity
      where datname = current_database()
        and pid <> pg_backend_pid()
        and xact_start is not null
        and state <> 'idle'
    `)).rows[0],
  }

  return { identity, migrationHistory, baseline, baselineId, timing }
}

export async function verifyDependencyBackup(snapshot, snapshotPath, repositoryRoot = null) {
  const evidence = snapshot.dependencyBackup
  if (!evidence || !/^[a-f0-9]{64}$/.test(evidence.sha256 ?? '') || !Number.isInteger(evidence.rowCount)) {
    throw new Error('refuse: Dependency backup evidence is incomplete')
  }
  if (typeof evidence.file !== 'string' || path.basename(evidence.file) !== evidence.file) {
    throw new Error('refuse: Dependency backup path must be a sibling file name')
  }
  const baselineDependency = snapshot.baseline?.dependency
  if (!baselineDependency
      || baselineDependency.rowCount !== evidence.rowCount
      || baselineDependency.fullRowsSha256 !== evidence.sha256) {
    throw new Error('refuse: Dependency backup does not match the complete-row snapshot baseline')
  }

  const candidatePath = path.join(path.dirname(path.resolve(snapshotPath)), evidence.file)
  const backupPath = repositoryRoot
    ? assertOutsideRepository(candidatePath, repositoryRoot)
    : candidatePath
  const digest = crypto.createHash('sha256')
  let rowCount = 0
  let lastByte = null
  for await (const chunk of fs.createReadStream(backupPath)) {
    digest.update(chunk)
    for (const byte of chunk) if (byte === 0x0a) rowCount += 1
    if (chunk.length > 0) lastByte = chunk[chunk.length - 1]
  }
  if (digest.digest('hex') !== evidence.sha256) throw new Error('refuse: Dependency backup file hash mismatch')
  if (rowCount !== evidence.rowCount || (rowCount > 0 && lastByte !== 0x0a)) {
    throw new Error('refuse: Dependency backup row count or newline framing mismatch')
  }
  return backupPath
}
