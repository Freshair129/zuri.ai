// @req FR-293 — hung provider calls are bounded and abortable.
// @spec ADR-115, SEC-008
// @tested tests/unit/managed-blob-transfer-io.test.js
import { describe, expect, it, vi } from 'vitest'
import { runManagedBlobTransferProviderCall } from '@/modules/project-manager/application/managed-blob-transfer-io'

describe('managed blob transfer provider bounds', () => {
  it('aborts a provider operation at the finite timeout and returns a safe timeout code', async () => {
    let signal
    const call = runManagedBlobTransferProviderCall(value => {
      signal = value
      return new Promise(() => {})
    }, { timeoutMs: 10 })

    await expect(call).rejects.toMatchObject({ code: 'MANAGED_BLOB_TRANSFER_PROVIDER_TIMEOUT', status: 503 })
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(true)
  })

  it('does not start a provider operation after the worker deadline', async () => {
    const operation = vi.fn()
    await expect(runManagedBlobTransferProviderCall(operation, { timeoutMs: 100, deadlineAt: 10, clock: () => 10 }))
      .rejects.toMatchObject({ code: 'MANAGED_BLOB_TRANSFER_PROVIDER_TIMEOUT' })
    expect(operation).not.toHaveBeenCalled()
  })
})
