'use client'

import React, { useState, useEffect } from 'react'
import { TrendingUp, Bell, Search, ShieldCheck, Tag, BarChart3, AlertCircle, Plus } from 'lucide-react'

// @req FR-092
// @spec SDD-049, ADR-038
// @tested tests/unit/market-intelligence/price-observation-domain.test.js

export default function MarketDashboard() {
  const [activeTab, setActiveTab] = useState('overview')
  const [watchRules, setWatchRules] = useState([
    {
      id: 'wr-1',
      name: 'GPU RTX 3060 Deal Watch',
      query: 'RTX 3060',
      maxPrice: 5500,
      condition: 'USED',
      intent: 'SELL',
      active: true,
      excludeKeywords: ['3060 Ti'],
    },
    {
      id: 'wr-2',
      name: 'Retail Bundle Discount Watch',
      query: 'Orange Juice 250ml',
      maxPrice: 30,
      condition: 'NEW',
      intent: 'BUY',
      active: true,
      excludeKeywords: [],
    },
  ])

  const [observations] = useState([
    {
      id: 'obs-1',
      productTitle: 'Zotac Gaming RTX 3060 12GB Twin Edge',
      sourceProvider: 'facebook_marketplace',
      rawPrice: 5000,
      unitPrice: 5000,
      currency: 'THB',
      condition: 'USED',
      sellerName: 'Somchai Tech',
      observedAt: '10 mins ago',
      isAlert: true,
    },
    {
      id: 'obs-2',
      productTitle: 'Fresh Orange Juice 250ml Pack 6',
      sourceProvider: 'retail_lotus',
      rawPrice: 156,
      unitPrice: 26,
      currency: 'THB',
      condition: 'NEW',
      sellerName: "Lotus's Retail",
      observedAt: '25 mins ago',
      isAlert: true,
    },
    {
      id: 'obs-3',
      productTitle: 'Colorful iGame RTX 3060 Ultra W OC 12GB',
      sourceProvider: 'shopee_listing',
      rawPrice: 6200,
      unitPrice: 6200,
      currency: 'THB',
      condition: 'USED',
      sellerName: 'GPU Store BKK',
      observedAt: '1 hour ago',
      isAlert: false,
    },
  ])

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-[#FDE8D0] text-[#E8820C]">
              <TrendingUp className="w-5 h-5" />
            </span>
            <h1 className="text-2xl font-bold text-gray-900">Market Intelligence</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Real-time external price normalization, listing tracking, and watch rule matching.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => alert('New Watch Rule Modal')}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#E8820C] hover:bg-[#F09420] rounded-lg shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            New Watch Rule
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Active Watch Rules</span>
            <Bell className="w-4 h-4 text-[#E8820C]" />
          </div>
          <div className="text-2xl font-bold text-gray-900">{watchRules.filter((r) => r.active).length}</div>
          <div className="text-xs text-emerald-600 font-medium">All rules actively listening</div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Observed Listings</span>
            <Tag className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-bold text-gray-900">{observations.length}</div>
          <div className="text-xs text-gray-500">Across 2 connected sources</div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Triggered Alerts</span>
            <AlertCircle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-gray-900">{observations.filter((o) => o.isAlert).length}</div>
          <div className="text-xs text-amber-600 font-medium">Matching target criteria</div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Lineage Integrity</span>
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-emerald-600">100%</div>
          <div className="text-xs text-gray-500">SHA-256 Provenance verified</div>
        </div>
      </div>

      {/* Main Content Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Latest Observations & Price Feed */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#E8820C]" />
              Latest Translated Market Observations
            </h2>
            <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
              Live Feed
            </span>
          </div>

          <div className="divide-y divide-gray-100">
            {observations.map((obs) => (
              <div key={obs.id} className="p-4 hover:bg-gray-50/50 transition flex items-center justify-between">
                <div className="space-y-1 max-w-md">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 text-sm">{obs.productTitle}</span>
                    {obs.isAlert && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800">
                        Watch Match
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span className="capitalize">Source: {obs.sourceProvider.replace('_', ' ')}</span>
                    <span>•</span>
                    <span>Condition: {obs.condition}</span>
                    <span>•</span>
                    <span>Seller: {obs.sellerName}</span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-base font-bold text-gray-900">
                    {obs.unitPrice.toLocaleString()} {obs.currency}
                    {obs.rawPrice !== obs.unitPrice && (
                      <span className="text-xs text-gray-400 font-normal ml-1">/unit</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400">{obs.observedAt}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Col: Active Watch Rules */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Bell className="w-4 h-4 text-[#E8820C]" />
              Active Watch Rules
            </h2>
          </div>

          <div className="divide-y divide-gray-100">
            {watchRules.map((rule) => (
              <div key={rule.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-900">{rule.name}</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                </div>
                <div className="text-xs text-gray-600 space-y-1">
                  <div>
                    <span className="text-gray-400">Target:</span> {rule.query}
                  </div>
                  {rule.excludeKeywords.length > 0 && (
                    <div>
                      <span className="text-gray-400">Excludes:</span> {rule.excludeKeywords.join(', ')}
                    </div>
                  )}
                  <div>
                    <span className="text-gray-400">Max Price:</span> ≤ {rule.maxPrice.toLocaleString()} THB (
                    {rule.condition})
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
