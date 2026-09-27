// Commerce Pricing — public module API of the SCM service (semantic owner:
// Commerce, ADR-098). One evaluator: this re-exports the generated kernel copy
// of apps/server's pricing engine and adds nothing to the arithmetic, so a
// preview, a calculation and a future runtime quote all run the same code.
// Pure: no DB, no network, no environment — safe to import from any test.
export {
  EVALUATOR_VERSION,
  PRICE_DRIVERS,
  PRICING_VARIABLES,
  Decimal,
  calculatePrice,
  calculatePricingCustomization,
  decimalToSatang,
  defaultPricingRules,
  importPricingRulesYaml,
  normalizePricingInput,
  pricingHash,
  validatePricingFormula,
  validatePricingRules,
} from '../../../kernel/commerce/pricing-engine.js'
// The existing sell-side allowlist (FR-253): the only projection of a price that
// may leave Commerce toward Files/Knowledge. No second DTO is introduced here.
export { buildPricingCatalogProjection } from '../../../kernel/commerce/pricing-catalog-projection.js'
