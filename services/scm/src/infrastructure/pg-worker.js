import { workerData } from 'node:worker_threads'
import pg from 'pg'

// The one PostgreSQL connection of a synchronous SCM connection (see
// pg-connection.js). It runs one statement at a time as the caller asks, puts
// the result on the reply port, then wakes the blocked caller through the shared
// flag. Nothing here decides anything: it is the wire.

const { url, flag, requests, replies, connectTimeoutMs } = workerData

// Counts and sums come back as int8 text; every one the service reads fits a
// double exactly (row counts, satang and quantity sums), so parse them as numbers.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)))

const wake = () => { Atomics.store(flag, 0, 1); Atomics.notify(flag, 0) }
const reply = (message) => { replies.postMessage(message); wake() }
const errorOf = (e) => ({ message: e.message, code: e.code ?? null, constraint: e.constraint ?? null, detail: e.detail ?? null })

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: connectTimeoutMs, application_name: 'zuri-scm' })
client.on('error', () => {}) // a lost connection surfaces on the next query as an error reply

try {
  await client.connect()
  reply({ ready: true })
} catch (error) {
  reply({ error: errorOf(error) })
}

requests.on('message', async ({ text, params }) => {
  try {
    const result = await client.query(params ? { text, values: params } : text)
    const last = Array.isArray(result) ? result.at(-1) : result
    reply({ rows: last?.rows ?? [], rowCount: last?.rowCount ?? 0 })
  } catch (error) {
    reply({ error: errorOf(error) })
  }
})
requests.on('close', () => { client.end().catch(() => {}) })
