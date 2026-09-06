'use client'

// @req FR-133, FR-135 — printable asset tag modal with thermal and sheet print templates (AM-RQ-022, AM-RQ-023).
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-scanner-ui.test.js
import React, { useState } from 'react'
import { Printer, X, Download, Copy, Check, Sliders, Layers } from 'lucide-react'
import AssetTagLabel from './AssetTagLabel'

export default function AssetTagModal({
  assets = [],
  businessName = 'Zuri Business',
  isOpen = false,
  onClose = () => {},
}) {
  const [sizeVariant, setSizeVariant] = useState('70x35') // '50x25' | '70x35'
  const [copies, setCopies] = useState(1)
  const [copiedLink, setCopiedLink] = useState(false)

  if (!isOpen || !assets || assets.length === 0) return null

  const itemsToPrint = assets.flatMap((asset) => Array(copies).fill(asset))

  const handlePrint = () => {
    window.print()
  }

  const handleCopyUri = () => {
    if (assets.length === 1) {
      const uri = `zuri://assets/${assets[0].businessId || 'biz'}/${assets[0].assetCode}?v=1`
      navigator.clipboard.writeText(uri)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      {/* Modal Container */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
                พิมพ์ป้ายทรัพย์สิน (Asset Tags & Labels)
              </h3>
              <p className="text-xs text-gray-500">
                พร้อม QR Code และรหัสทรัพย์สินสำหรับติดอุปกรณ์จริง ({assets.length} รายการ)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Print Settings Toolbar */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4">
            {/* Size Selector */}
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-gray-600 dark:text-gray-400">ขนาดป้าย:</span>
              <select
                value={sizeVariant}
                onChange={(e) => setSizeVariant(e.target.value)}
                className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1 text-xs font-medium focus:ring-1 focus:ring-amber-500"
              >
                <option value="70x35">มาตรฐาน 70 × 35 มม. (7x3.5 cm)</option>
                <option value="50x25">กะทัดรัด 50 × 25 มม. (5x2.5 cm)</option>
              </select>
            </div>

            {/* Copies */}
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-gray-600 dark:text-gray-400">จำนวนชุด:</span>
              <input
                type="number"
                min="1"
                max="50"
                value={copies}
                onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-16 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1 text-xs text-center font-medium focus:ring-1 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2">
            {assets.length === 1 && (
              <button
                onClick={handleCopyUri}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium text-gray-700 dark:text-gray-300 transition"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedLink ? 'คัดลอก URI แล้ว' : 'คัดลอก QR URI'}</span>
              </button>
            )}
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold shadow-sm transition"
            >
              <Printer className="w-4 h-4" />
              <span>พิมพ์ป้าย ({itemsToPrint.length} ชิ้น)</span>
            </button>
          </div>
        </div>

        {/* Printable Area Preview */}
        <div className="p-6 overflow-y-auto flex-1 bg-gray-100 dark:bg-gray-950 flex flex-wrap gap-4 items-start justify-center">
          {itemsToPrint.map((asset, index) => (
            <div
              key={`${asset.id}-${index}`}
              className="bg-white p-2 rounded-xl shadow-md border border-gray-200 hover:shadow-lg transition-all"
            >
              <AssetTagLabel
                asset={asset}
                businessName={businessName}
                sizeVariant={sizeVariant}
              />
            </div>
          ))}
        </div>

        {/* Modal Footer Note */}
        <div className="p-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 text-center text-[11px] text-gray-500">
          💡 แนะนำให้ตั้งค่าหน้าพิมพ์ (Print Settings) เป็น <b>Scale: 100%</b> และปิด Headers & Footers เพื่อขนาดสติกเกอร์ที่ถูกต้องแม่นยำ
        </div>
      </div>

      {/* Hidden Print Styling */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .asset-tag-label, .asset-tag-label * {
            visibility: visible;
          }
          .asset-tag-label {
            position: relative;
            margin: 4mm auto;
            page-break-inside: avoid;
          }
        }
      `}</style>
    </div>
  )
}
