const { test, expect } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

// @req FR-150 — the Desktop shell keeps pairing, provider and worker state usable
// while the four-panel inventory UI remains bounded at the supported sizes.
// @spec ZAI:EDGE-DESKTOP-UI-INVENTORY, FR-144, FR-141, SEC-025
// @tested apps/server/tests/e2e/edge-desktop-ui.spec.js

const publicRoot = path.resolve(__dirname, '../../..', 'edge/public')
const SUPPORTED_VIEWPORTS = [
  { name: 'wide', width: 1050, height: 680 },
  { name: 'medium', width: 960, height: 600 },
  { name: 'small', width: 800, height: 560 },
  { name: 'compact', width: 640, height: 480 },
]
const LONG = 'ข้อความทดสอบที่ยาวมากสำหรับตรวจว่ากล่องข้อความและปุ่มกู้คืนไม่หลุดออกนอกพื้นที่หน้าจอ '.repeat(8)
const desktopErrors = new WeakMap()

test.afterEach(async ({ page }) => {
  expect(desktopErrors.get(page) || [], 'Desktop must remain free of runtime errors after navigation and pending actions').toEqual([])
})

function inventory(status = 'ready') {
  if (status === 'unavailable') {
    return {
      status,
      capturedAt: '2026-09-08T15:00:00.000Z',
      computerName: null,
      os: { caption: null, version: null, architecture: null },
      cpus: [],
      memory: { installedBytes: null, osVisibleBytes: null },
      gpus: [],
      volumes: [],
      fieldErrors: { computerName: 'COMPUTER_NAME_UNAVAILABLE', os: 'OS_QUERY_FAILED' },
    }
  }
  const partial = status === 'partial'
  return {
    status,
    capturedAt: partial ? '2026-09-08T15:01:00.000Z' : '2026-09-08T15:00:00.000Z',
    computerName: partial ? null : 'ORBIT-DEV-01',
    os: partial ? { caption: 'Windows 11 Pro', version: null, architecture: '64-bit' } : {
      caption: 'Microsoft Windows 11 Pro', version: '10.0.26100', architecture: '64-bit',
    },
    cpus: partial ? [{ name: 'CPU name unavailable', physicalCores: null, logicalProcessors: null }] : [
      { name: 'AMD Ryzen 9 7950X 16-Core Processor', physicalCores: 16, logicalProcessors: 32 },
      { name: 'Synthetic second socket for pagination', physicalCores: 8, logicalProcessors: 16 },
    ],
    // Keep installed and OS-visible memory separate. This also exercises a
    // value greater than the four GiB AdapterRAM limit called out in the spec.
    memory: partial ? { installedBytes: 34359738368, osVisibleBytes: null } : {
      installedBytes: 34359738368, osVisibleBytes: 34181275648,
    },
    gpus: partial ? [{ name: null, driverVersion: null, dedicatedVramBytes: null }] : [
      { name: 'NVIDIA RTX Synthetic 16GB', driverVersion: '555.99', dedicatedVramBytes: 17179869184 },
      { name: 'Integrated Adapter With A Deliberately Long Name For Bounds', driverVersion: '31.0.1', dedicatedVramBytes: null },
    ],
    volumes: partial ? [{ driveLetter: 'C:', totalBytes: 1000000000000, freeBytes: null }] : [
      { driveLetter: 'C:', totalBytes: 1000000000000, freeBytes: 450000000000 },
      { driveLetter: 'D:', totalBytes: 2000000000000, freeBytes: 1500000000000 },
    ],
    fieldErrors: partial ? { computerName: 'COMPUTER_NAME_UNAVAILABLE', 'gpus[0].dedicatedVramBytes': 'VRAM_UNAVAILABLE' } : {},
  }
}

