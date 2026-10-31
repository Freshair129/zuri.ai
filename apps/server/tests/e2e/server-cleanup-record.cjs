const { createHostCleanupRecord } = require('./server-timings.cjs')

const pid = Number(process.argv[2])
const outcome = process.argv[3]
process.stdout.write(JSON.stringify(createHostCleanupRecord({ pid, outcome })))
