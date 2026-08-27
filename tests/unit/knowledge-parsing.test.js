import { describe, it, expect } from 'vitest'
import { parseDocument } from '@/modules/knowledge/parsing'
import { chunkDocument } from '@/modules/knowledge/chunking'

// @req FR-115 — document parsing into a structured artifact that keeps its link to the raw source
// @spec SDD-063, docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md §7 (Stage 2)

const parse = (text, over = {}) =>
  parseDocument({ documentId: 'doc_1', rawArtifactId: 'raw_1', text, ...over })

describe('a hash inside a code fence is not a heading', () => {
  it('keeps a fenced comment as text', () => {
    const artifact = parse(['# Real heading', '', '```bash', '# not a heading', 'npm run verify', '```'].join('\n'))
    expect(artifact.structure.filter((n) => n.type === 'heading').map((n) => n.text)).toEqual(['Real heading'])
  })

  it('does not lose the fenced lines — they survive as text', () => {
    const artifact = parse(['# H', '```', '# fenced', '```'].join('\n'))
    expect(JSON.stringify(artifact.text_blocks)).toContain('# fenced')
  })
})

describe('other things that look like headings and are not', () => {
  it('leaves a four-space-indented hash alone — indented code is code', () => {
    const artifact = parse(['# Real', '', '    # indented, not a heading', ''].join('\n'))
    expect(artifact.structure.filter((n) => n.type === 'heading').map((n) => n.text)).toEqual(['Real'])
  })

  it('treats #hashtag as prose — CommonMark needs the space', () => {
    const artifact = parse('#โปรโมชัน ลด 20 เปอร์เซ็นต์')
    expect(artifact.structure.filter((n) => n.type === 'heading')).toEqual([])
  })

  it('reads a setext heading underlined with equals', () => {
    const artifact = parse(['Payment terms', '=============', '', 'Net thirty.'].join('\n'))
    expect(artifact.structure.filter((n) => n.type === 'heading')).toEqual([
      { type: 'heading', level: 1, text: 'Payment terms' },
    ])
  })

  it('reads a setext heading underlined with dashes as level two', () => {
    const artifact = parse(['Delivery', '--------', '', 'On site.'].join('\n'))
    expect(artifact.structure.find((n) => n.type === 'heading')).toEqual({
      type: 'heading',
      level: 2,
      text: 'Delivery',
    })
  })
})

describe('the seam with Stage 7 is a contract, not a coincidence', () => {
  it('feeds real parser output straight into chunkDocument', () => {
    const artifact = parse(
      [
        '# Contract',
        '## Payment',
        'Net thirty days.',
        '## Delivery',
        'On site by the seller.',
      ].join('\n'),
    )

    const { chunks } = chunkDocument({
      documentId: artifact.document_id,
      scope: { tenantId: 'ten_1', businessId: 'biz_1' },
      provenance: { parsed_from: artifact.parsed_from },
      blocks: artifact.structure,
    })

    expect(chunks.map((c) => c.heading_path)).toEqual([
      ['Contract', 'Payment'],
      ['Contract', 'Delivery'],
    ])
    expect(chunks[0].text).toBe('Net thirty days.')
  })

  it('carries the raw artifact link all the way to a chunk', () => {
    const artifact = parse(['# H', 'Body.'].join('\n'))
    const { chunks } = chunkDocument({
      documentId: artifact.document_id,
      scope: { tenantId: 'ten_1', businessId: 'biz_1' },
      provenance: { parsed_from: artifact.parsed_from },
      blocks: artifact.structure,
    })
    expect(chunks[0].provenance.parsed_from).toBe('raw_1')
  })
})

describe('tables', () => {
  const table = ['| Item | Qty |', '|---|---|', '| Gift set | 10 |', '| Card | 4 |'].join('\n')

  it('reads a table into rows rather than leaving it as prose', () => {
    const artifact = parse(table)
    expect(artifact.tables).toHaveLength(1)
    expect(artifact.tables[0].header).toEqual(['Item', 'Qty'])
    expect(artifact.tables[0].rows).toEqual([['Gift set', '10'], ['Card', '4']])
  })

  it('does not mistake a sentence containing a pipe for a table', () => {
    const artifact = parse('The command is npm run verify | tee log.txt and nothing else.')
    expect(artifact.tables).toEqual([])
  })

  it('refuses a table whose separator does not match its header, rather than guessing', () => {
    const artifact = parse(['| A | B | C |', '|---|---|', '| 1 | 2 | 3 |'].join('\n'))
    expect(artifact.tables).toEqual([])
    expect(artifact.warnings.join(' ')).toMatch(/separator/i)
  })

  it('counts a table in the artifact rather than making the caller count', () => {
    expect(parse(table).metadata.table_count).toBe(1)
  })
})