function desktopBridge() {
  return ({ configured = true, inventoryStatus = 'ready', modelCount = 25, longText = false, initialWorkerState = 'STOPPED', initialWorkerActive = false, holdDiscovery = false, holdWorkerStart = false, fixture = {} } = {}) => {
    const longValue = longText ? fixture.longValue : ''
    let settings = {
      provider: 'ollama',
      ollama_base_url: 'http://127.0.0.1:11434',
      ollama_model: 'local-test-01',
      codex_model: 'codex-test',
      claude_model: 'claude-test',
      allow_cloud: false,
    }
    let pairingApproved = false
    let workerState = initialWorkerState
    let workerActive = initialWorkerActive
    let workerReadError = false
    let workerStatusReads = 0
    let loginState = 'LOGGED_OUT'
    let inventoryReads = 0
    let inventoryFailure = false
    let pairingBrowserCalls = 0
    let lastPairingBrowserArgs = null
    let pairingRequestId = null
    let lastOpenedPairingRequest = null
    let discoveryRelease = null
    let workerStartRelease = null
    window.nativeCalls = []
    window.__edgeTest = {
      inventoryStatus,
      modelCount,
      completeLogin: false,
      longText,
      setWorkerReadError(value) { workerReadError = Boolean(value) },
      setInventoryFailure(value) { inventoryFailure = Boolean(value) },
      setWorkerFailed() { workerState = 'FAILED'; workerActive = true },
      get inventoryReads() { return inventoryReads },
      get workerStatusReads() { return workerStatusReads },
      get pairingBrowserCalls() { return pairingBrowserCalls },
      get lastPairingBrowserArgs() { return lastPairingBrowserArgs },
      get lastOpenedPairingRequest() { return lastOpenedPairingRequest },
      releaseWorkerStart() { workerStartRelease?.() },
      releaseDiscovery() {
        if (discoveryRelease) {
          const release = discoveryRelease
          discoveryRelease = null
          release()
        }
      },
    }
    window.__TAURI__ = { core: { invoke: async (command, args = {}) => {
      window.nativeCalls.push({ command, args })
      if (command === 'get_edge_status') return {
        device_id: 'EDGE-TEST-UUID-DO-NOT-DISPLAY',
        cloud_base_url: 'https://zuri.example',
        business_name: configured ? (longText ? longValue : 'Test Business') : '',
        configured,
        server_verified: configured,
        version: '0.3.0',
        last_heartbeat_at: '2026-09-08T15:00:00.000Z',
      }
      if (command === 'get_provider_settings') return { ...settings }
      if (command === 'save_provider_settings') { settings = { ...args.settings }; return { ...settings } }
      if (command === 'discover_ollama') {
        const count = Number(window.__edgeTest.modelCount || 0)
        const result = { models: Array.from({ length: count }, (_, index) => ({ name: `local-model-${String(index + 1).padStart(3, '0')}${longText ? `-${longValue}` : ''}` })) }
        if (!holdDiscovery) return result
        return new Promise(resolve => { discoveryRelease = () => resolve(result) })
      }
      if (command === 'get_machine_inventory') {
        inventoryReads += 1
        if (inventoryFailure) throw Error('MACHINE_INVENTORY_READ_FAILED')
        const value = JSON.parse(JSON.stringify(fixture[window.__edgeTest.inventoryStatus] || fixture.ready))
        value.capturedAt = new Date(Date.parse(value.capturedAt) + inventoryReads * 1000).toISOString()
        return value
      }
      if (command === 'get_worker_status') {
        workerStatusReads += 1
        if (workerReadError) throw Error('WORKER_STATUS_READ_FAILED')
        return { state: workerState, active: workerActive, failure: workerState === 'FAILED' ? 'WORKER_FAILED' : '', message: longText ? longValue : '' }
      }
      if (command === 'start_worker') {
        if (holdWorkerStart) await new Promise(resolve => { workerStartRelease = resolve })
        workerState = 'RUNNING'; workerActive = true
        return { state: workerState, active: workerActive }
      }
      if (command === 'stop_worker') { workerState = 'STOPPED'; workerActive = false; return { state: workerState, active: false } }
      if (command === 'start_provider_login') { loginState = 'AUTHENTICATING'; return { provider: args.provider, state: loginState, message: 'กำลังรอยืนยันในเบราว์เซอร์' } }
      if (command === 'cancel_provider_login') { loginState = 'LOGGED_OUT'; return { provider: args.provider, state: loginState, message: 'ยกเลิกแล้ว' } }
      if (command === 'get_provider_status') {
        if (window.__edgeTest.completeLogin) loginState = 'READY'
        return { provider: args.provider, state: loginState, message: loginState === 'AUTHENTICATING' ? 'กำลังรอยืนยันในเบราว์เซอร์' : `สถานะ ${args.provider}: ${loginState}` }
      }
      if (command === 'connect_zuri') { pairingRequestId = 'PAIR-REQUEST-001'; return { request_id: pairingRequestId, approval_url: 'https://zuri.example/approve/PAIR-REQUEST-001', check_code: 'ABC123', expires_at: new Date(Date.now() + 300000).toISOString(), browser_opened: true, qr_svg: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="white"/></svg>' } }
      if (command === 'open_pairing_browser') { pairingBrowserCalls += 1; lastPairingBrowserArgs = { ...args }; lastOpenedPairingRequest = pairingRequestId; return { success: true, request_id: lastOpenedPairingRequest, message: 'เปิด Browser แล้ว' } }
      if (command === 'send_heartbeat_now') return { success: true, message: 'ดำเนินการแล้ว' }
      if (command === 'poll_pairing') {
        if (args.cancel) return { state: 'CANCELLED' }
        if (!pairingApproved) return { state: 'PENDING' }
        return { state: 'PAIRED' }
      }
      if (command === 'check_headless_cli') return { success: true, message: 'พบโปรแกรม แต่ยังไม่ยืนยัน Login', version: longText ? longValue : '0.3.0' }
      if (command === 'check_app_update') return { success: false, message: 'ตัวตรวจอัปเดตยังไม่พร้อมใช้งาน' }
      if (command === 'get_app_version') return '0.3.0'
      throw Error(`Unexpected test command: ${command}`)
    } } }
    Object.defineProperty(window.__edgeTest, 'approvePairing', { set(value) { pairingApproved = Boolean(value) } })
  }
}

async function desktop(page, bridge, options = {}) {
  const pageErrors = []
  desktopErrors.set(page, pageErrors)
  page.on('pageerror', error => pageErrors.push(error.stack || error.message))
  await page.route('http://desktop.test/**', async route => {
    const file = new URL(route.request().url()).pathname.slice(1) || 'index.html'
    if (!['index.html', 'desktop.js', 'desktop.css'].includes(file)) return route.fulfill({ status: 404, body: '' })
    return route.fulfill({
      status: 200,
      body: fs.readFileSync(path.join(publicRoot, file)),
      contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html',
    })
  })
  if (bridge) await page.addInitScript(bridge, {
    ...options,
    fixture: { ready: inventory('ready'), partial: inventory('partial'), unavailable: inventory('unavailable'), longValue: LONG },
  })
  await page.goto('http://desktop.test')
  await page.waitForLoadState('domcontentloaded')
  expect(pageErrors, `desktop runtime page errors: ${pageErrors.join('\n')}`).toEqual([])
}

async function expectBounded(page) {
  const result = await page.evaluate(() => {
    const viewport = {
      width: Math.round(window.visualViewport?.width || document.documentElement.clientWidth),
      height: Math.round(window.visualViewport?.height || document.documentElement.clientHeight),
    }
    const visible = [...document.querySelectorAll('button,input,select,textarea,label,dt,dd,[class*="label"],[role="tab"],[role="heading"],[role="alert"],[role="status"],.muted,.feedback,.panel-message,.diagnostic-result,.footer-error,.footer-message,.version-value,.count-label,.state-label')]
      .filter(element => !element.hidden && element.getClientRects().length > 0 && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden')
    const elements = visible.map(element => {
      const rect = element.getBoundingClientRect()
      return { tag: element.tagName, id: element.id, text: element.textContent?.trim().slice(0, 80), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    })
    const smallControls = visible
      .filter(element => ['BUTTON', 'SELECT', 'TEXTAREA'].includes(element.tagName) || (element.tagName === 'INPUT' && !['checkbox', 'radio', 'file'].includes(element.type)))
      .map(element => ({ id: element.id, tag: element.tagName, height: element.getBoundingClientRect().height }))
      .filter(element => element.height < 44)
    const smallHitAreas = visible
      .filter(element => element.tagName === 'INPUT' && ['checkbox', 'radio', 'file'].includes(element.type))
      .map(element => {
        const hitArea = element.closest('label') || element
        const rect = hitArea.getBoundingClientRect()
        return { id: element.id, label: hitArea.textContent?.trim().slice(0, 80), width: rect.width, height: rect.height }
      })
      .filter(element => element.width < 44 || element.height < 44)
    const smallLabels = visible
      .filter(element => element.tagName === 'LABEL' || ['DT', 'DD'].includes(element.tagName) || element.className?.toString().split(/\s+/).some(name => name.endsWith('-label') || name === 'label'))
      .map(element => ({ id: element.id, text: element.textContent?.trim().slice(0, 80), fontSize: parseFloat(getComputedStyle(element).fontSize) }))
      .filter(element => element.fontSize < 13)
    const clipped = []
    for (const element of visible) {
      const rect = element.getBoundingClientRect()
      for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor)
        if (!['hidden', 'clip'].includes(style.overflow) && !['hidden', 'clip'].includes(style.overflowX) && !['hidden', 'clip'].includes(style.overflowY)) continue
        const parentRect = ancestor.getBoundingClientRect()
        if (rect.left < parentRect.left - 1 || rect.right > parentRect.right + 1 || rect.top < parentRect.top - 1 || rect.bottom > parentRect.bottom + 1) {
          clipped.push({ id: element.id, text: element.textContent?.trim().slice(0, 70), ancestor: ancestor.id || ancestor.tagName,
            bounds: { top: rect.top, bottom: rect.bottom }, parentBounds: { top: parentRect.top, bottom: parentRect.bottom } })
          break
        }
      }
    }
    const overflowContainers = [document.documentElement, document.body, ...document.querySelectorAll('*')]
      .filter(element => {
        const style = getComputedStyle(element)
        const visible = element === document.documentElement || (!element.hidden && style.display !== 'none' && style.visibility !== 'hidden')
        const scrollable = ['auto', 'scroll'].includes(style.overflowX) || ['auto', 'scroll'].includes(style.overflowY)
        return visible && scrollable && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
      })
      .map(element => ({ id: element.id, tag: element.tagName, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }))
    return { viewport, bodyFontSize: parseFloat(getComputedStyle(document.body).fontSize), scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, overflowContainers, smallControls, smallHitAreas, smallLabels, clipped, elements }
  })
  expect(result.scrollWidth, `horizontal overflow at ${result.viewport.width}x${result.viewport.height}`).toBeLessThanOrEqual(result.viewport.width + 1)
  expect(result.scrollHeight, `vertical overflow at ${result.viewport.width}x${result.viewport.height}`).toBeLessThanOrEqual(result.viewport.height + 1)
  expect(result.overflowContainers, `scrollable containers found: ${JSON.stringify(result.overflowContainers)}`).toEqual([])
  expect(result.smallControls, `interactive controls below 44px: ${JSON.stringify(result.smallControls)}`).toEqual([])
  expect(result.smallHitAreas, `checkbox/radio/file hit areas below 44px: ${JSON.stringify(result.smallHitAreas)}`).toEqual([])
  expect(result.smallLabels, `labels below 13px: ${JSON.stringify(result.smallLabels)}`).toEqual([])
  expect(result.bodyFontSize, 'body text must remain at least 14px').toBeGreaterThanOrEqual(14)
  expect(result.clipped, `visible content clipped by ancestor: ${JSON.stringify(result.clipped)}`).toEqual([])
  for (const element of result.elements) {
    expect(element.left, `${element.tag} starts outside viewport: ${element.text}`).toBeGreaterThanOrEqual(-1)
    expect(element.right, `${element.tag} ends outside viewport: ${element.text}`).toBeLessThanOrEqual(result.viewport.width + 1)
    expect(element.top, `${element.tag} starts below viewport: ${element.text}`).toBeGreaterThanOrEqual(-1)
    expect(element.bottom, `${element.tag} ends below viewport: ${element.text}`).toBeLessThanOrEqual(result.viewport.height + 1)
  }
}

async function expectNativeActionDisabled(page) {
  const selectors = [
    '#connect', '#saveProvider', '#providerLogin', '#providerCheck', '#discoverModels',
    '#openModelPicker',
    '#startWorker', '#stopWorker', '#globalStop', '#checkCli', '#checkUpdate',
    '#hardwareRefresh', '#hardwarePageRefresh', '[data-testid="hardware-refresh"]', '[data-testid="global-stop-worker"]',
  ]
  for (const selector of selectors) {
    const control = page.locator(`${selector}:visible`).first()
    if (await control.count() && await control.isVisible()) await expect(control).toBeDisabled()
  }
}

async function emulateTextZoom(page, factor = 2) {
  return page.evaluate(factor => {
    const nodes = [...document.querySelectorAll('body,h1,h2,h3,h4,p,dt,dd,label,button,input,select,textarea,span,strong,small,[role="tab"],[role="status"],[role="alert"]')]
      .filter(element => !element.hidden && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden')
    // A second visit scales newly created controls too, without turning the
    // existing shell from 200% into 400%. Restore all baselines before measuring
    // so nested inherited fonts are never multiplied twice.
    window.__edgeOriginalTextStyles ||= new WeakMap()
    for (const element of nodes) {
      if (!window.__edgeOriginalTextStyles.has(element)) {
        window.__edgeOriginalTextStyles.set(element, { fontSize: element.style.fontSize, lineHeight: element.style.lineHeight })
      }
      const original = window.__edgeOriginalTextStyles.get(element)
      element.style.fontSize = original.fontSize
      element.style.lineHeight = original.lineHeight
    }
    const metrics = nodes.map(element => {
      const style = getComputedStyle(element)
      return { element, size: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight) }
    }).filter(metric => Number.isFinite(metric.size))
    const before = metrics.map(metric => metric.size)
    for (const metric of metrics) {
      metric.element.style.fontSize = `${metric.size * factor}px`
      if (Number.isFinite(metric.lineHeight)) metric.element.style.lineHeight = `${metric.lineHeight * factor}px`
    }
    const after = metrics.map(metric => parseFloat(getComputedStyle(metric.element).fontSize))
    return { before, after, ratio: after.length && before.length ? Math.min(...after.map((size, index) => size / before[index])) : 0 }
  }, factor)
}

async function captureDesign(page, name) {
  const output = path.resolve(__dirname, '../../../edge/dist-desktop/verification-tabs/desktop-ui-design')
  fs.mkdirSync(output, { recursive: true })
  await page.screenshot({ path: path.join(output, name), fullPage: false })
}

async function reachControl(page, selector, nextSelector) {
  for (let step = 0; step < 20; step += 1) {
    await expectBounded(page)
    if (await page.locator(selector).isVisible()) return
    const next = page.locator(nextSelector)
    await expect(next, `next page must expose ${selector}`).toBeVisible()
    await expect(next).toBeEnabled()
    await next.click()
  }
  throw new Error(`Could not reach ${selector} through task pages`)
}

async function openHardwarePage(page) {
  await page.getByRole('tab', { name: 'ภาพรวม' }).click()
  const hardware = page.locator('#hardwareOpen:visible')
  const next = page.locator('#overviewCompactNext:visible')
  for (let attempt = 0; attempt < 3 && !(await hardware.count()); attempt += 1) {
    if (!(await next.count()) || await next.isDisabled()) break
    await next.click()
  }
  await expect(hardware).toBeVisible()
  await hardware.click()
}

async function collectDetailText(page) {
  const chunks = []
  for (;;) {
    await expect(page.locator('#detailPage')).toBeVisible()
    const bounds = await page.evaluate(() => {
      const content = document.querySelector('#detailContent')
      const paragraph = content?.querySelector('p')
      if (!content || !paragraph) return null
      const contentRect = content.getBoundingClientRect()
      const paragraphRect = paragraph.getBoundingClientRect()
      const style = getComputedStyle(content)
      return {
        contentTop: contentRect.top,
        contentBottom: contentRect.bottom,
        paragraphTop: paragraphRect.top,
        paragraphBottom: paragraphRect.bottom,
        paddingTop: parseFloat(style.paddingTop) || 0,
        paddingBottom: parseFloat(style.paddingBottom) || 0,
        clientHeight: content.clientHeight,
        scrollHeight: content.scrollHeight,
      }
    })
    expect(bounds, 'detail content paragraph must exist').not.toBeNull()
    expect(bounds.paragraphTop, 'detail paragraph starts above its card').toBeGreaterThanOrEqual(bounds.contentTop + bounds.paddingTop - 1)
    expect(bounds.paragraphBottom, 'detail paragraph ends below its card').toBeLessThanOrEqual(bounds.contentBottom - bounds.paddingBottom + 1)
    expect(bounds.scrollHeight, 'detail card must not clip its paragraph').toBeLessThanOrEqual(bounds.clientHeight + 1)
    await expectBounded(page)
    chunks.push(await page.locator('#detailContent p').textContent())
    const next = page.locator('#detailNext')
    if (await next.isDisabled()) break
    await next.click()
  }
  return chunks.join('')
}

async function rewindDetail(page) {
  const previous = page.locator('#detailPrev')
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await previous.isDisabled()) return
    await previous.click()
  }
  throw new Error('detail pagination did not reach its first page within 100 steps')
}

