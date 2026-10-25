// @req FR-051, SEC-001, SEC-018 — bind the production operator to its direct
//   Supabase endpoint and authenticated PostgreSQL identity.
// @spec ADR-104 D3/D5
// @tested tests/unit/production-migration-reconciliation.test.js

export const PRODUCTION_PROJECT_REF = 'qcnmhyglarzcpudjorzc'

export function resolveDirectTarget(connectionString, projectRef = PRODUCTION_PROJECT_REF) {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    throw new Error('refuse: DIRECT_URL is required')
  }

  let url
  try {
    url = new URL(connectionString)
  } catch {
    throw new Error('refuse: DIRECT_URL must be a valid PostgreSQL URL')
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('refuse: DIRECT_URL must use PostgreSQL')
  }
  if (url.hostname !== `db.${projectRef}.supabase.co`) {
    throw new Error('refuse: database endpoint does not match the approved direct Supabase project endpoint')
  }
  if (url.port && url.port !== '5432') {
    throw new Error('refuse: only the direct PostgreSQL port 5432 is accepted')
  }
  if (decodeURIComponent(url.username) !== 'postgres') {
    throw new Error('refuse: DIRECT_URL must authenticate as the postgres database role')
  }
  if (!url.password) throw new Error('refuse: DIRECT_URL must provide its database password explicitly')

  const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres'
  if (database !== 'postgres') {
    throw new Error('refuse: the approved Supabase database must be postgres')
  }

  return {
    projectRef,
    host: url.hostname,
    port: Number(url.port || 5432),
    database,
  }
}

export function createDirectClientConfig(connectionString, projectRef = PRODUCTION_PROJECT_REF) {
  const target = resolveDirectTarget(connectionString, projectRef)
  return {
    host: target.host,
    port: target.port,
    database: target.database,
    user: 'postgres',
    password: decodeURIComponent(new URL(connectionString).password),
    ssl: {
      rejectUnauthorized: true,
      servername: target.host,
    },
    connectionTimeoutMillis: 10_000,
  }
}

export function assertDatabaseIdentity(identity, target) {
  if (identity.user !== 'postgres') {
    throw new Error('refuse: migration connection must be postgres')
  }
  if (identity.schema !== 'public') {
    throw new Error('refuse: migration connection must use the public schema')
  }
  if (identity.database !== target.database) {
    throw new Error('refuse: connected database does not match the approved target')
  }

  return {
    ...target,
    user: identity.user,
    schema: identity.schema,
    serverVersionMajor: String(identity.server_version).split('.')[0],
  }
}
