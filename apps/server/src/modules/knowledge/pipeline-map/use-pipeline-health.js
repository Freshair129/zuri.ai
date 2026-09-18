'use client'

// @req FR-215 — Live pipeline health hook for Data Pipeline Map.
//   Reads bounded live health metrics for the active Business only.
//   The static map never waits on this and continues to render if it fails.
// @spec ADR-085 D5, SEC-001, SEC-008
// @tested tests/unit/use-pipeline-health.test.js

import { useState, useEffect, useCallback } from 'react'

export function usePipelineHealth(businessId) {
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!businessId) {
      setHealth(null)
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/pipelines/health?businessId=${encodeURIComponent(businessId)}`)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const data = await res.json()
      setHealth(data)
    } catch (err) {
      setError(err)
      // FR-215: static map still renders when read fails
      setHealth(null)
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { health, loading, error, refresh }
}
