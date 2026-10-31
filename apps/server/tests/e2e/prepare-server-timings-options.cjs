const { appendServerTimingsPreload } = require('./server-timings.cjs')

// Used by the workflow's external server launch. This shares the same
// idempotent NODE_OPTIONS composition as Playwright's fallback webServer.
process.stdout.write(appendServerTimingsPreload(process.env.NODE_OPTIONS))
