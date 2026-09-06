// @req FR-139, FR-140 — workbook/Sheet/LINE converge without becoming authority.
// @spec SDD-083, SDD-084, NFR-022, SEC-024, ADR-056
// @tested tests/unit/asset-intake-adapters-contract.test.js
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

async function optionalModule(relativePath) {
  try { return await import(pathToFileURL(path.resolve(relativePath)).href) } catch { return null }
}

const row = {
  correlationId: 'sheet-1', origin: 'PROCUREMENT_PURCHASE', name: 'Notebook',
  categoryCode: 'IT', quantity: '1', expiryControlled: 'FALSE', paymentFileAssetId: 'file-payment',
  prSystem: 'ERP', prValue: 'PR-1', poSystem: 'ERP', poValue: 'PO-1',
}

describe('FR-139 Asset workbook and Sheet snapshot', () => {
  it('publishes ASSET_PHOTO as a governed evidence-role lookup value', async () => {
    const template = await optionalModule('src/modules/asset-management/import/xlsx-template.js')
    expect(template, 'Asset workbook template must exist').not.toBeNull()
    if (!template) return

    const workbook = template.buildAssetTemplateWorkbook()
    const lookups = workbook.getWorksheet('Lookups')
    const evidenceRoles = lookups.getRows(1, lookups.rowCount)
      .map((lookupRow) => [lookupRow.getCell(1).value, lookupRow.getCell(2).value])
      .filter(([list]) => list === 'evidenceRole')
      .map(([, value]) => value)
    expect(evidenceRoles).toContain('ASSET_PHOTO')
  })

  it('generates the governed workbook topology and round-trips one canonical row', async () => {
    const template = await optionalModule('src/modules/asset-management/import/xlsx-template.js')
    const converter = await optionalModule('src/modules/asset-management/import/xlsx-convert.js')
    expect(template, 'Asset workbook template must exist').not.toBeNull()
    expect(converter, 'Asset workbook converter must exist').not.toBeNull()
    if (!template || !converter) return

    const workbook = template.buildAssetTemplateWorkbook({ exampleRows: [row] })
    workbook.getWorksheet('Evidence').addRow({
      correlationId: row.correlationId, fileAssetId: 'file-photo', role: 'ASSET_PHOTO',
    })
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'อ่านก่อน (Read Me)', 'Assets', 'Evidence', 'ProcurementRefs', 'Lookups',
    ])
    expect(workbook.getWorksheet('อ่านก่อน (Read Me)').getCell(3, 1).value).toContain('ASSET_PHOTO')
    const buffer = await workbook.xlsx.writeBuffer()
    const preview = await converter.assetWorkbookToEnvelopes(Buffer.from(buffer), { businessId: 'business-a' })
    expect(preview.errors).toEqual([])
    expect(preview.envelopes[0]).toMatchObject({
      businessId: 'business-a', source: { channel: 'EXCEL', correlationId: 'sheet-1' },
      evidence: expect.arrayContaining([
        expect.objectContaining({ fileAssetId: 'file-photo', role: 'ASSET_PHOTO' }),
        expect.objectContaining({ fileAssetId: 'file-payment', role: 'PAYMENT_PROOF' }),
      ]),
      procurementRefs: expect.arrayContaining([expect.objectContaining({ type: 'PR' }), expect.objectContaining({ type: 'PO' })]),
    })
  })

  it('hashes a bounded Sheet snapshot and converts through the same row contract', async () => {
    const sheet = await optionalModule('src/modules/asset-management/import/sheet-snapshot.js')
    expect(sheet, 'Google Sheets snapshot adapter must exist').not.toBeNull()
    if (!sheet) return
    const result = sheet.convertAssetSheetSnapshot({
      businessId: 'business-a', spreadsheetId: 'sheet-id', revisionId: 'rev-7', range: 'Assets!A2:Z10', rows: [row],
    })
    expect(result.snapshotSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.envelopes[0]).toMatchObject({ businessId: 'business-a', source: { channel: 'GOOGLE_SHEET' } })
    expect(() => sheet.convertAssetSheetSnapshot({ businessId: 'business-a', spreadsheetId: 'x', revisionId: 'x', range: 'A1', rows: Array(501).fill(row) }))
      .toThrow(/500/)
  })

  it('exports data rows plus evidence and procurement references without inserting metadata into Assets', async () => {
    const template = await optionalModule('src/modules/asset-management/import/xlsx-template.js')
    const converter = await optionalModule('src/modules/asset-management/import/xlsx-convert.js')
    expect(template).not.toBeNull()
    expect(converter).not.toBeNull()
    if (!template || !converter) return

    const envelope = {
      schemaVersion: '1.0', source: { channel: 'WEB', correlationId: 'export-1' }, businessId: 'business-a',
      origin: 'PROCUREMENT_PURCHASE', item: { name: 'Notebook', categoryCode: 'IT', quantity: 1, expiryControlled: false },
      evidence: [], procurementRefs: [], lot: null, responsibilities: [], location: null, projectAllocation: null, depreciation: null,
    }
    const workbook = template.buildAssetExportWorkbook([{
      sourceCorrelationId: 'export-1', origin: 'PROCUREMENT_PURCHASE', normalizedEnvelopeJson: JSON.stringify(envelope),
      evidence: [
        { fileAssetId: 'file-export-photo', role: 'ASSET_PHOTO' },
        { fileAssetId: 'file-export', role: 'PAYMENT_PROOF', paymentReference: 'PAY-1' },
      ],
      procurementRefs: [{ type: 'PR', system: 'ERP', value: 'PR-EXPORT' }, { type: 'PO', system: 'ERP', value: 'PO-EXPORT' }],
    }])
    expect(workbook.getWorksheet('Assets').getCell('A3').value).toBe('export-1')
    expect(workbook.getWorksheet('Evidence').getCell('B3').value).toBe('file-export-photo')
    expect(workbook.getWorksheet('ProcurementRefs').getCell('D3').value).toBe('PR-EXPORT')
    const buffer = await workbook.xlsx.writeBuffer()
    const preview = await converter.assetWorkbookToEnvelopes(Buffer.from(buffer), { businessId: 'business-a' })
    expect(preview.errors).toEqual([])
    expect(preview.envelopes[0]).toMatchObject({
      source: { correlationId: 'export-1' },
      evidence: expect.arrayContaining([
        expect.objectContaining({ fileAssetId: 'file-export-photo', role: 'ASSET_PHOTO' }),
        expect.objectContaining({ fileAssetId: 'file-export', role: 'PAYMENT_PROOF' }),
      ]),
      procurementRefs: expect.arrayContaining([expect.objectContaining({ value: 'PR-EXPORT' }), expect.objectContaining({ value: 'PO-EXPORT' })]),
    })
  })
})

describe('FR-140 trusted LINE handoff', () => {
  it('accepts opaque FileAsset IDs and forbids body authority, secrets, tokens and URLs', async () => {
    const line = await optionalModule('src/modules/asset-management/import/line-asset-handoff.js')
    expect(line, 'LINE Asset handoff contract must exist').not.toBeNull()
    if (!line) return

    expect(line.zLineAssetHandoff.safeParse({ correlationId: 'line-1', fileAssetIds: ['file-a'] }).success).toBe(true)
    for (const forbidden of ['tenantId', 'businessId', 'channelAccessToken', 'channelSecret', 'replyToken', 'attachmentUrl']) {
      expect(line.zLineAssetHandoff.safeParse({ correlationId: 'line-1', fileAssetIds: ['file-a'], [forbidden]: 'forbidden' }).success, forbidden).toBe(false)
    }
  })
})
