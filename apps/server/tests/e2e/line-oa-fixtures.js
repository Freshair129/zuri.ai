// @req FR-149 — connecting a LINE OA account through the real console is the
// precondition for every LINE OA spec, so it is expressed once.
// @spec ADR-060, ADR-061
// @tested tests/e2e/fr149-line-server-console.spec.js, tests/e2e/fr151-line-oa-rich-menu-console.spec.js

const { expect } = require('@playwright/test')

// The console asks for one Business-facing name and derives the connection
// name, account code, bot destination and secret reference from it. Two specs
// used to spell that flow out separately, so a console redesign broke both at
// once; it now lives here.
async function connectLineOaAccount(page, tag) {
  await page.goto('/line-oa/edge-connection')
  await expect(page.getByRole('heading', { name: 'บัญชี LINE และการตอบข้อความ' })).toBeVisible()

  // The connection takes its name from this field, which is what afterEach
  // deletes by, so the fixture stays test-owned.
  await page.getByLabel(/ชื่อบัญชี LINE OA/).fill(tag)

  // Everything else is auto-generated. Pin the account code anyway: the rich
  // menu selector labels accounts "<displayName> (<code>)", and a test should
  // address its fixture by a value it chose rather than by a timestamp slug.
  await page.getByRole('button', { name: /ตัวเลือกขั้นสูง/ }).click()
  await page.getByLabel(/รหัสบัญชีในระบบ/).fill(tag)

  await page.getByRole('button', { name: /เชื่อมต่อ LINE Official Account/ }).click()
  await expect(page.getByRole('heading', { name: tag })).toBeVisible()
}

// The account card is the heading's enclosing panel. Scoped by structure rather
// than styling so a class rename does not fail the spec.
function accountPanel(page, tag) {
  return page.getByRole('heading', { name: tag }).locator('xpath=../../..')
}

module.exports = { connectLineOaAccount, accountPanel }