test('browser preview fails closed without native IPC', async ({ page }) => {
  await desktop(page)
  await expect(page.locator('#statusBadge')).toHaveText(/Browser preview|IPC unavailable/i)
  await expect(page.locator('#hardwareStatus')).toHaveText(/Unavailable|ไม่พร้อม/i)
  await expectNativeActionDisabled(page)
  await expect(page.locator('[role="tablist"]')).toBeVisible()
})

test('ARIA tabs use manual activation and retain drafts, pairing and login state', async ({ page }) => {
  await desktop(page, desktopBridge(), { configured: false })
  const tabs = page.getByRole('tab')
  await expect(tabs).toHaveCount(4)
  await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1)
  await tabs.filter({ hasText: 'ภาพรวม' }).click()
  await expect(tabs.filter({ hasText: 'ภาพรวม' })).toHaveAttribute('aria-selected', 'true')
  await tabs.filter({ hasText: 'ภาพรวม' }).focus()
  await tabs.filter({ hasText: 'ภาพรวม' }).press('ArrowRight')
  await expect(tabs.filter({ hasText: 'เชื่อมต่อ' })).toBeFocused()
  await expect(tabs.filter({ hasText: 'ภาพรวม' })).toHaveAttribute('aria-selected', 'true')
  await tabs.filter({ hasText: 'ตัวช่วย AI' }).focus()
  await tabs.filter({ hasText: 'ตัวช่วย AI' }).press('Enter')
  await page.locator('#providerClaude').check()
  await page.locator('#providerModel').fill('claude-draft-model')
  await tabs.filter({ hasText: 'เชื่อมต่อ' }).click()
  await page.locator('#connect').click()
  await expect(page.locator('#checkCode')).toHaveText('ABC123')
  await page.locator('#openBrowser').click()
  await expect.poll(() => page.evaluate(() => window.__edgeTest.pairingBrowserCalls)).toBe(1)
  await expect.poll(() => page.evaluate(() => window.__edgeTest.lastPairingBrowserArgs)).toEqual({})
  await expect.poll(() => page.evaluate(() => window.__edgeTest.lastOpenedPairingRequest)).toBe('PAIR-REQUEST-001')
  await tabs.filter({ hasText: 'ภาพรวม' }).click()
  await tabs.filter({ hasText: 'เชื่อมต่อ' }).click()
  await expect(page.locator('#checkCode')).toBeVisible()
  await page.locator('#cancel').click()
  await expect(page.locator('#pairingState')).toContainText(/ยกเลิก|CANCELLED/)
  await tabs.filter({ hasText: 'ตัวช่วย AI' }).click()
  await expect(page.locator('#providerModel')).toHaveValue('claude-draft-model')
  await page.locator('#providerLogin').click()
  await expect(page.locator('#providerAuth')).toContainText('กำลังรอยืนยัน')
  await tabs.filter({ hasText: 'ภาพรวม' }).click()
  await tabs.filter({ hasText: 'ตัวช่วย AI' }).click()
  await expect(page.locator('#providerAuth')).toContainText('กำลังรอยืนยัน')
  await expect(page.locator('#cancelLogin')).toBeVisible()
  await page.locator('#cancelLogin').click()
  await expect(page.locator('#cancelLogin')).toBeHidden()
  await expect(page.locator('#providerAuth')).toContainText(/ยกเลิกแล้ว|ยังไม่ได้ตรวจบัญชี|LOGGED_OUT/)
  const loginCallsBeforeRetry = await page.evaluate(() => window.nativeCalls.filter(call => call.command === 'start_provider_login').length)
  await page.locator('#providerLogin').click()
  await expect(page.locator('#providerAuth')).toContainText('กำลังรอยืนยัน')
  await expect.poll(() => page.evaluate(() => window.nativeCalls.filter(call => call.command === 'start_provider_login').length)).toBe(loginCallsBeforeRetry + 1)
})

