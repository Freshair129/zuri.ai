import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workspace = readFileSync(
  resolve(process.cwd(), 'src/modules/asset-management/components/AssetReceivingWorkspace.jsx'),
  'utf8',
)

// @req FR-137 — Receiving distinguishes the physical Asset photo, payment
// proof, and conditional warranty evidence before one governed intake is saved.
// @spec SDD-081, BR-024, ADR-056
// @tested tests/unit/asset-receiving-evidence-ui.test.js

describe('FR-137 Asset receiving evidence UI', () => {
  it('renders the approved evidence heading and three explicit evidence roles', () => {
    expect(workspace).toContain('1. หลักฐานภาพถ่ายและการจ่ายเงิน')
    expect(workspace).toContain('ภาพถ่ายทรัพย์สิน (บังคับ)')
    expect(workspace).toContain('ใบเสร็จ/หลักฐานการจ่ายเงิน (บังคับ)')
    expect(workspace).toContain('ใบรับประกัน (ถ้ามี)')
    expect(workspace).toContain("role: 'ASSET_PHOTO'")
    expect(workspace).toContain("role: 'PAYMENT_PROOF'")
    expect(workspace).toContain("role: 'WARRANTY'")
  })

  it('requires photo and payment uploads while keeping warranty conditional', () => {
    expect(workspace).toContain('uploadedEvidence.ASSET_PHOTO')
    expect(workspace).toContain('uploadedEvidence.PAYMENT_PROOF')
    expect(workspace).not.toMatch(/canSave[^\n]*uploadedEvidence\.WARRANTY/)
  })

  it('selects payment proof for Vision and reviews every attached evidence row', () => {
    expect(workspace).toContain("item.role === 'PAYMENT_PROOF'")
    expect(workspace).toContain('reviewEvidence(evidence.id)')
    expect(workspace).not.toContain('intake?.evidence?.[0]?.id')
  })
})
