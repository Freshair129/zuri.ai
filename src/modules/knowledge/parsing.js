// @req FR-115 — document parsing into a structured artifact that keeps its link to the raw source
// @spec SDD-063, docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md §7 — ParsedArtifact, parsed_from preserved
// @tested tests/unit/knowledge-parsing.test.js

/** Stamped on every artifact so a reparse can be told from the original (§7 requirements). */
export const EXTRACTOR_VERSION = 'ki-parse-1'

// A fence is closed by its OWN marker: the same character, at least as long.
// Matching any fence-looking line lets a tilde close a backtick block, which
// ends the block early and hands the rest of the code to the structure parser —
// the same failure as reading a fenced `#` as a heading, arriving from the
// other side.
const FENCE = /^\s*(`{3,}|~{3,})/
const ATX = /^(#{1,6})\s+(.*\S)\s*$/
const SETEXT = /^\s{0,3}(=+|-+)\s*$/
const TABLE_ROW = /^\s*\|.*\|\s*$/
const SEPARATOR_CELL = /^:?-{3,}:?$/

const cells = (line) =>
  line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())

/**
 * Turns a document's text into the structure Stage 7 consumes.
 *
 * The hard part is not finding structure, it is refusing to find structure that
 * is not there. A fenced code block is full of lines that look like markup — a
 * shell comment opens with the same character as a heading — and a parser that
 * reads them invents sections nobody wrote, which Stage 7 then chunks along.
 * Every rule below is guarded on that side first.
 *
 * `structure` IS Stage 7's `blocks` argument (SDD-063). That seam is held by a
 * test that feeds this output straight into `chunkDocument`, rather than by two
 * suites that each build the shape and agree by luck.
 */
export function parseDocument({ documentId, rawArtifactId, text }) {
  const lines = String(text ?? '')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')

  const structure = []
  const textBlocks = []
  const tables = []
  const warnings = []
  let fence = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const fenceMark = line.match(FENCE)
    if (fenceMark) {
      const marker = fenceMark[1]
      if (!fence) {
        fence = marker
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null
      }
      textBlocks.push({ text: line })
      continue
    }

    if (fence) {
      textBlocks.push({ text: line })
      continue
    }

    const heading = line.match(ATX)
    if (heading) {
      structure.push({ type: 'heading', level: heading[1].length, text: heading[2] })
      textBlocks.push({ text: line })
      continue
    }

    // A table is a header row plus a separator that AGREES with it. A separator
    // of the wrong width means the author's table is broken; reading it anyway
    // would silently drop or invent a column, so it is reported and left as prose.
    if (TABLE_ROW.test(line) && TABLE_ROW.test(lines[i + 1] ?? '')) {
      const header = cells(line)
      const separator = cells(lines[i + 1])
      if (separator.every((cell) => SEPARATOR_CELL.test(cell))) {
        if (separator.length !== header.length) {
          warnings.push(
            `table separator has ${separator.length} columns against a ${header.length}-column header; left as text`,
          )
        } else {
          const rows = []
          let j = i + 2
          for (; j < lines.length && TABLE_ROW.test(lines[j]); j++) rows.push(cells(lines[j]))
          tables.push({ header, rows })
          // Also as text, because Stage 7 chunks `structure` alone. A table that
          // only exists in `tables` is a table nobody can retrieve — and in a Thai
          // business document the tables are most of what anyone wants to find.
          structure.push({ type: 'text', text: [header, ...rows].map((r) => r.join(' ')).join(' ') })
          for (let k = i; k < j; k++) textBlocks.push({ text: lines[k] })
          i = j - 1
          continue
        }
      }
    }

    // Setext headings are only recognisable in arrears — the heading is the line
    // ABOVE its underline. It must be the line above, read from the SOURCE, not
    // the last node that happened to reach `structure`: table rows and fenced
    // code never get there, so reading the structure tail let a run of dashes
    // reach back over a whole consumed table and promote a paragraph five rows
    // up. The guards then could not see what they were guarding against.
    const underline = line.match(SETEXT)
    const above = lines[i - 1]
    const promotable =
      underline &&
      above !== undefined &&
      above.trim() &&
      !above.includes('|') &&
      !ATX.test(above) &&
      !FENCE.test(above) &&
      !SETEXT.test(above)
    if (promotable) {
      const last = structure[structure.length - 1]
      if (last && last.type === 'text' && last.text === above) {
        structure[structure.length - 1] = {
          type: 'heading',
          level: underline[1].startsWith('=') ? 1 : 2,
          text: above.trim(),
        }
        textBlocks.push({ text: line })
        continue
      }
    }

    textBlocks.push({ text: line })
    if (line.trim()) structure.push({ type: 'text', text: line })
  }

  if (fence) {
    warnings.push('a code fence was never closed; everything after it was read as text')
  }

  return {
    document_id: documentId,
    parsed_from: rawArtifactId,
    structure,
    text_blocks: textBlocks,
    tables,
    warnings,
    metadata: {
      extractor_version: EXTRACTOR_VERSION,
      heading_count: structure.filter((node) => node.type === 'heading').length,
      text_block_count: textBlocks.length,
      structure_text_count: structure.filter((node) => node.type === 'text').length,
      table_count: tables.length,
    },
  }
}
