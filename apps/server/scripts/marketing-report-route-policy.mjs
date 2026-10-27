// @spec SDD-112, ADR-115 — pin the executable shape of the existing machine-principal route.
// @tested tests/node/compact-workflow.test.mjs
// This narrow compatibility check is not runtime authorization proof. Any route
// behavior change requires review of this pin; never learn it from disk at runtime.
import { createHash } from 'node:crypto'
import { transformSync, version } from 'esbuild'

// Reviewed current route: trusted imports, POST bearer/body precheck, zero-arg
// provider resolver, exact receiver arguments, receipt/error handling. Parsing
// removes comments but retains executable/dead declarations and string literals;
// matching tokens in a comment, unused function or string cannot substitute.
const EXECUTABLE_SHA256 = '5ddcd953eaa8939282078d591fc18721b4af133be8d2b504e7084baa909c497a'
export function isMarketingReportMachineReceiver(file, body) {
  if (file !== 'src/app/api/growth/external-marketing-reports/route.js' || typeof body !== 'string' || body.length > 65536 || version !== '0.21.5') return false
  try {
    const { code } = transformSync(body, { loader: 'js', target: 'es2022', format: 'esm', legalComments: 'none', charset: 'ascii', minify: false, treeShaking: false, logLevel: 'silent' })
    return createHash('sha256').update(code).digest('hex') === EXECUTABLE_SHA256
  } catch { return false }
}