test('provider drafts remain independent and Save never starts the worker', async ({ page }) => {
  await desktop(page, desktopBridge(), { configured: true })
  await page.getByRole('tab', { name: 'ตัวช่วย AI' }).click()
  await page.locator('#ollamaUrl').fill('http://127.0.0.1:11435')
  await page.locator('#providerCodex').check()
  await page.locator('#providerModel').fill('codex-draft')
  await page.locator('#providerClaude').check()
  await page.locator('#providerModel').fill('claude-draft')
  await page.locator('#providerCodex').check()
  await expect(page.locator('#providerModel')).toHaveValue('codex-draft')
  await page.locator('#saveProvider').click()
  await expect(page.locator('#providerMessage, #providerSaveState').filter({ hasText: /บันทึก|saved/i }).first()).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.nativeCalls.filter(call => call.command === 'start_worker').length)).toBe(0)
  const lastSave = await page.evaluate(() => window.nativeCalls.filter(call => call.command === 'save_provider_settings').at(-1))
  expect(lastSave.args.settings.ollama_base_url).toBe('http://127.0.0.1:11434')
  await page.locator('#providerOllama').check()
  await expect(page.locator('#ollamaUrl')).toHaveValue('http://127.0.0.1:11435')
  await page.locator('#providerClaude').check()
  await expect(page.locator('#providerModel')).toHaveValue('claude-draft')
  await page.locator('#providerCodex').check()
  await expect(page.locator('#providerModel')).toHaveValue('codex-draft')
})

