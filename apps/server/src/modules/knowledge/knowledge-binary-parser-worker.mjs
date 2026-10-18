// @req FR-288 — managed binary projection and immutable source locations.
// @spec SDD-114 — versioned binary source projection and bounded parsing.
import { parentPort, workerData } from 'node:worker_threads'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import * as parse5 from 'parse5'
import yauzl from 'yauzl'
import { SaxesParser } from 'saxes'

const LIMITS = Object.freeze({
  inputBytes: 20 * 1024 * 1024,
  pdfPages: 500,
  docxParagraphs: 100_000,
  tableCells: 25_000,
  htmlElements: 100_000,
  htmlDepth: 256,
  archiveBytes: 100 * 1024 * 1024,
  archiveXmlBytes: 20 * 1024 * 1024,
  archiveEntries: 2_000,
  archiveRatio: 20,
  outputBytes: 10 * 1024 * 1024,
})

function fail(code, status = 422, message = code) {
  const error = new Error(message)
  error.code = code
  error.status = status
  throw error
}

function normalized(value) {
  return String(value ?? '').replace(/\r\n?/gu, '\n').replace(/^\uFEFF/u, '')
}

function appendBlock(state, text, type, locator) {
  const value = normalized(text)
  if (!value.trim()) return
  const nextOutputBytes = (state.outputByteLength || 0) + (state.blocks.length ? 1 : 0) + Buffer.byteLength(value, 'utf8')
  if (nextOutputBytes > LIMITS.outputBytes) fail('OUTPUT_BYTES_LIMIT', 413)
  state.outputByteLength = nextOutputBytes
  if (state.blocks.length) state.text += '\n'
  const start = state.text.length
  state.text += value
  const end = state.text.length
  const block = { type, text: value, startOffset: start, endOffset: end }
  state.blocks.push(block)
  state.structure.push(block)
  if (locator && end > start) state.sourceSpans.push({ ...locator, unitStartUtf16: 0, unitEndUtf16: value.length, artifactStartUtf16: start, artifactEndUtf16: end, text: value })
  return { start, end }
}

function finish(state, mediaType, metadata = {}) {
  const text = normalized(state.text)
  if (!text.trim()) fail('EMPTY_DOCUMENT')
  if (Buffer.byteLength(text, 'utf8') > LIMITS.outputBytes) fail('OUTPUT_BYTES_LIMIT', 413)
  const tables = state.tables || []
  state.sourceSpans.sort((left, right) => left.artifactStartUtf16 - right.artifactStartUtf16 || left.artifactEndUtf16 - right.artifactEndUtf16)
  return {
    normalizedText: text,
    structure: state.structure,
    textBlocks: state.blocks,
    tables,
    sourceSpans: state.sourceSpans,
    warnings: state.warnings,
    metadata: {
      sourceFormat: mediaType,
      binaryParserVersion: workerData.parserVersion,
      mappingVersion: 'source-locator-map-1',
      rawByteLength: workerData.bytes.byteLength,
      rawSha256: workerData.rawSha256,
      ...metadata,
    },
  }
}

