// Shared evaluation of one pricing parity case. Pure: takes the engine module
// under test, so the SAME function drives the legacy engine (apps/server) and the
// SCM kernel, and the golden file stores exactly what it returns.
export function applyOverrides(rules, overrides = []) {
  for (const { path, value } of overrides) {
    let node = rules
    for (const key of path.slice(0, -1)) node = node[key]
    node[path[path.length - 1]] = structuredClone(value)
  }
  return rules
}

export function evaluateCase(engine, testCase) {
  const rules = applyOverrides(engine.defaultPricingRules(), testCase.ruleOverrides)
  try {
    const result = engine[testCase.fn](rules, structuredClone(testCase.input))
    return { ok: true, result: JSON.parse(JSON.stringify(result)) }
  } catch (error) {
    if (error?.status !== 422) throw error
    return { ok: false, error: { status: error.status, code: error.code, field: error.field, message: error.message } }
  }
}