test('switching from a cloud provider to Ollama clears cloud permission on save', async ({ page }) => {
  await desktop(page, desktopBridge(), { configured: true })
  await page.getByRole('tab', { name: 'ตัวช่วย AI' }).click()
  await page.locator('#providerCodex').check()
  await page.locator('#providerModel').fill('codex-cloud-draft')
  await page.locator('#allowCloud').check()
  await page.locator('#saveProvider').click()
  await expect(page.locator('#providerMessage')).toContainText(/บันทึกแล้ว|saved/i)
  await page.locator('#providerOllama').check()
  await page.locator('#saveProvider').click()
  await expect(page.locator('#providerMessage')).toContainText(/บันทึกแล้ว|saved/i)
  const saves = await page.evaluate(() => window.nativeCalls.filter(call => call.command === 'save_provider_settings'))
  expect(saves.at(-1)?.args?.settings?.provider).toBe('ollama')
  expect(saves.at(-1)?.args?.settings?.allow_cloud).toBe(false)
})

test('provider model mutations stay locked during pairing, active work and discovery', async ({ page }) => {
  const pairingPage = await page.context().newPage()
  await desktop(pairingPage, desktopBridge(), { configured: false })
  await pairingPage.locator('#connect').click()
  await expect(pairingPage.locator('#pairingState')).toContainText(/รอยืนยัน|WAITING/)
  await pairingPage.getByRole('tab', { name: 'ตัวช่วย AI' }).click()
  for (const selector of ['#discoverModels', '#openModelPicker', '#saveProvider', '#providerOllama']) {
    await expect(pairingPage.locator(selector)).toBeDisabled()
  }
  await pairingPage.close()

  await desktop(page, desktopBridge(), { configured: true, initialWorkerState: 'RUNNING', initialWorkerActive: true })
  await page.getByRole('tab', { name: 'ตัวช่วย AI' }).click()
  for (const selector of ['#discoverModels', '#openModelPicker', '#saveProvider', '#providerOllama']) {
    await expect(page.locator(selector)).toBeDisabled()
  }

  const busyPage = await page.context().newPage()
  await desktop(busyPage, desktopBridge(), { configured: true, holdDiscovery: true })
  await busyPage.getByRole('tab', { name: 'ตัวช่วย AI' }).click()
  await busyPage.locator('#discoverModels').click()
  await expect(busyPage.locator('#discoverModels')).toBeDisabled()
  await expect(busyPage.locator('#openModelPicker')).toBeDisabled()
  await expect(busyPage.locator('#providerOllama')).toBeDisabled()
  await busyPage.evaluate(() => window.__edgeTest.releaseDiscovery())
  await expect(busyPage.locator('#discoverModels')).toBeEnabled()
  await busyPage.close()
})

