// @spec BR-002 — injects a stale code lookup while keeping inserts on the real unique index
// @tested tests/integration/code-allocation-retry.test.js

import { vi } from 'vitest'

const STALE_READ_METHODS = new Set(['count', 'findUnique', 'findFirst', 'findMany'])

function staleValue(method) {
  if (method === 'count') return 0
  if (method === 'findMany') return []
  return null
}

function bindValue(target, property) {
  const value = Reflect.get(target, property, target)
  return typeof value === 'function' ? value.bind(target) : value
}

/**
 * Make configured code lookups see an empty world for a bounded number of
 * transactions, while all writes still reach the real Prisma client.
 */
export function staleCodeReads(db, { reads = {}, staleAttempts = 1 } = {}) {
  const methodsByModel = new Map(Object.entries(reads).map(([model, methods]) => [model, new Set(methods)]))
  const directCalls = new Map()
  let transactionCalls = 0
  let staleReads = 0

  function wrapClient(client, { transactionIsStale = false, root = false } = {}) {
    return new Proxy(client, {
      get(target, property) {
        if (property === 'staleReads') return staleReads
        if (property === 'transactionCalls') return transactionCalls

        if (root && property === '$transaction') {
          const transaction = Reflect.get(target, property, target)
          return (callback, ...options) => {
            if (typeof callback !== 'function') {
              return Reflect.apply(transaction, target, [callback, ...options])
            }
            const transactionNumber = ++transactionCalls
            const wrappedCallback = async (...args) => {
              const [tx, ...callbackArgs] = args
              const transactionIsStale = transactionNumber <= staleAttempts
              const spies = []
              try {
                for (const [model, methods] of methodsByModel) {
                  const delegate = tx[model]
                  if (!delegate) continue
                  for (const method of methods) {
                    if (!STALE_READ_METHODS.has(method) || typeof delegate[method] !== 'function') continue
                    const original = delegate[method].bind(delegate)
                    spies.push(vi.spyOn(delegate, method).mockImplementation((...methodArgs) => {
                      if (transactionIsStale) {
                        staleReads += 1
                        return Promise.resolve(staleValue(method))
                      }
                      return original(...methodArgs)
                    }))
                  }
                }
                // Keep the original Prisma transaction identity so pipeline transaction
                // ownership checks continue to recognize this client.
                return await callback(tx, ...callbackArgs)
              } finally {
                for (const spy of spies.reverse()) spy.mockRestore()
              }
            }
            return Reflect.apply(transaction, target, [wrappedCallback, ...options])
          }
        }

        const configuredMethods = methodsByModel.get(String(property))
        if (!configuredMethods) return bindValue(target, property)

        const delegate = Reflect.get(target, property, target)
        if (!delegate || typeof delegate !== 'object') return delegate

        return new Proxy(delegate, {
          get(modelTarget, method) {
            const value = Reflect.get(modelTarget, method, modelTarget)
            if (typeof value !== 'function') return value
            const methodName = String(method)
            if (!configuredMethods.has(methodName) || !STALE_READ_METHODS.has(methodName)) {
              return value.bind(modelTarget)
            }

            return (...args) => {
              let shouldBeStale = transactionIsStale
              if (root) {
                const key = `${String(property)}.${methodName}`
                const calls = directCalls.get(key) || 0
                directCalls.set(key, calls + 1)
                shouldBeStale = calls < staleAttempts
              }
              if (shouldBeStale) {
                staleReads += 1
                return Promise.resolve(staleValue(methodName))
              }
              return Reflect.apply(value, modelTarget, args)
            }
          },
        })
      },
    })
  }

  return wrapClient(db, { root: true })
}
