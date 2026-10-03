import { readFileSync } from 'node:fs'
import base from './vitest.config'

// The pull-request "related" run (scripts/ci-change-scope.mjs --related): the
// default config with `include` narrowed to the list CI computed from the diff.
// The list arrives in a file named by ZURI_RELATED_TESTS_FILE, not on the
// command line: `npm test` runs through cmd.exe on Windows, whose 8191-character
// limit a list of a hundred-odd paths would exceed.
//
// A missing or empty list is an error, never "run nothing" or "run everything"
// silently: governance.yml only selects this config when `changes` emitted
// test_mode=related with a non-empty list.
// @spec docs/SYSTEM-DIAGRAM.md
// @tested tests/unit/ci-change-scope.test.js
const listFile = process.env.ZURI_RELATED_TESTS_FILE
if (!listFile) throw new Error('vitest.related.config.js: ZURI_RELATED_TESTS_FILE is not set')
const include = readFileSync(listFile, 'utf8').split(/\s+/).filter(Boolean)
if (include.length === 0) throw new Error(`vitest.related.config.js: ${listFile} lists no test files`)
for (const file of include) {
  if (!/^tests\/(unit|integration)\/.+\.test\.js$/.test(file)) throw new Error(`vitest.related.config.js: not a suite test file: ${file}`)
}

export default {
  ...base,
  test: {
    ...base.test,
    include,
  },
}
