// @req FR-146, FR-151, FR-152, FR-153 — stable public exports of the LINE OA Studio lane
// @spec ADR-060 D2, D3, D5, D11, ADR-061
// @tested tests/unit/line-oa-account-domain.test.js, tests/integration/fr146-line-oa-account.test.js
export {
  LINE_OA_ACCOUNT_ENTITY,
  LINE_OA_DOMAIN_KEY,
  STORED_STATUS_TRANSITIONS,
  zConnectLineOaAccount,
  zLineOaAccountAction,
  nextStoredStatus,
  initialStoredStatus,
  deriveEffectiveStatus,
  defaultTransportMode,
  parseBotProfile,
} from './domain/line-oa-account'
export { mayView, mayPublish } from './application/line-oa-account-authority'
export {
  connectLineOaAccount,
  listLineOaAccounts,
  getLineOaAccount,
  applyLineOaAccountAction,
} from './application/line-oa-account-service'
export * from './ui'
