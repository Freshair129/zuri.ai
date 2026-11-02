// @spec ADR-072 — dispatch the runtime-specific server bootstrap.
// @tested tests/unit/knowledge-runtime-instrumentation.test.js
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { registerNodeInstrumentation } = await import('./instrumentation-node')
  await registerNodeInstrumentation()
}