test('provider settings remain locked while worker Start is pending across tabs', async ({ page }) => {
  await desktop(page, desktopBridge(), { holdWorkerStart: true })
  await page.getByRole('tab', { name: 'ตัวช่วย AI' }).click()
  await page.locator('#startWorker').click()
  await expect(page.locator('#startWorker')).toBeDisabled()
  await page.getByRole('tab', { name: 'ตั้งค่า' }).click()
  await page.getByRole('tab', { name: 'ตัวช่วย AI' }).click()
  for (const selector of ['#saveProvider', '#providerCodex', '#discoverModels', '#openModelPicker', '#providerCheck']) {
    await expect(page.locator(selector)).toBeDisabled()
  }
  await page.evaluate(() => window.__edgeTest.releaseWorkerStart())
  await expect(page.locator('#globalStop')).toBeEnabled()
  await page.locator('#globalStop').click()
  await expect(page.locator('#saveProvider')).toBeEnabled()
})

test('global Stop remains available for FAILED ownership and worker status read errors', async ({ page }) => {
  await desktop(page, desktopBridge(), { configured: true, initialWorkerState: 'FAILED', initialWorkerActive: true })
  const stop = page.locator('#globalStop:visible, #stopWorker:visible, [data-testid="global-stop-worker"]:visible').first()
  await expect(stop).toBeEnabled()
  await page.getByRole('tab', { name: 'ตั้งค่า' }).click()
  await expect(page.locator('#globalStop:visible, #stopWorker:visible, [data-testid="global-stop-worker"]:visible').first()).toBeEnabled()
  const readsBeforeError = await page.evaluate(() => window.__edgeTest.workerStatusReads)
  await page.evaluate(() => window.__edgeTest.setWorkerReadError(true))
  await page.getByRole('tab', { name: 'ภาพรวม' }).click()
  await expect.poll(() => page.evaluate(() => window.__edgeTest.workerStatusReads)).toBeGreaterThan(readsBeforeError)
  await expect(page.locator('#globalStop:visible, #stopWorker:visible, [data-testid="global-stop-worker"]:visible').first()).toBeEnabled()
  await expect(page.getByText(/WORKER_STATUS_READ_FAILED|ตรวจสถานะตัวประมวลผลไม่ได้|อ่านสถานะ/).first()).toBeVisible()
  await page.getByRole('tab', { name: 'ตัวช่วย AI' }).click()
  await expect(page.locator('#startWorker:visible')).toBeDisabled()
  await expect(page.locator('#workerState')).not.toContainText(/กำลังรับงานจาก Zuri|พร้อมตรวจแล้ว|READY/)
  await page.evaluate(() => window.__edgeTest.setWorkerReadError(false))
  await stop.click()
  await expect(page.locator('#workerState')).toContainText(/หยุด|STOPPED/)
})

for (const previousState of ['RUNNING', 'STOPPED']) {
  test(`worker read failure invalidates ${previousState} readiness without losing ownership`, async ({ page }) => {
    const owned = previousState === 'RUNNING'
    await desktop(page, desktopBridge(), { configured: true, initialWorkerState: previousState, initialWorkerActive: owned })
    await expect.poll(() => page.evaluate(() => window.__edgeTest.workerStatusReads)).toBeGreaterThan(0)
    if (!owned) await expect(page.locator('#overviewStart')).toBeEnabled()
    else await expect(page.locator('#globalStop')).toBeEnabled()
    const before = await page.evaluate(() => window.__edgeTest.workerStatusReads)
    await page.evaluate(() => window.__edgeTest.setWorkerReadError(true))
    await page.getByRole('tab', { name: 'ตั้งค่า' }).click()
    await page.getByRole('tab', { name: 'ภาพรวม' }).click()
    await expect.poll(() => page.evaluate(() => window.__edgeTest.workerStatusReads)).toBeGreaterThan(before)
    await expect(page.locator('#overviewFeedback')).toContainText('WORKER_STATUS_READ_FAILED')
    await expect(page.locator('#workerState')).toContainText('ยังยืนยันสถานะไม่ได้')
    await expect(page.locator('#overviewStart')).toBeDisabled()
    if (owned) await expect(page.locator('#globalStop')).toBeEnabled()
    else await expect(page.locator('#globalStop')).toBeDisabled()
    await page.evaluate(() => runWorker('start_worker'))
    expect(await page.evaluate(() => window.nativeCalls.filter(call => call.command === 'start_worker').length)).toBe(0)
  })
}

test('hardware inventory starts before pairing, refreshes, and separates computer name from device UUID', async ({ page }) => {
  await desktop(page, desktopBridge(), { configured: false, inventoryStatus: 'ready' })
  await expect.poll(() => page.evaluate(() => window.__edgeTest.inventoryReads)).toBeGreaterThanOrEqual(1)
  await expect(page.locator('#computerName')).toHaveText('ORBIT-DEV-01')
  await expect(page.locator('#computerName')).not.toHaveText('EDGE-TEST-UUID-DO-NOT-DISPLAY')
  await expect(page.locator('#device')).toHaveText('EDGE-TEST-UUID-DO-NOT-DISPLAY')
  await page.getByRole('tab', { name: 'ภาพรวม' }).click()
  const before = await page.evaluate(() => window.__edgeTest.inventoryReads)
  await page.locator('#hardwareRefresh:visible, #hardwarePageRefresh:visible').first().click()
  await expect.poll(() => page.evaluate(() => window.__edgeTest.inventoryReads)).toBe(before + 1)
  await expect(page.locator('#hardwareMemorySummary')).toContainText(/32[.,]0|GiB|ติดตั้ง/)
  await page.locator('#hardwareOpen').click()
  await page.locator('#hardwareNext').click()
  await expect(page.locator('#hardwareContent')).toContainText('AMD Ryzen')
  await expect(page.locator('#hardwareContent')).not.toContainText('ไม่พบข้อมูล CPU')
})

