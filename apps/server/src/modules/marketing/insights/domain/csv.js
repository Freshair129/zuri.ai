// Marketing Insights (S6) — CSV for the Results chart export. Pure.
//
// @spec docs/migrations/service-extraction/INSIGHTS-CONTRACT-RECONCILIATION.md (R-13 CSV consistency)
// @tested tests/unit/marketing/insights/csv.test.js
//
// RFC 4180 quoting, CRLF line ends, UTF-8 with a BOM so Excel opens Thai text
// correctly. Text cells that a spreadsheet would evaluate as a formula are
// prefixed with an apostrophe; numeric cells are written as numbers and are
// never altered, so the file matches the chart value for value.

const BOM = '﻿'
const FORMULA_LEAD = /^[=+\-@\t\r]/

export function csvTextCell(value) {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (FORMULA_LEAD.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function csvNumberCell(value) {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('csvNumberCell: refusing a non-finite value')
  }
  // String(number) is the shortest exact round-trip representation.
  return String(value)
}

/**
 * @param {Array<{ key: string, kind: 'text'|'number' }>} columns
 * @param {Array<object>} rows
 */
export function toCsv(columns, rows, { bom = true } = {}) {
  const header = columns.map((column) => csvTextCell(column.key)).join(',')
  const body = rows.map((row) => columns
    .map((column) => (column.kind === 'number' ? csvNumberCell(row[column.key]) : csvTextCell(row[column.key])))
    .join(','))
  return `${bom ? BOM : ''}${[header, ...body].join('\r\n')}\r\n`
}

export const METRIC_EXPORT_COLUMNS = Object.freeze([
  { key: 'date', kind: 'text' },
  { key: 'organic', kind: 'number' },
  { key: 'paid', kind: 'number' },
  { key: 'total', kind: 'number' },
  { key: 'quality', kind: 'text' },
  { key: 'unit', kind: 'text' },
])

/** Same points the chart renders; an empty cell is "no value", never zero. */
export function metricSeriesCsv(points) {
  return toCsv(METRIC_EXPORT_COLUMNS, points.map((point) => ({
    date: point.date,
    organic: point.organic,
    paid: point.paid,
    total: point.value,
    quality: point.quality,
    unit: point.unit,
  })))
}

/** A download filename built only from validated tokens. */
export function exportFilename({ brand, metricKey, from, to }) {
  const safe = (value) => String(value).replace(/[^a-z0-9_-]/gi, '')
  return `insights-${safe(brand)}-${safe(metricKey)}-${safe(from)}-${safe(to)}.csv`
}
