#!/usr/bin/env node
// Starts and stops the disposable test PostgreSQL once, printing its version:
// a quick check that the embedded binaries run on this machine.
import pg from 'pg'
import { startTestPostgres } from '../test/support/pg-server.js'

const t0 = Date.now()
const server = await startTestPostgres({ label: 'smoke' })
try {
  const client = new pg.Client({ connectionString: server.adminUrl })
  await client.connect()
  const { rows } = await client.query('SELECT version() AS v')
  await client.end()
  process.stdout.write(`${JSON.stringify({ ok: true, startMs: Date.now() - t0, version: rows[0].v })}\n`)
} finally {
  await server.stop()
}
