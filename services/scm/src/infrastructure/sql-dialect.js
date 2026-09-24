// One SQL text for both engines. Adapters write portable SQL in the SQLite
// spelling the service started with; this module turns it into PostgreSQL:
//   • identifiers that mix cases (Product, tenantId, InventoryLedgerFence) are
//     double-quoted, because PostgreSQL folds unquoted names to lower case and
//     the column names are the Prisma field names (camelCase) on both engines;
//     ALL-CAPS words are keywords/functions and all-lower-case names fold to
//     themselves, so both are left alone;
//   • `?` placeholders become `$1…$n`;
//   • `rowid` (insertion order, used by tests only — src/ never orders by it)
//     becomes `ctid`, which is insertion order on the append-only tables it is
//     used with.
// String literals ('…', with '' escapes) and `--` comments are copied verbatim.
// The translation is cached per SQL text (adapters build a small, fixed set).

const cache = new Map()
const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y
const mixedCase = (word) => /[a-z]/.test(word) && /[A-Z]/.test(word)

export function toPostgres(text) {
  const hit = cache.get(text)
  if (hit) return hit
  let out = ''
  let n = 0
  for (let i = 0; i < text.length;) {
    const c = text[i]
    if (c === '-' && text[i + 1] === '-') {
      const end = text.indexOf('\n', i)
      const stop = end < 0 ? text.length : end
      out += text.slice(i, stop)
      i = stop
    } else if (c === "'") {
      let j = i + 1
      while (j < text.length) {
        if (text[j] === "'" && text[j + 1] === "'") j += 2
        else if (text[j] === "'") break
        else j += 1
      }
      out += text.slice(i, j + 1)
      i = j + 1
    } else if (c === '"') {
      const j = text.indexOf('"', i + 1)
      out += text.slice(i, j + 1)
      i = j + 1
    } else if (c === '?') {
      n += 1
      out += `$${n}`
      i += 1
    } else if (/[A-Za-z_]/.test(c) && !/[A-Za-z0-9_$]/.test(text[i - 1] ?? ' ')) {
      IDENT.lastIndex = i
      const word = IDENT.exec(text)[0]
      out += word === 'rowid' ? 'ctid' : mixedCase(word) ? `"${word}"` : word
      i += word.length
    } else {
      out += c
      i += 1
    }
  }
  const translated = { text: out, params: n }
  if (cache.size < 2000) cache.set(text, translated)
  return translated
}
