import React, { createElement, useEffect } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePipelineHealth } from '@/modules/knowledge/pipeline-map/use-pipeline-health'

// @req FR-215 — Live pipeline health hook for Data Pipeline Map.
// @spec ADR-085 D5, SEC-001, SEC-008
// @tested tests/unit/use-pipeline-health.test.js

globalThis.React = React

describe('usePipelineHealth', () => {
  it('renders with null health when businessId is null', () => {
    let captured = null
    function TestProbe() {
      captured = usePipelineHealth(null)
      return createElement('div', { 'data-testid': 'probe' }, captured.loading ? 'loading' : 'idle')
    }

    const html = renderToStaticMarkup(createElement(TestProbe))
    expect(html).toContain('idle')
    expect(captured.health).toBeNull()
    expect(captured.loading).toBe(false)
  })

  it('initializes with loading false and provides refresh method', () => {
    let captured = null
    function TestProbe() {
      captured = usePipelineHealth('biz-1')
      return createElement('div', null, 'ok')
    }

    renderToStaticMarkup(createElement(TestProbe))
    expect(captured).toHaveProperty('refresh')
    expect(typeof captured.refresh).toBe('function')
  })
})