async function parsePdf(bytes) {
  let loadingTask
  let doc
  try {
    loadingTask = getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      useWorkerFetch: false,
      disableAutoFetch: true,
      disableStream: true,
      isEvalSupported: false,
      useWasm: false,
      useSystemFonts: false,
      stopAtErrors: true,
      verbosity: 0,
    })
    doc = await loadingTask.promise
  } catch (error) {
    await destroyPdfLoadingTask(loadingTask)
    if (error?.name === 'PasswordException') fail('ENCRYPTED_DOCUMENT', 422)
    fail('MALFORMED_PDF')
  }
  try {
    if (!Number.isSafeInteger(doc.numPages) || doc.numPages < 1) fail('MALFORMED_PDF')
    if (doc.numPages > LIMITS.pdfPages) fail('PDF_PAGE_LIMIT', 413)
    const state = { text: '', structure: [], blocks: [], sourceSpans: [], warnings: [], tables: [] }
    let visibleTextPages = 0
    for (let pageIndex = 0; pageIndex < doc.numPages; pageIndex += 1) {
      const page = await doc.getPage(pageIndex + 1)
      const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false })
      let pageText = ''
      let pageTextBytes = 0
      for (const item of content.items || []) {
        if (typeof item.str !== 'string' || !item.str) continue
        let addedBytes = 0
        if (pageText && !/\s$/u.test(pageText) && !/^\s/u.test(item.str)) {
          const separator = item.hasEOL ? '\n' : ' '
          pageText += separator
          addedBytes += Buffer.byteLength(separator, 'utf8')
        }
        pageText += item.str
        addedBytes += Buffer.byteLength(item.str, 'utf8')
        if (item.hasEOL && !pageText.endsWith('\n')) { pageText += '\n'; addedBytes += 1 }
        pageTextBytes += addedBytes
        if (pageTextBytes > LIMITS.outputBytes) fail('OUTPUT_BYTES_LIMIT', 413)
      }
      pageText = normalized(pageText).trim()
      let hasImage = false
      try {
        const operations = await page.getOperatorList()
        const imageOps = new Set([OPS.paintImageXObject, OPS.paintJpegXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectGroup, OPS.paintSolidColorImageMask])
        hasImage = operations.fnArray.some((operation) => imageOps.has(operation))
      } catch {
        // Incomplete image metadata does not turn extracted visible text into OCR.
        hasImage = true
      }
      if (pageText) {
        visibleTextPages += 1
        appendBlock(state, pageText, 'pdf_page', { kind: 'pdf_page', pageIndex })
      }
      if (hasImage) state.warnings.push({ code: 'IMAGE_CONTENT_NOT_PROCESSED', locations: [{ kind: 'pdf_page', pageIndex }] })
      page.cleanup()
    }
    if (!visibleTextPages && state.warnings.length) fail('IMAGE_ONLY_DOCUMENT')
    return finish(state, 'application/pdf', { pageCount: doc.numPages })
  } finally {
    await destroyPdfLoadingTask(loadingTask)
  }
}

async function destroyPdfLoadingTask(loadingTask) {
  if (typeof loadingTask?.destroy !== 'function') return
  try { await loadingTask.destroy() } catch { /* Cleanup must not replace parser evidence. */ }
}

function zipEntries(bytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(Buffer.from(bytes), { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) return reject(error || new Error('Malformed DOCX archive'))
      const entries = []
      let settled = false
      const done = (fn, value) => { if (!settled) { settled = true; fn(value) } }
      zip.on('error', (cause) => { zip.close(); done(reject, cause) })
      zip.on('entry', (entry) => {
        entries.push(entry)
        if (entries.length > LIMITS.archiveEntries) {
          zip.close()
          return done(reject, Object.assign(new Error('DOCX archive entry limit exceeded'), { code: 'ARCHIVE_ENTRY_COUNT_LIMIT' }))
        }
        zip.readEntry()
      })
      zip.on('end', () => done(resolve, { zip, entries }))
      zip.readEntry()
    })
  })
}

function readZipEntry(zip, entry, remainingBytes) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) return reject(error || new Error('DOCX entry stream unavailable'))
      const chunks = []
      let length = 0
      stream.on('data', (chunk) => {
        length += chunk.length
        if (length > remainingBytes || length > entry.uncompressedSize) {
          stream.destroy(Object.assign(new Error('DOCX entry exceeded declared size'), { code: 'ARCHIVE_EXPANSION_LIMIT' }))
          return
        }
        chunks.push(chunk)
      })
      stream.on('error', reject)
      stream.on('end', () => resolve(Buffer.concat(chunks, length)))
    })
  })
}

function parseXml(xml, handlers = {}) {
  let failed = null
  const parser = new SaxesParser({ xmlns: false, fragment: false })
  parser.on('opentag', (tag) => handlers.open?.(tag))
  parser.on('text', (text) => handlers.text?.(text))
  parser.on('closetag', (tag) => handlers.close?.(tag))
  parser.on('error', (error) => { failed = error })
  try { parser.write(xml).close() } catch (error) { failed = error }
  if (failed) fail('MALFORMED_DOCX', 422, failed.message)
}

function decodeDocxXml(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { fail('MALFORMED_DOCX') }
}

function attribute(tag, localName) {
  for (const [name, item] of Object.entries(tag.attributes || {})) {
    if (name.split(':').at(-1) === localName) return item?.value ?? item
  }
  return null
}

