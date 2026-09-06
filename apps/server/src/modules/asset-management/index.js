// @req FR-133, FR-134, FR-135, FR-136 — stable public exports for the Asset
// Management foundation without exposing provider or persistence internals.
// @spec ADR-055, SDD-078, SDD-079, SDD-080
// @tested tests/unit/asset-management-contract.test.js, tests/unit/asset-depreciation.test.js
export {
  ASSET_INTAKE_SCHEMA_VERSION,
  zAssetIntakeEnvelope,
  validateAssetIntake,
  findTemporalOverlaps,
} from './domain/asset-intake'
export { calculateStraightLineDepreciation } from './domain/depreciation'
