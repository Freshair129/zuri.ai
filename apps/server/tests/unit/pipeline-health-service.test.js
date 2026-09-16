import { describe, expect, it } from 'vitest'
import { makeViewer } from '../factories/viewer'
import {
  aggregateJobRecords,
  getLivePipelineHealth,
  BACKED_EDGES_CONFIG,
} from '@/modules/knowledge/pipeline-map/pipeline-health-service'

// @req FR-215 — Live pipeline health on the map: unit tests for service.
// @spec ADR-085 D5, SEC-001, SEC-008
// @tested tests/unit/pipeline-health-service.test.js

describe('pipeline-health-service', () => {
  describe('aggregateJobRecords', () => {
    it('returns zeroes and empty status counts for empty records', () => {
      const result = aggregateJobRecords([])
      expect(result).toEqual({
        total: 0,
        countsByStatus: {},
        failedCount: 0,
        lastRunAt: null,
        hasFailures: false,
      })
    })

    it('aggregates statuses, identifies failures, and finds latest run', () => {
      const records = [
        { status: 'SUCCEEDED', updatedAt: '2026-09-14T08:00:00.000Z' },
        { status: 'FAILED', updatedAt: '2026-09-14T08:15:00.000Z' },
        { status: 'SUCCEEDED', updatedAt: '2026-09-14T08:05:00.000Z' },
      ]
      const result = aggregateJobRecords(records)
      expect(result.total).toBe(3)
      expect(result.failedCount).toBe(1)
      expect(result.hasFailures).toBe(true)
      expect(result.countsByStatus).toEqual({
        SUCCEEDED: 2,
        FAILED: 1,
      })
      expect(result.lastRunAt).toBe('2026-09-14T08:15:00.000Z')
    })
  })

  describe('getLivePipelineHealth authorization & boundary validation', () => {
    it('throws 400 when businessId is missing or whitespace', async () => {
      const viewer = makeViewer({ visibleDomains: ['knowledge'] })
      await expect(getLivePipelineHealth({ businessId: '', viewer })).rejects.toMatchObject({
        status: 400,
        message: 'BUSINESS_REQUIRED',
      })
      await expect(getLivePipelineHealth({ businessId: '   ', viewer })).rejects.toMatchObject({
        status: 400,
        message: 'BUSINESS_REQUIRED',
      })
    })

    it('throws 401 when viewer is missing', async () => {
      await expect(getLivePipelineHealth({ businessId: 'biz-1', viewer: null })).rejects.toMatchObject({
        status: 401,
        message: 'UNAUTHENTICATED',
      })
    })

    it('throws 404 when viewer does not have knowledge domain grant', async () => {
      const viewer = makeViewer({
        visibleBusinessIds: ['biz-1'],
        visibleDomains: ['projects', 'people'],
      })
      await expect(getLivePipelineHealth({ businessId: 'biz-1', viewer })).rejects.toMatchObject({
        status: 404,
        message: 'BUSINESS_NOT_FOUND',
      })
    })

    it('uses the per-Business knowledge grant rather than the viewer domain union', async () => {
      const viewer = makeViewer({
        visibleBusinessIds: ['biz-1'],
        visibleDomains: ['knowledge'],
        domainsByBusinessId: { 'biz-1': [] },
      })
      await expect(getLivePipelineHealth({ businessId: 'biz-1', viewer })).rejects.toMatchObject({
        status: 404,
        message: 'BUSINESS_NOT_FOUND',
      })
    })

    it('throws 404 when viewer cannot see the target business (isolation)', async () => {
      const viewer = makeViewer({
        visibleBusinessIds: ['biz-other'],
        visibleDomains: ['knowledge'],
      })
      await expect(getLivePipelineHealth({ businessId: 'biz-secret', viewer })).rejects.toMatchObject({
        status: 404,
        message: 'BUSINESS_NOT_FOUND',
      })
    })
  })

  describe('getLivePipelineHealth bounded queries & edge mapping', () => {
    it('queries bounded records for the active business and maps to backed edges', async () => {
      const viewer = makeViewer({
        visibleBusinessIds: ['biz-1'],
        visibleDomains: ['knowledge', 'line-oa', 'assets'],
      })

      const mockDb = {
        pipelineRun: {
          findMany: async ({ where }) => {
            expect(where.businessId).toBe('biz-1')
            return [
              { status: 'SUCCEEDED', updatedAt: new Date('2026-09-14T07:00:00Z') },
              { status: 'FAILED', updatedAt: new Date('2026-09-14T08:00:00Z') },
            ]
          },
        },
        lineConversationJob: {
          findMany: async ({ where }) => {
            expect(where.businessId).toBe('biz-1')
            return [
              { status: 'RECORDED', updatedAt: new Date('2026-09-14T08:30:00Z') },
            ]
          },
        },
        lineOaRichMenuJob: {
          findMany: async ({ where }) => {
            expect(where.businessId).toBe('biz-1')
            return [
              { status: 'APPLIED', updatedAt: new Date('2026-09-14T08:10:00Z') },
            ]
          },
        },
        assetExtractionJob: {
          findMany: async ({ where }) => {
            expect(where.businessId).toBe('biz-1')
            return [
              { status: 'COMPLETED', updatedAt: new Date('2026-09-14T07:30:00Z') },
            ]
          },
        },
      }

      const result = await getLivePipelineHealth({
        businessId: 'biz-1',
        viewer,
        db: mockDb,
      })
      expect(result.businessId).toBe('biz-1')
      expect(result.summary.totalTracked).toBe(5)
      expect(result.summary.totalFailures).toBe(1)
      expect(result.summary.hasFailures).toBe(true)

      // Check PipelineRun mapped edges (e.g. e.tier1-to-ledger)
      expect(result.edges['e.tier1-to-ledger']).toMatchObject({
        table: 'PipelineRun',
        available: true,
        total: 2,
        failedCount: 1,
        hasFailures: true,
        monitorUrl: '/execution/data-migration',
      })
      expect(result.edges['e.ledger-to-staff']).toMatchObject({
        table: 'PipelineRun',
        total: 2,
        failedCount: 1,
      })

      // Check LineConversationJob mapped edges
      expect(result.edges['e.webhook-to-jobs']).toMatchObject({
        table: 'LineConversationJob',
        available: true,
        total: 1,
        failedCount: 0,
        hasFailures: false,
        monitorUrl: '/line-oa/live-crm',
      })

      // Check LineOaRichMenuJob mapped edges
      expect(result.edges['e.config-to-richmenu-jobs']).toMatchObject({
        table: 'LineOaRichMenuJob',
        total: 1,
        failedCount: 0,
        monitorUrl: '/line-oa/rich-menus',
      })

      // Check AssetExtractionJob mapped edges
      expect(result.edges['e.asset-to-extraction']).toMatchObject({
        table: 'AssetExtractionJob',
        total: 1,
        failedCount: 0,
        monitorUrl: '/assets/receiving',
      })

      // Unbacked edges are NOT in result.edges
      expect(result.edges['e.repo-to-projection']).toBeUndefined()
      expect(result.edges['e.market-to-raw']).toBeUndefined()
    })

    it('reports query failure as unavailable rather than inventing zeroes', async () => {
      const viewer = makeViewer({
        visibleBusinessIds: ['biz-1'],
        visibleDomains: ['knowledge', 'line-oa', 'assets'],
      })

      const mockFailingDb = {
        pipelineRun: {
          findMany: async () => {
            throw new Error('Database connection dropped')
          },
        },
        lineConversationJob: {
          findMany: async () => {
            throw new Error('Timeout')
          },
        },
        lineOaRichMenuJob: {
          findMany: async () => {
            throw new Error('Table lock')
          },
        },
        assetExtractionJob: {
          findMany: async () => {
            throw new Error('Crash')
          },
        },
      }

      const result = await getLivePipelineHealth({
        businessId: 'biz-1',
        viewer,
        db: mockFailingDb,
      })

      expect(result.businessId).toBe('biz-1')
      expect(result.summary.totalTracked).toBeNull()
      expect(result.summary.totalFailures).toBeNull()
      expect(result.summary.hasFailures).toBeNull()
      expect(result.summary.healthAvailable).toBe(false)
      expect(result.summary.unavailableTableCount).toBe(4)
      expect(result.edges['e.tier1-to-ledger']).toMatchObject({
        available: false,
        total: null,
        failedCount: null,
        lastRunAt: null,
      })
    })
  })
})