describe('files as they actually arrive', () => {
  it('reads CRLF line endings', () => {
    const artifact = parse('# Heading\r\n\r\nBody text.\r\n')
    expect(artifact.structure.find((n) => n.type === 'heading')).toEqual({ type: 'heading', level: 1, text: 'Heading' })
  })

  it('strips a leading byte-order mark instead of gluing it to the first heading', () => {
    const artifact = parse('﻿# Heading')
    expect(artifact.structure[0]).toEqual({ type: 'heading', level: 1, text: 'Heading' })
  })

  it('returns an empty artifact for an empty document rather than throwing', () => {
    const artifact = parse('')
    expect(artifact.structure).toEqual([])
    expect(artifact.tables).toEqual([])
    expect(artifact.document_id).toBe('doc_1')
    expect(artifact.parsed_from).toBe('raw_1')
  })
})

describe('the artifact says what it is made of', () => {
  it('records the extractor version, so a reparse can be told from the original', () => {
    expect(parse('# H').metadata.extractor_version).toBeTruthy()
  })

  it('counts headings, raw text blocks and structure text separately', () => {
    const artifact = parse(['# H', 'One.', 'Two.'].join('\n'))
    expect(artifact.metadata.heading_count).toBe(1)
    // text_block_count is the length of text_blocks — every source line kept.
    expect(artifact.metadata.text_block_count).toBe(artifact.text_blocks.length)
    // structure_text_count is what Stage 7 will chunk: blank lines excluded.
    expect(artifact.metadata.structure_text_count).toBe(2)
  })
})

describe('setext looks at the line above, not the last thing it happened to record', () => {
  it('does not promote a paragraph separated from the dashes by a blank line', () => {
    const artifact = parse(['Payment terms', '', '-----', '', 'Net thirty.'].join('\n'))
    expect(artifact.structure.filter((n) => n.type === 'heading')).toEqual([])
  })

  it('does not reach back over a table to promote a paragraph five rows up', () => {
    const artifact = parse(
      ['Intro paragraph.', '| A | B |', '|---|---|', '| 1 | 2 |', '---', 'After.'].join('\n'),
    )
    expect(artifact.structure.filter((n) => n.type === 'heading')).toEqual([])
  })

  it('still reads a genuine setext heading on the line directly above', () => {
    const artifact = parse(['Payment terms', '-----', 'Net thirty.'].join('\n'))
    expect(artifact.structure.find((n) => n.type === 'heading')).toEqual({
      type: 'heading',
      level: 2,
      text: 'Payment terms',
    })
  })
})

describe('table content is reachable by Stage 7', () => {
  it('puts table rows into structure, so a chunk can carry what the table says', () => {
    const artifact = parse(['# Prices', '| Item | Qty |', '|---|---|', '| Gift set | 10 |'].join('\n'))
    const { chunks } = chunkDocument({
      documentId: artifact.document_id,
      scope: { tenantId: 't', businessId: 'b' },
      provenance: {},
      blocks: artifact.structure,
    })
    expect(chunks[0].text).toContain('Gift set')
    expect(chunks[0].text).toContain('10')
  })

  it('still reports the table as a table, not only as text', () => {
    expect(parse(['| A |', '|---|', '| 1 |'].join('\n')).tables).toHaveLength(1)
  })
})

describe('the artifact counts what its field names say', () => {
  it('text_block_count matches the length of text_blocks', () => {
    const artifact = parse(['# H', 'One.', 'Two.'].join('\n'))
    expect(artifact.metadata.text_block_count).toBe(artifact.text_blocks.length)
  })
})

describe('a fence that never closes', () => {
  it('says so rather than silently swallowing the rest of the document', () => {
    const artifact = parse(['# H', '```', 'still open', '# also swallowed'].join('\n'))
    expect(artifact.warnings.join(' ')).toMatch(/fence/i)
  })
})

describe('a fence is closed by its own marker, not by any fence-looking line', () => {
  it('does not let a tilde fence close a backtick fence', () => {
    const artifact = parse(['```', '~~~', '# still inside the block', '```', '# real heading'].join('\n'))
    expect(artifact.structure.filter((n) => n.type === 'heading').map((n) => n.text)).toEqual(['real heading'])
  })

  it('does not let a shorter run close a longer one', () => {
    const artifact = parse(['````', '```', '# still inside', '````', '# real heading'].join('\n'))
    expect(artifact.structure.filter((n) => n.type === 'heading').map((n) => n.text)).toEqual(['real heading'])
  })
})
