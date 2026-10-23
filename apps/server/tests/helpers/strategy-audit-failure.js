// @req FR-268, FR-269, FR-270 — real transaction rollback when audit insertion fails.
// @spec SEC-003, ADR-101
// @tested tests/integration/fr268-business-key-result-mutation.test.js
// @tested tests/integration/fr269-business-kpi-mutation.test.js
// @tested tests/integration/fr270-business-wig-execution.test.js
export function failStrategyAudit(db) {
  return new Proxy(db, { get(target, key) {
    if (key === '$transaction') return (callback, settings) => target.$transaction(tx => callback(new Proxy(tx, { get(transaction, field) {
      if (field === 'auditEvent') return new Proxy(transaction.auditEvent, { get(delegate, method) {
        if (method === 'create') return () => { throw new Error('B3 injected audit failure') }
        const value = delegate[method]
        return typeof value === 'function' ? value.bind(delegate) : value
      } })
      const value = transaction[field]
      return typeof value === 'function' ? value.bind(transaction) : value
    } })), settings)
    const value = target[key]
    return typeof value === 'function' ? value.bind(target) : value
  } })
}