function parseDocxDocument(xml) {
  const state = { text: '', structure: [], blocks: [], sourceSpans: [], warnings: [], tables: [] }
  const stack = []
  const tables = []
  let bodySeen = false
  let inBody = false
  let paragraphCount = 0
  let tableCellCount = 0
  let currentParagraph = null
  let currentTable = null
  let currentRow = null
  let currentCell = null
  let inGrid = false
  parseXml(xml, {
    open(tag) {
      const local = tag.name.split(':').at(-1)
      stack.push(local)
      if (local === 'body') { inBody = true; bodySeen = true }
      if (local === 'tbl' && inBody) {
        if (currentTable) fail('AMBIGUOUS_TABLE_MAPPING')
        currentTable = { tableIndex: tables.length, gridColumns: 0, rows: [], currentRow: null, activeMerges: new Map(), projectedBytes: 0 }
        tables.push(currentTable)
      } else if (local === 'tblGrid' && currentTable) inGrid = true
      else if (local === 'gridCol' && inGrid && currentTable) currentTable.gridColumns += 1
      else if (local === 'tr' && currentTable) {
        currentRow = { rowIndex: currentTable.rows.length, cells: [], cursor: 0, nextMerges: new Map() }
        currentTable.currentRow = currentRow
      } else if (local === 'tc' && currentTable && currentRow) {
        tableCellCount += 1
        if (tableCellCount > LIMITS.tableCells) fail('TABLE_CELL_LIMIT', 413)
        currentCell = { paragraphs: [], gridSpan: 1, vMerge: 'none', gridColumn: null }
        currentRow.cells.push(currentCell)
      } else if (local === 'gridSpan' && currentCell) {
        const value = Number(attribute(tag, 'val'))
        currentCell.gridSpan = Number.isSafeInteger(value) && value > 0 ? value : 0
      } else if (local === 'vMerge' && currentCell) {
        const value = attribute(tag, 'val')
        currentCell.vMerge = value === null || value === '' || value === 'continue' ? 'continue' : value === 'restart' ? 'restart' : 'invalid'
      } else if (local === 'p' && inBody) {
        paragraphCount += 1
        if (paragraphCount > LIMITS.docxParagraphs) fail('DOCX_PARAGRAPH_LIMIT', 413)
        currentParagraph = { text: '', textBytes: 0, bodyParagraphIndex: paragraphCount - 1, inCell: Boolean(currentCell) }
      } else if ((local === 'tab' || local === 'br' || local === 'cr') && currentParagraph) {
        const value = local === 'tab' ? '\t' : '\n'
        if (currentParagraph.textBytes + 1 > LIMITS.outputBytes) fail('OUTPUT_BYTES_LIMIT', 413)
        currentParagraph.text += value
        currentParagraph.textBytes += 1
      }
    },
    text(value) {
      if (currentParagraph) {
        const valueBytes = Buffer.byteLength(value, 'utf8')
        if (currentParagraph.textBytes + valueBytes > LIMITS.outputBytes) fail('OUTPUT_BYTES_LIMIT', 413)
        currentParagraph.text += value
        currentParagraph.textBytes += valueBytes
      }
    },
    close(tag) {
      const local = (typeof tag === 'string' ? tag : tag.name).split(':').at(-1)
      if (local === 'p' && currentParagraph) {
        const paragraph = currentParagraph
        currentParagraph = null
        if (paragraph.inCell && currentCell) {
          const value = normalized(paragraph.text)
          currentTable.projectedBytes += Buffer.byteLength(value, 'utf8') + 1
          if (state.outputByteLength + currentTable.projectedBytes > LIMITS.outputBytes) fail('OUTPUT_BYTES_LIMIT', 413)
          currentCell.paragraphs.push(value)
        }
        else {
          const location = { kind: 'docx_paragraph', bodyParagraphIndex: paragraph.bodyParagraphIndex }
          appendBlock(state, paragraph.text, 'docx_paragraph', location)
        }
      } else if (local === 'tc' && currentCell && currentRow) {
        if (currentCell.gridSpan < 1) fail('AMBIGUOUS_TABLE_MAPPING')
        if (currentCell.vMerge === 'continue') currentCell.gridColumn = currentRow.cursor
        else {
          while ([...currentTable.activeMerges.keys()].some((column) => column >= currentRow.cursor && column < currentRow.cursor + currentCell.gridSpan)) currentRow.cursor += 1
          currentCell.gridColumn = currentRow.cursor
        }
        const end = currentCell.gridColumn + currentCell.gridSpan
        if (currentTable.gridColumns && end > currentTable.gridColumns) fail('AMBIGUOUS_TABLE_MAPPING')
        if (currentCell.vMerge === 'continue') {
          const prior = currentTable.activeMerges.get(currentCell.gridColumn)
          if (!prior || prior.gridSpan !== currentCell.gridSpan) fail('AMBIGUOUS_TABLE_MAPPING')
          currentRow.nextMerges.set(currentCell.gridColumn, prior)
        } else if (currentCell.vMerge === 'restart') {
          currentRow.nextMerges.set(currentCell.gridColumn, currentCell)
        } else if (currentCell.vMerge === 'invalid') fail('AMBIGUOUS_TABLE_MAPPING')
        currentRow.cursor = end
        currentCell.text = currentCell.paragraphs.join('\n')
        currentCell = null
      } else if (local === 'tr' && currentRow && currentTable) {
        if (currentTable.gridColumns && currentRow.cursor !== currentTable.gridColumns) fail('AMBIGUOUS_TABLE_MAPPING')
        currentTable.rows.push(currentRow.cells)
        currentTable.activeMerges = currentRow.nextMerges
        currentRow = null
      } else if (local === 'tblGrid') inGrid = false
      else if (local === 'tbl' && currentTable) {
        const table = currentTable
        if (table.rows.some((row) => row.length !== table.rows[0].length)) fail('AMBIGUOUS_TABLE_MAPPING')
        const matrix = table.rows.map((row) => row.map((cell) => cell.text))
        const tableIndex = table.tableIndex
        state.tables.push({ tableIndex, rows: matrix, gridColumns: table.gridColumns || Math.max(0, ...table.rows.map((row) => row.reduce((sum, cell) => sum + cell.gridSpan, 0))) })
        const tableText = table.rows.map((row) => row.map((cell) => cell.text).join('\t')).join('\n')
        const range = appendBlock(state, tableText, 'docx_table', null)
        if (range) {
          let rowCursor = 0
          for (const row of table.rows) {
            let cellCursor = rowCursor
            for (let cellIndex = 0; cellIndex < row.length; cellIndex += 1) {
              const cell = row[cellIndex]
              const paragraphs = cell.paragraphs.length ? cell.paragraphs : ['']
              let localCursor = 0
              for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
                const paragraphText = paragraphs[paragraphIndex]
                const artifactStart = range.start + cellCursor + localCursor
                if (paragraphText.length) state.sourceSpans.push({ kind: 'docx_table_cell', tableIndex, rowIndex: table.rows.indexOf(row), cellIndex, gridColumn: cell.gridColumn, gridSpan: cell.gridSpan, vMerge: cell.vMerge, paragraphIndex, unitStartUtf16: 0, unitEndUtf16: paragraphText.length, artifactStartUtf16: artifactStart, artifactEndUtf16: artifactStart + paragraphText.length, text: paragraphText })
                localCursor += paragraphText.length + (paragraphIndex < paragraphs.length - 1 ? 1 : 0)
              }
              cellCursor += cell.text.length + 1
            }
            rowCursor += row.map((cell) => cell.text).join('\t').length + 1
          }
        }
        currentTable = null
      } else if (local === 'body') inBody = false
      if (stack.pop() !== local) fail('MALFORMED_DOCX')
    },
  })
  if (!bodySeen || currentTable || currentParagraph) fail('MALFORMED_DOCX')
  return state
}

