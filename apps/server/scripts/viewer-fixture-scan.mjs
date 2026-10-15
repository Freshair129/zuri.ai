// @tested tools/tests/viewer-fixture-scan.test.mjs

const IDENTIFIER = String.raw`[A-Za-z_$][A-Za-z0-9_$]*`
const SIMPLE_FIELD = `${IDENTIFIER}(?:\\s*\\.\\s*${IDENTIFIER})*`
const STRING_LITERAL = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')`
const STATIC_VALUE = `(?:${STRING_LITERAL}|-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?|true|false|null)`
const STATIC_PROPERTY = `(?:${IDENTIFIER}|${STRING_LITERAL})\\s*:\\s*${STATIC_VALUE}`
const STATIC_FLAT_OBJECT = new RegExp(`^\\s*(?:${STATIC_PROPERTY}\\s*(?:,\\s*${STATIC_PROPERTY}\\s*)*,?)?\\s*$`)
const EXPECTED_OBJECT = new RegExp(
  `^(\\s*expect\\(\\s*${SIMPLE_FIELD}\\s*\\)\\s*\\.\\s*to(?:MatchObject|Equal|StrictEqual)\\s*\\(\\s*\\{)([^{}\\r\\n]*)(\\}\\s*\\)\\s*;?\\s*\\r?)$`
)

/**
 * Hide only a direct, single-line static expected object in expect(field).matcher(...).
 * Replacing its contents with spaces preserves offsets and line count for the
 * repository's existing proximity-based viewer-fixture heuristic.
 */
export function maskExpectedViewerAssertions(source) {
  if (typeof source !== 'string') throw new TypeError('Expected source text')

  return source.split('\n').map((line) => {
    const match = EXPECTED_OBJECT.exec(line)
    if (!match || !STATIC_FLAT_OBJECT.test(match[2])) return line
    return `${match[1]}${' '.repeat(match[2].length)}${match[3]}`
  }).join('\n')
}
