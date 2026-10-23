import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { findEligibleLocalOllamaAccount, default as LocalOllamaModelCard } from '@/modules/line-oa-studio/ui/LocalOllamaModelCard'

globalThis.React = React

const business = { id: 'business-1', name: 'Test business' }
const account = {
  id: 'account-1',
  businessId: 'business-1',
  displayName: 'Test LINE OA',
  status: 'CONNECTED',
  serverEnabled: true,
  executionMode: 'SERVER',
  runtimeOwner: 'SERVER',
  knowledgeGrounding: 'BUSINESS_KNOWLEDGE',
  knowledgeGroundingShadow: false,
  memoryPolicy: 'OFF',
  memoryProjectId: null,
}
const status = {
  businessId: 'business-1',
  accountId: 'account-1',
  accountName: 'Test LINE OA',
  models: ['mellum:latest', 'qwen3:8b'],
  selectedModelId: 'mellum:latest',
}

describe('main-dev local Ollama model card', () => {
  it('keeps the selector visible only when the server-selected RAG mode matches GKS_CORPUS', () => {
    const ragStatus = { ...status, knowledgeSource: 'GENESISRAG17_TEST_ONLY' }
    const ragAccount = { ...account, knowledgeGrounding: 'GKS_CORPUS' }
    expect(findEligibleLocalOllamaAccount({ business, accounts: [ragAccount], status: ragStatus })).toBe(ragAccount)
    expect(findEligibleLocalOllamaAccount({ business, accounts: [ragAccount], status })).toBeNull()
    expect(findEligibleLocalOllamaAccount({ business, accounts: [account], status: ragStatus })).toBeNull()
    const html = renderToStaticMarkup(createElement(LocalOllamaModelCard, { account: ragAccount, status: ragStatus, api: vi.fn() }))
    expect(html).toContain('GenesisRAG17')
    expect(html).not.toMatch(/sourceId|ingestionId|fileSha256|host\.docker/)
  })
  it('is eligible only for the exact active Business and connected server-owned test OA', () => {
    expect(findEligibleLocalOllamaAccount({ business, accounts: [account], status })).toBe(account)
    expect(findEligibleLocalOllamaAccount({ business: { id: 'other-business' }, accounts: [account], status })).toBeNull()
    expect(findEligibleLocalOllamaAccount({ business, accounts: [{ ...account, memoryPolicy: 'ON' }], status })).toBeNull()
    expect(findEligibleLocalOllamaAccount({ business, accounts: [{ ...account, knowledgeGroundingShadow: true }], status })).toBeNull()
    expect(findEligibleLocalOllamaAccount({ business, accounts: [account], status: { ...status, accountId: 'other-account' } })).toBeNull()
  })

  it('renders the TEST ONLY boundary and only installed model choices without endpoint or credential fields', () => {
    const html = renderToStaticMarkup(createElement(LocalOllamaModelCard, {
      account,
      status,
      onSaved: vi.fn(),
      api: vi.fn(),
    }))

    expect(html).toContain('TEST ONLY')
    expect(html).toContain('Test LINE OA')
    expect(html).toContain('ไม่ใช้ข้อมูลราคาหรือสต็อกจริงของธุรกิจ')
    expect(html).toContain('ไม่ใช้ API key แบบคิดค่าบริการ')
    expect(html).toContain('ไม่เปลี่ยนเกณฑ์ readiness สำหรับ production')
    expect(html).toContain('<option value="mellum:latest" selected="">mellum:latest</option>')
    expect(html).toContain('<option value="qwen3:8b">qwen3:8b</option>')
    expect(html).not.toMatch(/baseUrl|host\.docker\.internal|11434/i)
    expect(html).not.toMatch(/<input/i)
  })

  it('renders nothing without the server-validated eligible account and inventory', () => {
    expect(renderToStaticMarkup(createElement(LocalOllamaModelCard, { account, status: null, api: vi.fn() }))).toBe('')
    expect(renderToStaticMarkup(createElement(LocalOllamaModelCard, { account: null, status, api: vi.fn() }))).toBe('')
  })
})