test('hardware keeps the last-good inventory visible when a recheck fails', async ({ page }) => {
  await desktop(page, desktopBridge(), { configured: false, inventoryStatus: 'ready' })
  await expect.poll(() => page.evaluate(() => window.__edgeTest.inventoryReads)).toBeGreaterThanOrEqual(1)
  await expect(page.locator('#computerName')).toHaveText('ORBIT-DEV-01')
  await page.getByRole('tab', { name: 'ภาพรวม' }).click()
  const readsBeforeFailure = await page.evaluate(() => window.__edgeTest.inventoryReads)
  await page.evaluate(() => window.__edgeTest.setInventoryFailure(true))
  await page.locator('#hardwareRefresh:visible, #hardwarePageRefresh:visible').first().click()
  await expect.poll(() => page.evaluate(() => window.__edgeTest.inventoryReads)).toBe(readsBeforeFailure + 1)
  await expect(page.locator('#computerName')).toHaveText('ORBIT-DEV-01')
  await expect(page.locator('#hardwareStatus')).toContainText(/snapshot เก่า|เก่า|stale/i)
  await expect(page.locator('#overviewFeedback')).toContainText(/MACHINE_INVENTORY_READ_FAILED|อ่านสเปคเครื่องไม่ได้|stale|เก่า/i)
})

test('hardware null and partial fields are explicit and do not become fake zero values', async ({ page }) => {
  await desktop(page, desktopBridge(), { configured: false, inventoryStatus: 'partial' })
  await expect(page.getByText(/อ่านชื่อเครื่องไม่ได้|ไม่พร้อม|partial|บางส่วน/).first()).toBeVisible()
  await openHardwarePage(page)
  await expect(page.locator('#hardwarePageStatus')).toContainText(/บางรายการอ่านไม่ได้|ไม่สามารถอ่าน/i)
  await expect(page.locator('#hardwareContent')).toContainText(/ไม่พร้อมใช้งาน|ไม่มีข้อมูล/)
  await expect(page.getByText(/^0$/)).toHaveCount(0)
})

test('approved mock IPC UI reference screenshots cover overview, compact AI, hardware and text zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1050, height: 680 })
  await desktop(page, desktopBridge(), { configured: true, modelCount: 25 })
  await expect(page.getByRole('tab', { name: 'ภาพรวม' })).toHaveAttribute('aria-selected', 'true')
  await captureDesign(page, 'overview-1050x680.png')

  await page.setViewportSize({ width: 640, height: 480 })
  await page.getByRole('tab', { name: 'ตัวช่วย AI' }).click()
  await expect(page.locator('#providerOllama')).toBeVisible()
  await expect(page.locator('#aiCompactNext')).toBeVisible()
  await page.locator('#aiCompactNext').click()
  await expect(page.locator('#ollamaUrl')).toBeVisible()
  await expect(page.locator('#discoverModels')).toBeVisible()
  await page.locator('#aiCompactPrev').click()
  await page.locator('#providerCodex').check()
  await expect(page.locator('#providerModel')).toBeVisible()
  await expect(page.locator('#providerLogin')).toBeVisible()
  await captureDesign(page, 'ai-640x480.png')
  await expectBounded(page)
  await openHardwarePage(page)
  await expect(page.locator('#hardwarePage')).toBeVisible()
  await captureDesign(page, 'hardware-640x480.png')
  await expectBounded(page)

  await emulateTextZoom(page, 2)
  await captureDesign(page, 'text-zoom-200-640x480.png')
  await expect(page.locator('#hardwarePage')).toBeVisible()
  await expectBounded(page)
})

test('long CLI details preserve every character across pagination resize and text zoom', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 560 })
  await desktop(page, desktopBridge(), { configured: true, longText: true })
  await page.getByRole('tab', { name: 'ตั้งค่า' }).click()
  await page.locator('#openCli').click()
  await page.locator('#checkCli').click()
  const cliNext = page.locator('#cliCompactNext:visible')
  if (await cliNext.count() && !await cliNext.isDisabled()) await cliNext.click()
  await expect(page.locator('#cliDetails')).toBeVisible()
  await page.locator('#cliDetails').click()
  await expect(page.locator('#detailPage')).toBeVisible()

  const expected = LONG
  expect(await collectDetailText(page)).toBe(expected)

  await page.setViewportSize({ width: 640, height: 480 })
  await page.waitForTimeout(100)
  await rewindDetail(page)
  expect(await collectDetailText(page)).toBe(expected)

  await rewindDetail(page)
  const zoom = await emulateTextZoom(page, 2)
  expect(zoom.ratio).toBeCloseTo(2, 1)
  await page.waitForTimeout(100)
  expect(await collectDetailText(page)).toBe(expected)
})

test('model and hardware lists paginate 25 and 100 records without scroll', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 560 })
  await desktop(page, desktopBridge(), { configured: true, modelCount: 25, longText: true })
  await page.getByRole('tab', { name: 'ตัวช่วย AI' }).click()
  const aiNext = page.locator('#aiCompactNext:visible')
  if (await aiNext.count() && !await aiNext.isDisabled()) await aiNext.click()
  await page.locator('#discoverModels').click()
  await page.locator('#openModelPicker').click()
  await expect(page.locator('#modelResults [role="option"]')).toHaveCount(3)
  await expectBounded(page)
  await page.locator('#modelResults [data-model-detail^="local-model-001-"]').click()
  expect(await collectDetailText(page)).toBe(`local-model-001-${LONG}`)
  await page.locator('#detailBack').click()
  await expect(page.locator('#modelResults .model-result-select').first()).toBeVisible()
  await expect(page.locator('#modelNext')).toBeEnabled()
  await page.locator('#modelNext').click()
  await expect(page.locator('#modelResults')).toContainText('local-model-004')
  await openHardwarePage(page)
  await expect(page.locator('#hardwareContent > *').first()).toBeVisible()
  await page.locator('#hardwareNext').click()
  await expect(page.locator('#hardwareContent > *').first()).toBeVisible()
  await page.evaluate(() => { window.__edgeTest.modelCount = 100 })
  await page.getByRole('tab', { name: 'ตัวช่วย AI' }).click()
  await page.locator('#modelBack').click()
  await page.locator('#discoverModels').click()
  await page.locator('#openModelPicker').click()
  await expect(page.locator('#modelResults [role="option"]')).toHaveCount(3)
  await expectBounded(page)
})

