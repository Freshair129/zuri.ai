// @req FR-144 — one Console export shape, also consumed by the native Desktop parser.
// @spec SEC-025
// @tested tests/unit/edge-pairing-download.test.js
export function edgePairingDownload({ credential, key, businessId, businessCode, businessName, origin }) {
  return {
    deviceId:credential.deviceId, key, businessId, businessCode:businessCode || null,
    businessName:businessName || null, apiBaseUrl:origin, generatedAt:credential.createdAt,
    instructions:'บันทึกกุญแจนี้ลงใน Zuri Edge Device (ZURI_EDGE_DEVICE_KEY) — ระบบจะไม่แสดงอีก',
  }
}
