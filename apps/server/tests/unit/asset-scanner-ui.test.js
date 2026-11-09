// @req FR-133, FR-135 — printable asset tag, QR code label generator, and mobile scanner contract tests (AM-RQ-022, AM-RQ-023, AM-RQ-061).
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-scanner-ui.test.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const labelSource = readFileSync(
  resolve(process.cwd(), 'src/modules/asset-management/components/AssetTagLabel.jsx'),
  'utf8'
)

const modalSource = readFileSync(
  resolve(process.cwd(), 'src/modules/asset-management/components/AssetTagModal.jsx'),
  'utf8'
)

const scannerSource = readFileSync(
  resolve(process.cwd(), 'src/modules/asset-management/components/AssetScannerWorkspace.jsx'),
  'utf8'
)

const readyIntakesSource = readFileSync(
  resolve(process.cwd(), 'src/modules/asset-management/components/AssetReadyIntakesSection.jsx'),
  'utf8'
)

const receivingWorkspaceSource = readFileSync(
  resolve(process.cwd(), 'src/modules/asset-management/components/AssetReceivingWorkspace.jsx'),
  'utf8'
)

describe('Asset Tag Label & QR Generator Contract (AM-RQ-022, AM-RQ-023)', () => {
  it('implements deterministic SVG QR code generation without external dependencies', () => {
    expect(labelSource).toContain('generateQrMatrix')
    expect(labelSource).toContain('QrCodeSvg')
    expect(labelSource).toContain('drawFinderPattern')
    expect(labelSource).toContain('zuri://assets/')
  })

  it('supports compact 50x25mm and standard 70x35mm thermal label sizes', () => {
    expect(labelSource).toContain("sizeVariant === '50x25'")
    expect(labelSource).toContain('w-[50mm] h-[25mm]')
    expect(labelSource).toContain('w-[70mm] h-[35mm]')
    expect(labelSource).toContain('DO NOT REMOVE')
  })

  it('renders required identity metadata fields on the label', () => {
    expect(labelSource).toContain('asset.assetCode')
    expect(labelSource).toContain('asset.name')
    expect(labelSource).toContain('asset.categoryCode')
    expect(labelSource).toContain('asset.serialNumber')
    expect(labelSource).toContain('businessName')
  })
})

describe('Asset Tag Print Modal Contract', () => {
  it('provides print controls, copies selector, and print styles', () => {
    expect(modalSource).toContain('window.print()')
    expect(modalSource).toContain('@media print')
    expect(modalSource).toContain('copies')
    expect(modalSource).toContain('sizeVariant')
  })
})

describe('Asset Scanner & Stocktake Workspace Contract (AM-RQ-061, AM-RQ-062)', () => {
  it('integrates video camera feed and BarcodeDetector for fast scanning', () => {
    expect(scannerSource).toContain('navigator.mediaDevices.getUserMedia')
    expect(scannerSource).toContain('BarcodeDetector')
    expect(scannerSource).toContain("facingMode: 'environment'")
  })

  it('provides on-site stocktake verification and location relocation', () => {
    expect(scannerSource).toContain('/api/assets/lookup')
    expect(scannerSource).toContain('/verify')
    expect(scannerSource).toContain('observedLocationName')
    expect(scannerSource).toContain('observedCondition')
    expect(scannerSource).toContain('relocateIfMismatch')
  })

  it('sends the Business scope in the verify body, which is the only place the route reads it', () => {
    const routeSource = readFileSync(
      resolve(process.cwd(), 'src/app/api/assets/register/[id]/verify/route.js'),
      'utf8'
    )
    // The route destructures businessId from the JSON body (not the query string).
    expect(routeSource).toMatch(/const\s*\{[^}]*\bbusinessId\b[^}]*\}\s*=\s*body/)
    const start = scannerSource.indexOf('/verify`')
    expect(start).toBeGreaterThan(-1)
    const verifyCall = scannerSource.slice(start, scannerSource.indexOf('})', start))
    expect(verifyCall).toMatch(/businessId:\s*business\.id/)
  })
})

describe('Asset Register ready intake contract', () => {
  it('loads intakes for the currently selected Business', () => {
    expect(readyIntakesSource).toContain('/api/assets/intakes?')
    expect(readyIntakesSource).toMatch(/new URLSearchParams\(\{[\s\S]*businessId:\s*business\.id/)
    expect(readyIntakesSource).toContain("status: 'READY_FOR_REGISTRATION'")
  })

  it('posts the selected intake and Business to the existing register endpoint', () => {
    expect(readyIntakesSource).toContain("fetch('/api/assets/register'")
    expect(readyIntakesSource).toMatch(/businessId:\s*business\.id/)
    expect(readyIntakesSource).toMatch(/intakeId:\s*intake\.id/)
  })

  it('directs receiving users to the Register page for Asset ID issuance', () => {
    expect(receivingWorkspaceSource).toContain('href="/assets/register"')
    expect(receivingWorkspaceSource).toContain('หน้า Register')
  })
})