async function parseDocx(bytes) {
  let archive
  try { archive = await zipEntries(bytes) } catch (error) { fail(error?.code || 'MALFORMED_DOCX', error?.code === 'ARCHIVE_ENTRY_COUNT_LIMIT' ? 413 : 422, error?.message) }
  const { zip, entries } = archive
  const seen = new Set()
  let expanded = 0
  let compressed = 0
  for (const entry of entries) {
    const name = entry.fileName
    if (!name || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..') || name.includes('\0') || seen.has(name)) { zip.close(); fail('MALFORMED_DOCX') }
    seen.add(name)
    if (entry.generalPurposeBitFlag & 1) { zip.close(); fail('ENCRYPTED_DOCUMENT') }
    if (/\.(?:zip|docx|xlsx|pptx)$/iu.test(name) || /vbaProject\.bin$/iu.test(name)) { zip.close(); fail('UNSUPPORTED_DOCX_FEATURE') }
    expanded += Number(entry.uncompressedSize || 0)
    compressed += Number(entry.compressedSize || 0)
  }
  if (expanded > LIMITS.archiveBytes || expanded / Math.max(compressed, 1) > LIMITS.archiveRatio) { zip.close(); fail('ARCHIVE_EXPANSION_LIMIT', 413) }
  const contentTypesEntry = entries.find((entry) => entry.fileName === '[Content_Types].xml')
  const documentEntry = entries.find((entry) => entry.fileName === 'word/document.xml')
  if (!contentTypesEntry || !documentEntry) { zip.close(); fail('MALFORMED_DOCX') }
  const relationEntries = entries.filter((entry) => entry.fileName.endsWith('.rels'))
  const targets = [contentTypesEntry, documentEntry, ...relationEntries]
  if (targets.reduce((sum, entry) => sum + Number(entry.uncompressedSize || 0), 0) > LIMITS.archiveXmlBytes) {
    zip.close()
    fail('ARCHIVE_EXPANSION_LIMIT', 413)
  }
  const extracted = new Map()
  let readBytes = 0
  try {
    for (const entry of targets) {
      const data = await readZipEntry(zip, entry, LIMITS.archiveBytes - readBytes)
      readBytes += data.length
      if (entry.fileName.endsWith('.rels')) {
        parseXml(decodeDocxXml(data), { open(tag) { if (tag.name.split(':').at(-1) === 'Relationship' && String(attribute(tag, 'TargetMode') || '').toLowerCase() === 'external') fail('EXTERNAL_RELATIONSHIP') } })
      } else extracted.set(entry.fileName, data)
    }
  } catch (error) {
    zip.close()
    fail(error?.code || 'MALFORMED_DOCX', error?.status || 422, error?.message)
  }
  zip.close()
  const contentTypes = decodeDocxXml(extracted.get('[Content_Types].xml'))
  if (!/wordprocessingml\.document\.main\+xml/u.test(contentTypes)) fail('MALFORMED_DOCX')
  const state = parseDocxDocument(decodeDocxXml(extracted.get('word/document.xml')))
  if (entries.some((entry) => /^word\/media\//u.test(entry.fileName))) state.warnings.push({ code: 'IMAGE_CONTENT_NOT_PROCESSED', locations: [] })
  const unprocessedParts = entries.map((entry) => entry.fileName).filter((name) => /^word\/(?:header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/iu.test(name)).sort()
  if (unprocessedParts.length) state.warnings.push({ code: 'DOCX_AUXILIARY_CONTENT_NOT_PROCESSED', parts: unprocessedParts })
  return finish(state, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', { archiveEntryCount: entries.length, expandedArchiveBytes: expanded, documentPart: 'word/document.xml', unprocessedParts })
}

function childElements(node) {
  return (node.childNodes || []).filter((child) => typeof child.tagName === 'string')
}

function textContent(node, { skipTables = true } = {}) {
  let result = ''
  let resultBytes = 0
  const append = (value) => {
    resultBytes += Buffer.byteLength(value, 'utf8')
    if (resultBytes > LIMITS.outputBytes) fail('OUTPUT_BYTES_LIMIT', 413)
    result += value
  }
  const visit = (current) => {
    if (current.tagName && ['script', 'style', 'noscript', 'template', 'iframe', 'object', 'svg'].includes(current.tagName)) return
    if (skipTables && current.tagName === 'table') return
    if (current.nodeName === '#text') append(current.value)
    else if (current.tagName === 'br') append('\n')
    else for (const child of current.childNodes || []) visit(child)
  }
  visit(node)
  return normalized(result)
}

function preflightHtmlElements(html) {
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
  const rawTextTags = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext'])
  const stack = []
  let elements = 0
  let cursor = 0
  const closeNearest = (names) => {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (names.has(stack[index])) { stack.length = index; return }
    }
  }
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor)
    if (start < 0) break
    if (html.startsWith('<!--', start)) {
      const close = html.indexOf('-->', start + 4)
      if (close < 0) break
      cursor = close + 3
      continue
    }
    if (html.startsWith('<![CDATA[', start)) {
      const close = html.indexOf(']]>', start + 9)
      if (close < 0) break
      cursor = close + 3
      continue
    }
    let index = start + 1
    if (html[index] === '!' || html[index] === '?') {
      let quote = ''
      while (index < html.length) {
        const char = html[index++]
        if (quote) { if (char === quote) quote = ''; continue }
        if (char === '"' || char === "'") quote = char
        else if (char === '>') break
      }
      cursor = index
      continue
    }
    const closing = html[index] === '/'
    if (closing) index += 1
    const nameStart = index
    while (index < html.length && /[A-Za-z0-9:_-]/u.test(html[index])) index += 1
    if (index === nameStart || !/[A-Za-z]/u.test(html[nameStart])) { cursor = start + 1; continue }
    if (index < html.length && !/[\s/>]/u.test(html[index])) { cursor = start + 1; continue }
    const name = html.slice(nameStart, index).toLowerCase()
    let quote = ''
    let end = index
    while (end < html.length) {
      const char = html[end++]
      if (quote) { if (char === quote) quote = ''; continue }
      if (char === '"' || char === "'") quote = char
      else if (char === '>') break
    }
    if (end > html.length || html[end - 1] !== '>') break
    if (closing) {
      const matching = stack.lastIndexOf(name)
      if (matching >= 0) stack.length = matching
      cursor = end
      continue
    }
    elements += 1
    if (elements > LIMITS.htmlElements) fail('HTML_ELEMENT_LIMIT', 413)
    if (['li'].includes(name)) closeNearest(new Set(['li']))
    else if (['dt', 'dd'].includes(name)) closeNearest(new Set(['dt', 'dd']))
    else if (name === 'p') closeNearest(new Set(['p']))
    else if (/^h[1-6]$/u.test(name)) closeNearest(new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']))
    else if (name === 'option') closeNearest(new Set(['option']))
    else if (name === 'tr') closeNearest(new Set(['td', 'th', 'tr']))
    else if (name === 'td' || name === 'th') closeNearest(new Set(['td', 'th']))
    else if (name === 'tbody' || name === 'thead' || name === 'tfoot') closeNearest(new Set(['td', 'th', 'tr', 'tbody', 'thead', 'tfoot']))
    if (!voidTags.has(name)) {
      stack.push(name)
      if (stack.length > LIMITS.htmlDepth) fail('HTML_ELEMENT_LIMIT', 413)
    }
    cursor = end
    if (rawTextTags.has(name)) {
      const closeTag = new RegExp(`</\\s*${name}\\b`, 'igu')
      closeTag.lastIndex = cursor
      const match = closeTag.exec(html)
      if (!match) break
      cursor = match.index
    }
  }
}

function parseHtml(bytes) {
  let html
  try { html = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { fail('INVALID_UTF8_HTML') }
  preflightHtmlElements(html)
  const document = parse5.parse(html, { sourceCodeLocationInfo: true })
  let elementCount = 0
  const pathByNode = new Map()
  const walkCount = (node, path, depth) => {
    if (node.tagName) {
      elementCount += 1
      if (elementCount > LIMITS.htmlElements || depth > LIMITS.htmlDepth) fail('HTML_ELEMENT_LIMIT', 413)
      pathByNode.set(node, path)
    }
    const children = node.childNodes || []
    let childIndex = 0
    for (const child of children) {
      if (child.tagName) {
        walkCount(child, [...path, [child.tagName, childIndex]], depth + 1)
        childIndex += 1
      } else walkCount(child, path, depth)
    }
  }
  walkCount(document, [], 0)
  const state = { text: '', structure: [], blocks: [], sourceSpans: [], warnings: [], tables: [] }
  const textPositions = new Map()
  const skippedTextTags = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'svg'])
  const lineNormalized = (value) => String(value ?? '').replace(/\r\n?/gu, '\n')
  const indexElementText = (node) => {
    let offset = 0
    for (const child of node.childNodes || []) {
      if (child.nodeName === '#text') {
        const value = lineNormalized(child.value)
        textPositions.set(child, { elementPath: pathByNode.get(node) || [], tagName: node.tagName || 'document', unitStartUtf16: offset, unitEndUtf16: offset + value.length })
        offset += value.length
      } else if (child.tagName === 'br') offset += 1
      else if (child.tagName === 'table' || child.tagName && skippedTextTags.has(child.tagName)) continue
      else offset += indexElementText(child)
    }
    return offset
  }
  indexElementText(document)
  const rowsByTable = new Map()
  let totalCellTextBytes = 0
  const isInTable = (node) => {
    for (let current = node.parentNode; current; current = current.parentNode) if (current.tagName === 'table') return true
    return false
  }
  const collectTables = (node) => {
    if (node.tagName === 'img' || node.tagName === 'video' || node.tagName === 'audio' || node.tagName === 'canvas' || node.tagName === 'iframe' || node.tagName === 'object' || node.tagName === 'embed') state.warnings.push({ code: 'IMAGE_CONTENT_NOT_PROCESSED', locations: [{ kind: 'html_element', elementPath: pathByNode.get(node) || [] }] })
    if (node.tagName === 'table') {
      const tableIndex = state.tables.length
      const tablePath = pathByNode.get(node) || []
      const rows = []
      const cells = []
      let nestedTable = false
      const findRows = (current) => {
        for (const child of current.childNodes || []) {
          if (child.tagName === 'table' && child !== node) { nestedTable = true; continue }
          if (child.tagName === 'tr') rows.push(child)
          else if (child.tagName !== 'td' && child.tagName !== 'th') findRows(child)
        }
      }
      findRows(node)
      if (nestedTable) fail('AMBIGUOUS_TABLE_MAPPING')
      let count = 0
      const occupied = new Map()
      let gridColumns = 0
      const matrix = []
      rows.forEach((row, rowIndex) => {
        const rowCells = childElements(row).filter((child) => child.tagName === 'td' || child.tagName === 'th')
        const rowData = []
        let cursor = 0
        for (let cellIndex = 0; cellIndex < rowCells.length; cellIndex += 1) {
          const cell = rowCells[cellIndex]
          count += 1
          if (count > LIMITS.tableCells) fail('TABLE_CELL_LIMIT', 413)
          const span = (name) => {
            const raw = cell.attrs?.find((attr) => attr.name === name)?.value
            if (raw === undefined) return 1
            if (!/^\d+$/u.test(raw) || Number(raw) < 1 || Number(raw) > 100) fail('AMBIGUOUS_TABLE_MAPPING')
            return Number(raw)
          }
          const rowSpan = span('rowspan')
          const colSpan = span('colspan')
          while ([...occupied.keys()].some((column) => column >= cursor && column < cursor + colSpan)) cursor += 1
          if ([...occupied.keys()].some((column) => column >= cursor && column < cursor + colSpan)) fail('AMBIGUOUS_TABLE_MAPPING')
          const gridColumn = cursor
          const text = textContent(cell, { skipTables: true })
          totalCellTextBytes += Buffer.byteLength(text, 'utf8')
          if (totalCellTextBytes > LIMITS.outputBytes) fail('OUTPUT_BYTES_LIMIT', 413)
          const record = { cell, rowIndex, cellIndex, gridColumn, rowSpan, colSpan, text }
          cells.push(record)
          rowData.push(text)
          if (rowSpan > 1) for (let rowOffset = 1; rowOffset < rowSpan; rowOffset += 1) for (let column = gridColumn; column < gridColumn + colSpan; column += 1) {
            if (occupied.has(column)) fail('AMBIGUOUS_TABLE_MAPPING')
            occupied.set(column, rowIndex + rowOffset)
          }
          cursor = gridColumn + colSpan
        }
        for (const [column, untilRow] of [...occupied.entries()]) if (untilRow === rowIndex) occupied.delete(column)
        gridColumns = Math.max(gridColumns, cursor, ...occupied.keys().map((value) => value + 1))
        matrix.push(rowData)
      })
      if (rows.length && matrix.some((row) => row.length !== matrix[0].length)) fail('AMBIGUOUS_TABLE_MAPPING')
      state.tables.push({ tableIndex, tablePath, rows: matrix, gridColumns })
      rowsByTable.set(node, { tableIndex, tablePath, cells, matrix })
    }
    for (const child of node.childNodes || []) collectTables(child)
  }
  collectTables(document)
  const blockTags = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'pre', 'blockquote', 'address', 'figcaption', 'dt', 'dd'])
  const pendingSegments = []
  const flushText = () => {
    if (!pendingSegments.length) return
    const firstTextIndex = pendingSegments.findIndex((segment) => segment.kind === 'text')
    const runStartsWithBom = firstTextIndex === 0 && lineNormalized(pendingSegments[0].node.value).startsWith('\uFEFF')
    const pieces = pendingSegments.map((segment, index) => {
      if (segment.kind === 'break') return '\n'
      const value = lineNormalized(segment.node.value)
      return runStartsWithBom && index === firstTextIndex ? value.slice(1) : value
    })
    const runText = pieces.join('')
    const range = appendBlock(state, runText, 'html_text', null)
    if (range) {
      let outputOffset = range.start
      for (let index = 0; index < pendingSegments.length; index += 1) {
        const segment = pendingSegments[index]
        const value = pieces[index]
        if (segment.kind === 'text' && value.length) {
          const position = textPositions.get(segment.node)
          if (!position) fail('PARSER_FAILED')
          const unitStartUtf16 = position.unitStartUtf16 + (runStartsWithBom && index === firstTextIndex ? 1 : 0)
          state.sourceSpans.push({ kind: 'html_element', ...position, unitStartUtf16, unitEndUtf16: unitStartUtf16 + value.length, artifactStartUtf16: outputOffset, artifactEndUtf16: outputOffset + value.length, text: value })
        }
        outputOffset += value.length
      }
    }
    pendingSegments.length = 0
  }
  const traverse = (node) => {
    if (node.nodeName === '#text') {
      pendingSegments.push({ kind: 'text', node })
      return
    }
    if (node.tagName && ['script', 'style', 'noscript', 'template', 'iframe', 'object', 'svg'].includes(node.tagName)) { flushText(); return }
    if (node.tagName === 'table') {
      flushText()
      const table = rowsByTable.get(node)
      if (table) {
        const blockText = table.matrix.map((row) => row.join('\t')).join('\n')
        const range = appendBlock(state, blockText, 'html_table', null)
        if (range) {
          let rowCursor = 0
          for (let rowIndex = 0; rowIndex < table.matrix.length; rowIndex += 1) {
            let cellCursor = rowCursor
            const rowRecords = table.cells.filter((cell) => cell.rowIndex === rowIndex)
            for (const cell of rowRecords) {
              if (cell.text.length) state.sourceSpans.push({ kind: 'html_table_cell', tableIndex: table.tableIndex, tablePath: table.tablePath, rowIndex, cellIndex: cell.cellIndex, gridColumn: cell.gridColumn, rowSpan: cell.rowSpan, colSpan: cell.colSpan, unitStartUtf16: 0, unitEndUtf16: cell.text.length, artifactStartUtf16: range.start + cellCursor, artifactEndUtf16: range.start + cellCursor + cell.text.length, text: cell.text })
              cellCursor += cell.text.length + 1
            }
            rowCursor += table.matrix[rowIndex].join('\t').length + 1
          }
        }
      }
      return
    }
    if (node.tagName && blockTags.has(node.tagName) && !isInTable(node)) {
      flushText()
      const text = textContent(node)
      const location = { kind: 'html_element', elementPath: pathByNode.get(node) || [], tagName: node.tagName }
      appendBlock(state, text, 'html_paragraph', location)
      return
    }
    if (node.tagName === 'br') { pendingSegments.push({ kind: 'break' }); return }
    for (const child of node.childNodes || []) traverse(child)
  }
  traverse(document)
  flushText()
  return finish(state, 'text/html', { elementCount, profile: 'html-source-dom-v1', cssAndScriptsApplied: false })
}

