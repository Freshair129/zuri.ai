// Local provider conformance comparison (delegated Q11): response parity + where the rows and audit events actually landed.
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { isDeepStrictEqual } from 'node:util'

const dir = process.argv[2]
const legacy = JSON.parse(readFileSync(`${dir}/legacy.json`, 'utf8'))
const service = JSON.parse(readFileSync(`${dir}/service.json`, 'utf8'))

let mismatches = 0
for (const [i, step] of legacy.entries()) {
  const other = service[i]
  const same = step.name === other.name && step.status === other.status && isDeepStrictEqual(step.body, other.body)
  if (!same) {
    mismatches += 1
    console.log(`MISMATCH ${step.name}\n  legacy : ${step.status} ${JSON.stringify(step.body).slice(0, 400)}\n  service: ${other.status} ${JSON.stringify(other.body).slice(0, 400)}`)
  } else {
    console.log(`same     ${step.name} (${step.status})`)
  }
}

const count = (file, sql) => new DatabaseSync(file, { readOnly: true }).prepare(sql).get()
const audit = `SELECT count(*) AS n, group_concat(payloadJson, ' || ') AS payloads FROM AuditEvent WHERE action = 'MARKET_TRANSLATION_RUN'`
console.log('legacy.db  MarketObservation rows:', count(`${dir}/legacy.db`, 'SELECT count(*) AS n FROM MarketObservation').n)
console.log('service.db MarketObservation rows:', count(`${dir}/service.db`, 'SELECT count(*) AS n FROM MarketObservation').n)
console.log('service-store.db rows            :', count(`${dir}/service-store.db`, 'SELECT count(*) AS n FROM "MarketObservation"').n)
console.log('legacy.db  audit:', JSON.stringify(count(`${dir}/legacy.db`, audit)))
console.log('service.db audit:', JSON.stringify(count(`${dir}/service.db`, audit)))
console.log(`RESULT: ${mismatches === 0 ? 'PARITY' : `${mismatches} MISMATCH(ES)`}`)