test.describe('supported viewport bounds with long content', () => {
  for (const size of SUPPORTED_VIEWPORTS) {
    test(`${size.name} ${size.width}x${size.height} keeps controls and feedback in view`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await desktop(page, desktopBridge(), { configured: true, modelCount: 100, longText: true })
      await expectBounded(page)
      const overviewNext = page.locator('#overviewCompactNext:visible')
      while (await overviewNext.count() && !await overviewNext.isDisabled()) {
        await overviewNext.click()
        await expectBounded(page)
      }
      await page.getByRole('tab', { name: 'ตั้งค่า' }).click()
      await expectBounded(page)
      await page.locator('#openAbout').click()
      await expect(page.locator('#appVersion')).toHaveText('0.3.0')
      await expectBounded(page)
      await reachControl(page, '#checkUpdate', '#aboutCompactNext')
      await page.locator('#checkUpdate').click()
      await expect(page.locator('#updateDiagnostics')).toContainText(/อัปเดต|ไม่พร้อม|update/i)
      await expectBounded(page)
      await page.getByRole('tab', { name: 'ตัวช่วย AI' }).click()
      await reachControl(page, '#openModelPicker', '#aiCompactNext')
      await page.locator('#openModelPicker').click()
      await expectBounded(page)
    })
  }
})

test('Connect and Settings subpages retain their controls at 200% text', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 })
  await desktop(page, desktopBridge(), { configured: false })
  await emulateTextZoom(page)
  await reachControl(page, '#connect', '#connectCompactNext')
  await page.getByRole('tab', { name: 'ตั้งค่า' }).click()
  await expectBounded(page)
  for (const [entry, next, back, controls] of [
    ['openAdvanced', 'advancedCompactNext', 'advancedBack', ['baseUrl', 'pairingFile']],
    ['openCli', 'cliCompactNext', 'cliBack', ['cli', 'checkCli']],
    ['openAbout', 'aboutCompactNext', 'aboutBack', ['appVersion', 'checkUpdate']],
  ]) {
    await page.locator(`#${entry}`).click()
    const remaining = new Set(controls)
    for (let index = 0; index < 20; index += 1) {
      await emulateTextZoom(page)
      await expectBounded(page)
      for (const id of [...remaining]) if (await page.locator(`#${id}`).isVisible()) remaining.delete(id)
      if (await page.locator(`#${next}`).isDisabled()) break
      await page.locator(`#${next}`).click()
    }
    expect([...remaining], `${entry} controls must remain reachable`).toEqual([])
    await page.locator(`#${back}`).click()
  }
})

for (const provider of ['Ollama', 'Codex', 'Claude']) {
  test(`${provider} configuration and Save remain reachable at 200% text`, async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 480 })
    await desktop(page, desktopBridge())
    await page.getByRole('tab', { name: 'ตัวช่วย AI' }).click()
    await emulateTextZoom(page)
    await reachControl(page, `#provider${provider}`, '#aiCompactNext')
    await page.locator(`#provider${provider}`).check()
    while (await page.locator('#aiCompactPrev').isEnabled()) await page.locator('#aiCompactPrev').click()
    const required = new Set(provider === 'Ollama'
      ? ['ollamaUrl', 'discoverModels', 'openModelPicker', 'saveProvider', 'startWorker']
      : ['providerModel', 'providerLogin', 'providerCheck', 'allowCloud', 'saveProvider', 'startWorker'])
    for (let index = 0; index < 20; index += 1) {
      await expectBounded(page)
      for (const id of [...required]) if (await page.locator(`#${id}`).isVisible()) required.delete(id)
      if (await page.locator('#aiCompactNext').isDisabled()) break
      await page.locator('#aiCompactNext').click()
    }
    expect([...required], 'every configuration action must be reachable without scrolling').toEqual([])
  })
}

test('all compact Overview pages remain reachable at 200% text', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 })
  await desktop(page, desktopBridge(), { longText: true })
  await emulateTextZoom(page)
  for (let index = 0; index < 15; index += 1) {
    await expectBounded(page)
    if (await page.locator('#overviewCompactNext').isDisabled()) break
    await page.locator('#overviewCompactNext').click()
  }
  await expect(page.locator('#hardwareOpen')).toBeVisible()
  await page.locator('#hardwareOpen').click()
  for (let index = 0; index < 30; index += 1) {
    await emulateTextZoom(page)
    await expectBounded(page)
    if (await page.locator('#hardwareNext').isDisabled()) break
    await page.locator('#hardwareNext').click()
  }
  await expect(page.locator('#hardwareNext')).toBeDisabled()
})

test('200% text zoom emulation preserves actual visual scale and bounds', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 })
  await desktop(page, desktopBridge(), { configured: true, modelCount: 25, longText: true })
  const zoom = await emulateTextZoom(page, 2)
  expect(zoom.ratio).toBeCloseTo(2, 1)
  await expectBounded(page)
  await page.getByRole('tab', { name: 'ตัวช่วย AI' }).click()
  const aiZoom = await emulateTextZoom(page, 2)
  expect(aiZoom.ratio).toBeCloseTo(2, 1)
  await reachControl(page, '#openModelPicker', '#aiCompactNext')
  await page.locator('#openModelPicker').click()
  await expectBounded(page)
})
