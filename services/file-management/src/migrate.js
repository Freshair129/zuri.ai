// @spec ADR-107 - explicit service-owned schema migration entrypoint.
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Client } from 'pg'

const root = dirname(fileURLToPath(import.meta.url))

export async function migrateFileManagement(env = process.env) {
  if (!env.FILE_MIGRATION_DATABASE_URL) throw new Error('FILE_MIGRATION_DATABASE_URL is required')
  const client = new Client({ connectionString: env.FILE_MIGRATION_DATABASE_URL, application_name: 'zuri-file-management-migrate' })
  await client.connect()
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('zuri-file-management-schema'))")
    await client.query('CREATE SCHEMA IF NOT EXISTS zuri_files')
    await client.query(`CREATE TABLE IF NOT EXISTS zuri_files.schema_migration (
      name text PRIMARY KEY, sha256 char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`)
    const names = (await readdir(join(root, '..', 'migrations'))).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/.test(name)).sort()
    for (const name of names) {
      const sql = await readFile(join(root, '..', 'migrations', name), 'utf8')
      const sha256 = createHash('sha256').update(sql).digest('hex')
      const existing = await client.query('SELECT sha256 FROM zuri_files.schema_migration WHERE name=$1', [name])
      if (existing.rows[0]) {
        if (existing.rows[0].sha256 !== sha256) throw new Error(`applied migration changed: ${name}`)
        continue
      }
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO zuri_files.schema_migration (name,sha256) VALUES ($1,$2)', [name, sha256])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
    return names
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtext('zuri-file-management-schema'))") } catch {}
    await client.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrateFileManagement().then((names) => process.stdout.write(`Applied or verified ${names.length} file-management migration(s)\n`)).catch(() => {
    process.stderr.write('File Management migrations failed; inspect the database migration state without printing connection settings.\n')
    process.exitCode = 1
  })
}