async function main() {
  const bytes = Buffer.from(workerData.bytes)
  if (bytes.length === 0) fail('EMPTY_DOCUMENT', 422)
  if (bytes.length > LIMITS.inputBytes) fail('INPUT_BYTES_LIMIT', 413)
  const mediaType = String(workerData.mediaType || '').toLowerCase()
  let result
  if (mediaType === 'application/pdf') {
    if (bytes.subarray(0, 1024).indexOf(Buffer.from('%PDF-')) < 0) fail('MEDIA_TYPE_MISMATCH')
    result = await parsePdf(bytes)
  } else if (mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) fail('MEDIA_TYPE_MISMATCH')
    result = await parseDocx(bytes)
  } else if (mediaType === 'text/html') {
    result = parseHtml(bytes)
  } else fail('UNSUPPORTED_MEDIA_TYPE', 415)
  result.metadata.sourceId = workerData.sourceId || null
  result.metadata.sourceVersion = workerData.sourceVersion || null
  result.metadata.rawArtifactId = workerData.rawArtifactId || null
  result.metadata.parserVersion = workerData.parserVersion
  result.metadata.extractedTextSha256 = await (async () => {
    const { createHash } = await import('node:crypto')
    return createHash('sha256').update(result.normalizedText, 'utf8').digest('hex')
  })()
  result.metadata.outputByteLength = Buffer.byteLength(result.normalizedText, 'utf8')
  parentPort.postMessage({ ok: true, result })
}

main().catch((error) => parentPort.postMessage({ ok: false, error: { code: error?.code || 'PARSER_FAILED', status: error?.status || 422 } }))
