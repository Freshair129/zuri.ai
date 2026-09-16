// @req FR-225 — the Thai wizard's initial render: the Channel ID / Channel
//   secret / optional token fields are present in Thai, the removed
//   `deployment-secret:` field is gone from the Studio page, and the
//   credential-status line never renders a mount-backed account as if it were
//   already migrated.
// @spec ADR-089 D7; design §5.3
// @tested tests/unit/line-oa-connect-wizard-render.test.js
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import LineOaConnectWizard from '@/modules/line-oa-studio/ui/LineOaConnectWizard'
import LineOaCredentialMigrationCard from '@/modules/line-oa-studio/ui/LineOaCredentialMigrationCard'
import LineStudioEdgeConnection from '@/modules/line-oa-studio/ui/LineStudioEdgeConnection'
import { ScopeProvider } from '@/context/ScopeContext'
import { sampleInventory } from '../factories/scope-context'

globalThis.React = React

vi.mock('@/context/ScopeContext', async () => {
  const { createScopeContextDouble } = await import('../factories/scope-context')
  return createScopeContextDouble()
})

describe('FR-225 LineOaConnectWizard initial render', () => {
  it('shows the Thai Channel ID / Channel secret fields and no deployment-secret field', () => {
    const html = renderToStaticMarkup(createElement(LineOaConnectWizard, { businessId: 'biz-1', onConnected: () => {} }))
    expect(html).toContain('เชื่อมต่อ LINE Official Account')
    expect(html).toContain('Channel ID')
    expect(html).toContain('Channel secret')
    expect(html).toContain('ตรวจสอบกับ LINE และบันทึก')
    expect(html).not.toContain('deployment-secret')
    expect(html).not.toContain('Deployment secret reference')
  })

  it('starts on the credential-entry step, not mid-wizard', () => {
    const html = renderToStaticMarkup(createElement(LineOaConnectWizard, { businessId: 'biz-1', onConnected: () => {} }))
    expect(html).not.toContain('เชื่อมต่อสำเร็จ')
    expect(html).not.toContain('สร้างบัญชี LINE OA แล้ว')
  })
})

describe('FR-225 LineOaCredentialMigrationCard', () => {
  it('renders nothing for an account with no credential yet', () => {
    const html = renderToStaticMarkup(createElement(LineOaCredentialMigrationCard, { account: { health: { connection: null } } }))
    expect(html).toBe('')
  })

  it('offers the migration action only for a DEPLOYMENT_MOUNT-backed credential', () => {
    const html = renderToStaticMarkup(createElement(LineOaCredentialMigrationCard, {
      account: { integrationConnectionId: 'ic-1', health: { connection: { secretStore: 'DEPLOYMENT_MOUNT' } } },
    }))
    expect(html).toContain('ย้ายข้อมูลรับรองเข้า Vault')
    expect(html).not.toContain('ใช้งานได้')
  })

  it('shows the credential status line, never the migration action, once the credential is in the vault', () => {
    const html = renderToStaticMarkup(createElement(LineOaCredentialMigrationCard, {
      account: { integrationConnectionId: 'ic-1', health: { connection: { secretStore: 'ENVELOPE', credentialVersion: 2, lastValidatedAt: null } } },
    }))
    expect(html).toContain('เวอร์ชัน 2')
    expect(html).not.toContain('ย้ายข้อมูลรับรองเข้า Vault')
  })
})

describe('FR-225 Studio page no longer offers the deployment-secret form', () => {
  it('renders the wizard instead of the old deployment-secret-only form', () => {
    const html = renderToStaticMarkup(createElement(
      ScopeProvider,
      { inventory: sampleInventory(), selection: { businessId: 'biz-1' } },
      createElement(LineStudioEdgeConnection),
    ))
    expect(html).not.toContain('Deployment secret reference')
    expect(html).not.toContain('deployment-secret:line-main')
    expect(html).toContain('เชื่อมต่อ LINE Official Account')
  })
})
