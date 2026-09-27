// Audit entity names — the same strings the legacy domain exports, so a local
// audit row maps 1:1 onto core AuditEvent when the outbox relay lands.
export { STOCK_MOVEMENT_ENTITY, SERIAL_UNIT_ENTITY, PRODUCT_LOT_ENTITY } from '../../../kernel/inventory/inventory.js'
