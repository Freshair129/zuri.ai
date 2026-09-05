const { test, expect } = require('@playwright/test')

// @req FR-066 — a person who completes their profile can identify themselves
// in Waiting Room and return to Home without gaining Workspace authority.
// @spec SDD-034, ADR-027
// @tested tests/e2e/fr066-waiting-room.spec.js

const PASSWORD = 'e2e-waiting-Passw0rd'
const addressFor = (testInfo) =>
  `waiting-${testInfo.workerIndex}-${testInfo.retry}-${testInfo.title.replace(/[^a-z]/gi, '').slice(0, 12).toLowerCase()}@example.com`

test.describe('FR-066 Waiting Room identity', () => {
  test('shows the current profile and links back to Home', async ({ page }, testInfo) => {
    const email = addressFor(testInfo)

    await page.goto('/signup')
    await page.getByLabel('ชื่อที่ใช้แสดง').fill('ผู้รอทดสอบ')
    await page.getByLabel('อีเมล').fill(email)
    await page.getByLabel('รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)', { exact: true }).fill(PASSWORD)
    await page.getByLabel('ยืนยันรหัสผ่าน', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: 'สมัครสมาชิก', exact: true }).click()
    await expect(page).toHaveURL(/\/onboarding\/profile$/)

    await page.getByLabel('ชื่อ *', { exact: true }).fill('อาหวัง')
    await page.getByLabel('นามสกุล *', { exact: true }).fill('ทดสอบ')
    await page.getByLabel('เบอร์โทรศัพท์ *', { exact: true }).fill('0812345678')
    await page.locator('input[autocomplete="nickname"]').fill('อาหวัง ทดสอบ')
    await page.getByRole('button', { name: 'บันทึกโปรไฟล์', exact: true }).click()

    await expect(page).toHaveURL(/\/waiting-room$/)
    await expect(page.getByRole('heading', { name: 'โปรไฟล์ของผู้รอ' })).toBeVisible()
    await expect(page.getByText('อาหวัง ทดสอบ', { exact: true })).toBeVisible()
    await expect(page.getByText(email, { exact: true })).toBeVisible()
    await expect(page.getByText('0812345678', { exact: true })).toBeVisible()

    const home = page.getByRole('link', { name: 'กลับหน้าแรก' })
    await expect(home).toHaveAttribute('href', '/')
    await home.click()
    await expect(page).toHaveURL(/\/$/)
  })
})
