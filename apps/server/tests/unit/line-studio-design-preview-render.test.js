import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// esbuild's classic JSX runtime in Vitest reads the global React binding.
globalThis.React = React

vi.mock('@/modules/line-crm/LineCrmLiveChat', () => ({ default: () => 'Live Inbox reader' }))
vi.mock('@/modules/line-crm/LineCrmMembers', () => ({ default: () => null }))
vi.mock('@/modules/line-crm/LineCrmLoyalty', () => ({ default: () => null }))
vi.mock('@/modules/line-crm/LineCrmCampaigns', () => ({ default: () => null }))

const { default: LineStudioFlowDesigner } = await import('@/modules/line-oa-studio/ui/LineStudioFlowDesigner')
const { default: LineStudioFlexEditor } = await import('@/modules/line-oa-studio/ui/LineStudioFlexEditor')
const { default: LineStudioLiveCrm } = await import('@/modules/line-oa-studio/ui/LineStudioLiveCrm')

function render(component) {
  return renderToStaticMarkup(createElement(component, { project: { name: 'ตัวอย่างบัญชี' } }))
}

function disabledButtonMarkup(html, label) {
  const labelIndex = html.indexOf(label)
  expect(labelIndex).toBeGreaterThanOrEqual(0)
  const buttonStart = html.lastIndexOf('<button', labelIndex)
  const buttonEnd = html.indexOf('</button>', labelIndex)
  expect(buttonStart).toBeGreaterThanOrEqual(0)
  expect(buttonEnd).toBeGreaterThan(buttonStart)
  return html.slice(buttonStart, buttonEnd + '</button>'.length)
}

describe('LINE Studio local design preview rendering', () => {
  it('labels Flow as a temporary structural example and disables save and test', () => {
    const html = render(LineStudioFlowDesigner)

    expect(html).toContain('ตัวอย่างโครงสร้าง Flow ในเครื่องเท่านั้น')
    expect(html).toContain('โหนดในหน้านี้เป็นข้อมูลตัวอย่าง')
    expect(html).toContain('การแก้ไขอยู่ชั่วคราวและจะหายไปเมื่อโหลดหน้าใหม่')
    expect(disabledButtonMarkup(html, 'ทดสอบ Flow (ปิดไว้)')).toContain('disabled=""')
    expect(disabledButtonMarkup(html, 'บันทึก Flow (ปิดไว้)')).toContain('disabled=""')
    expect(html).not.toContain('Response: 200 OK')
    expect(html).not.toContain('ข้อความถูกส่งเข้าห้องแชทจำลองสำเร็จ')
    expect(html).not.toContain('บันทึกเรียบร้อย!')
  })

  it('labels Flex edits as temporary and disables save and send-test', () => {
    const html = render(LineStudioFlexEditor)

    expect(html).toContain('ตัวอย่าง Flex ในเครื่องเท่านั้น')
    expect(html).toContain('การแก้ไขจะหายไปเมื่อโหลดหน้าใหม่')
    expect(html).toContain('ปิดปุ่มบันทึกและส่งทดสอบไว้')
    expect(disabledButtonMarkup(html, 'ส่งทดสอบ (ปิดไว้)')).toContain('disabled=""')
    expect(disabledButtonMarkup(html, 'บันทึก (ปิดไว้)')).toContain('disabled=""')
    expect(html).not.toContain('ส่งไปยัง LINE แล้ว!')
    expect(html).not.toContain('บันทึกเรียบร้อย')
  })

  it('keeps the Live Inbox view without a fabricated count badge', () => {
    const html = render(LineStudioLiveCrm)

    expect(html).toContain('Live Inbox')
    expect(html).toContain('Live Inbox reader')
    expect(html).toContain('สมาชิก 360°')
    expect(html).not.toMatch(/>\s*12\s*</)
  })
})
