'use client'

// @req FR-133, FR-135 — mobile-friendly QR scanner and on-site stocktake verification (AM-RQ-060..AM-RQ-062).
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-scanner-ui.test.js
import React, { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import {
  Camera,
  QrCode,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MapPin,
  User,
  Package,
  Layers,
  RefreshCw,
  FolderKanban,
  History,
  ShieldCheck,
  Printer,
  ChevronRight,
  ArrowRightLeft,
  SlidersHorizontal,
} from 'lucide-react'
import { Card, SectionTitle, StatusPill, EmptyState } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import AssetTagModal from './AssetTagModal'

export default function AssetScannerWorkspace() {
  const scope = useScope()
  const business = scope.shell.activeBusiness

  // Camera & Scan states
  const videoRef = useRef(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [lookupError, setLookupError] = useState('')

  // Scanned Asset Data
  const [scannedAsset, setScannedAsset] = useState(null)
  const [recentScans, setRecentScans] = useState([])

  // Audit Verification Form
  const [observedLocationName, setObservedLocationName] = useState('')
  const [observedCondition, setObservedCondition] = useState('GOOD')
  const [auditNotes, setAuditNotes] = useState('')
  const [submittingAudit, setSubmittingAudit] = useState(false)
  const [auditSuccess, setAuditSuccess] = useState('')

  // Tag Modal
  const [tagModalOpen, setTagModalOpen] = useState(false)

  // Start Camera Stream
  const startCamera = useCallback(async () => {
    setCameraError('')
    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        setCameraError('เบราว์เซอร์นี้ไม่รองรับการเข้าถึงกล้องโดยตรง กรุณาใช้การค้นหาด้วยรหัสทรัพย์สิน')
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      })

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
        setCameraActive(true)
      }
    } catch (err) {
      console.warn('Camera access error:', err)
      setCameraError('ไม่สามารถเข้าถึงกล้องได้ (กรุณาอนุญาต Camera Permission หรือพิมพ์รหัสทรัพย์สิน)')
      setCameraActive(false)
    }
  }, [])

  // Stop Camera Stream
  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks()
      tracks.forEach((track) => track.stop())
      videoRef.current.srcObject = null
    }
    setCameraActive(false)
  }, [])

  // Execute Asset Lookup
  const handleLookup = useCallback(
    async (codeToLookup) => {
      if (!codeToLookup || !business?.id) return
      setLoading(true)
      setLookupError('')
      setAuditSuccess('')

      try {
        const res = await fetch(
          `/api/assets/lookup?code=${encodeURIComponent(codeToLookup)}&businessId=${business.id}`
        )
        const json = await res.json()

        if (!res.ok) {
          throw new Error(json.error || 'ไม่พบข้อมูลทรัพย์สิน')
        }

        setScannedAsset(json)
        setObservedCondition(json.condition || 'GOOD')
        setObservedLocationName(json.currentLocation?.locationName || '')

        // Push to recent session scans
        setRecentScans((prev) => {
          const filtered = prev.filter((item) => item.id !== json.id)
          return [json, ...filtered].slice(0, 10)
        })
      } catch (err) {
        setLookupError(err.message)
        setScannedAsset(null)
      } finally {
        setLoading(false)
      }
    },
    [business?.id]
  )

  // Camera Barcode Scanning Loop
  useEffect(() => {
    let animationFrameId
    let isDetecting = false

    if (cameraActive && window.BarcodeDetector) {
      const barcodeDetector = new window.BarcodeDetector({
        formats: ['qr_code', 'code_128', 'code_39', 'ean_13'],
      })

      const detectFrame = async () => {
        if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA && !isDetecting) {
          isDetecting = true
          try {
            const barcodes = await barcodeDetector.detect(videoRef.current)
            if (barcodes.length > 0) {
              const detectedValue = barcodes[0].rawValue
              if (detectedValue && detectedValue !== scannedAsset?.assetCode) {
                // Trigger lookup
                handleLookup(detectedValue)
              }
            }
          } catch (e) {
            // Ignore detection errors during movement
          } finally {
            isDetecting = false
          }
        }
        animationFrameId = requestAnimationFrame(detectFrame)
      }

      animationFrameId = requestAnimationFrame(detectFrame)
    }

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId)
    }
  }, [cameraActive, handleLookup, scannedAsset?.assetCode])

  // Submit Physical Verification Audit
  const handleVerifyObservation = async (relocateIfMismatch = false) => {
    if (!scannedAsset?.id || !business?.id) return
    setSubmittingAudit(true)
    setAuditSuccess('')

    try {
      const res = await fetch(`/api/assets/register/${scannedAsset.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          observedLocationName,
          condition: observedCondition,
          notes: auditNotes,
          relocateIfMismatch,
        }),
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'บันทึกการตรวจนับไม่สำเร็จ')

      setAuditSuccess(
        relocateIfMismatch
          ? '✅ ย้ายตำแหน่งและบันทึกการตรวจนับสำเร็จ'
          : '✅ บันทึกการยืนยันตัวตนและการตรวจนับสำเร็จ'
      )

      // Refresh asset details
      handleLookup(scannedAsset.assetCode)
    } catch (err) {
      alert(`เกิดข้อผิดพลาด: ${err.message}`)
    } finally {
      setSubmittingAudit(false)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-600">
              AM-RQ-061 Mobile Fast Scanner
            </span>
            <span className="text-xs text-gray-500">• {business?.name || 'Zuri Business'}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 mt-1">
            สแกนตรวจสอบทรัพย์สิน & ตรวจนับ (Stocktake Scanner)
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            สแกน QR Code หรือบาร์โค้ดบนป้ายเพื่อตรวจสอบข้อมูลผู้ถือครอง ตำแหน่งปัจจุบัน และบันทึกผลตรวจนับ
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/assets/register"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-300 transition"
          >
            <Package className="w-3.5 h-3.5" />
            <span>ทะเบียนทรัพย์สิน</span>
          </Link>
          <Link
            href="/assets"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-300 transition"
          >
            <span>ภาพรวม</span>
          </Link>
        </div>
      </div>

      {/* Main Grid: Left Scanner & Search, Right Details */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Camera Scanner & Manual Input (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <Card className="p-4 overflow-hidden border-2 border-amber-500/20 shadow-md">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-amber-600" />
                <span className="font-bold text-sm text-gray-900 dark:text-gray-100">
                  กล้องสแกน QR / Barcode
                </span>
              </div>
              <button
                onClick={cameraActive ? stopCamera : startCamera}
                className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition ${
                  cameraActive
                    ? 'bg-red-50 text-red-600 dark:bg-red-950/30'
                    : 'bg-amber-600 text-white hover:bg-amber-700 shadow-sm'
                }`}
              >
                {cameraActive ? 'ปิดกล้อง' : 'เปิดกล้องสแกน'}
              </button>
            </div>

            {/* Camera Viewport */}
            <div className="relative aspect-[4/3] bg-black rounded-xl overflow-hidden flex items-center justify-center border border-gray-800">
              <video
                ref={videoRef}
                playsInline
                muted
                className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
              />

              {!cameraActive && (
                <div className="text-center p-6 text-gray-400">
                  <QrCode className="w-12 h-12 mx-auto mb-2 opacity-30 text-amber-500 animate-pulse" />
                  <p className="text-xs">กดปุ่ม &quot;เปิดกล้องสแกน&quot; เพื่อเปิดกล้องหลังมือถือ</p>
                </div>
              )}

              {cameraActive && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-48 h-48 border-2 border-amber-400 rounded-2xl relative shadow-lg">
                    <div className="absolute -top-1 -left-1 w-4 h-4 border-t-4 border-l-4 border-amber-500" />
                    <div className="absolute -top-1 -right-1 w-4 h-4 border-t-4 border-r-4 border-amber-500" />
                    <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-4 border-l-4 border-amber-500" />
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-4 border-r-4 border-amber-500" />
                    <div className="w-full h-0.5 bg-amber-500/80 absolute top-1/2 -translate-y-1/2 animate-pulse shadow-sm" />
                  </div>
                </div>
              )}
            </div>

            {cameraError && (
              <div className="mt-3 p-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 rounded-lg text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                <span>{cameraError}</span>
              </div>
            )}

            {/* Manual Code Input */}
            <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                หรือพิมพ์รหัสทรัพย์สิน / Serial Number / สแกนผ่านเครื่องอ่าน:
              </label>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleLookup(manualCode)
                }}
                className="flex gap-2"
              >
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    placeholder="เช่น AST-2026-00001"
                    className="w-full pl-9 pr-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-mono focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !manualCode.trim()}
                  className="px-3 py-1.5 bg-gray-900 hover:bg-black dark:bg-amber-600 dark:hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition disabled:opacity-50"
                >
                  {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'ค้นหา'}
                </button>
              </form>
            </div>
          </Card>

          {/* Recent Scanned History in Session */}
          {recentScans.length > 0 && (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-gray-500" />
                  ประวัติการสแกนในรอบนี้ ({recentScans.length})
                </span>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {recentScans.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setScannedAsset(item)
                      setObservedLocationName(item.currentLocation?.locationName || '')
                      setObservedCondition(item.condition || 'GOOD')
                    }}
                    className={`w-full text-left p-2 rounded-lg border text-xs flex items-center justify-between transition ${
                      scannedAsset?.id === item.id
                        ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-950/20'
                        : 'border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                    }`}
                  >
                    <div>
                      <div className="font-mono font-bold text-gray-900 dark:text-gray-100">
                        {item.assetCode}
                      </div>
                      <div className="text-[11px] text-gray-500 truncate max-w-[180px]">
                        {item.name}
                      </div>
                    </div>
                    <StatusPill status={item.status} size="xs" />
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* Right Column: Scanned Asset Details & Verification Form (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {lookupError && (
            <Card className="p-6 text-center border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20">
              <XCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
              <div className="text-sm font-bold text-red-800 dark:text-red-200">
                {lookupError}
              </div>
              <p className="text-xs text-red-600 mt-1">
                กรุณาตรวจสอบรหัสทรัพย์สิน หรือตรวจดูว่าทรัพย์สินอยู่ในขอบเขตธุรกิจนี้หรือไม่
              </p>
            </Card>
          )}

          {!scannedAsset && !lookupError && (
            <Card className="p-12 text-center border-dashed">
              <QrCode className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
              <div className="text-base font-bold text-gray-700 dark:text-gray-300">
                พร้อมสำหรับการสแกนทรัพย์สิน
              </div>
              <p className="text-xs text-gray-500 max-w-sm mx-auto mt-1">
                ใช้กล้องเล็งไปที่ป้าย QR Code หรือพิมพ์รหัสทรัพย์สินด้านซ้าย เพื่อดึงข้อมูลการตรวจนับ
              </p>
            </Card>
          )}

          {scannedAsset && (
            <div className="space-y-4">
              {/* Asset Identity Card */}
              <Card className="p-5 border-amber-500/30 shadow-md">
                <div className="flex items-start justify-between gap-3 border-b border-gray-100 dark:border-gray-800 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-base font-black text-amber-700 dark:text-amber-500">
                        {scannedAsset.assetCode}
                      </span>
                      <StatusPill status={scannedAsset.status} size="sm" />
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 font-bold uppercase">
                        {scannedAsset.categoryCode}
                      </span>
                    </div>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mt-1">
                      {scannedAsset.name}
                    </h2>
                    <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                      {scannedAsset.brand && <span>แบรนด์: <b>{scannedAsset.brand}</b></span>}
                      {scannedAsset.model && <span>• รุ่น: <b>{scannedAsset.model}</b></span>}
                      {scannedAsset.serialNumber && (
                        <span>• S/N: <b className="font-mono">{scannedAsset.serialNumber}</b></span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => setTagModalOpen(true)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-xs font-semibold text-gray-700 dark:text-gray-300 transition shrink-0"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>พิมพ์ป้าย</span>
                  </button>
                </div>

                {/* Status Matrix */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-4">
                  {/* Custodian */}
                  <div className="p-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800">
                    <div className="text-[11px] font-semibold text-gray-500 flex items-center gap-1 mb-1">
                      <User className="w-3.5 h-3.5 text-amber-600" />
                      ผู้ดูแล/ครอบครอง
                    </div>
                    <div className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate">
                      {scannedAsset.activeCustodian?.name || 'ยังไม่ระบุ'}
                    </div>
                  </div>

                  {/* Location */}
                  <div className="p-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800">
                    <div className="text-[11px] font-semibold text-gray-500 flex items-center gap-1 mb-1">
                      <MapPin className="w-3.5 h-3.5 text-blue-600" />
                      ตำแหน่งตามทะเบียน
                    </div>
                    <div className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate">
                      {scannedAsset.currentLocation?.locationName || 'ยังไม่ระบุ'}
                    </div>
                  </div>

                  {/* Project */}
                  <div className="p-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800">
                    <div className="text-[11px] font-semibold text-gray-500 flex items-center gap-1 mb-1">
                      <FolderKanban className="w-3.5 h-3.5 text-emerald-600" />
                      โครงการที่ใช้งาน
                    </div>
                    <div className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate">
                      {scannedAsset.activeAllocation?.projectName || 'ส่วนกลาง (ไม่ได้จอง)'}
                    </div>
                  </div>
                </div>

                {/* Audit Feedback Success Alert */}
                {auditSuccess && (
                  <div className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-800 dark:text-emerald-200 font-semibold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{auditSuccess}</span>
                  </div>
                )}

                {/* On-Site Stocktake / Physical Verification Form */}
                <div className="p-4 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-amber-950 dark:text-amber-200 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-amber-600" />
                      บันทึกผลการตรวจนับจริงหน้างาน (On-Site Verification)
                    </span>
                  </div>

                  <div className="space-y-3">
                    {/* Observed Location */}
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        ตำแหน่งที่พบจริง:
                      </label>
                      <input
                        type="text"
                        value={observedLocationName}
                        onChange={(e) => setObservedLocationName(e.target.value)}
                        placeholder="เช่น ห้องเซิร์ฟเวอร์ ชั้น 3, อาคาร B"
                        className="w-full px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-medium focus:ring-2 focus:ring-amber-500"
                      />
                    </div>

                    {/* Condition */}
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        สภาพทางกายภาพที่พบ:
                      </label>
                      <select
                        value={observedCondition}
                        onChange={(e) => setObservedCondition(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-medium focus:ring-2 focus:ring-amber-500"
                      >
                        <option value="EXCELLENT">สมบูรณ์มาก (EXCELLENT)</option>
                        <option value="GOOD">สภาพดี ใช้งานได้ปกติ (GOOD)</option>
                        <option value="FAIR">มีรอยสึกหรอ เล็กน้อย (FAIR)</option>
                        <option value="POOR">สภาพทรุดโทรม (POOR)</option>
                        <option value="DAMAGED">ชำรุด / ต้องส่งซ่อม (DAMAGED)</option>
                      </select>
                    </div>

                    {/* Notes */}
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        หมายเหตุการตรวจนับ:
                      </label>
                      <input
                        type="text"
                        value={auditNotes}
                        onChange={(e) => setAuditNotes(e.target.value)}
                        placeholder="เช่น สติกเกอร์สภาพดี, อยู่ในตู้เก็บของ"
                        className="w-full px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-medium focus:ring-2 focus:ring-amber-500"
                      />
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 pt-2">
                      <button
                        onClick={() => handleVerifyObservation(false)}
                        disabled={submittingAudit}
                        className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shadow-sm transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>ยืนยันข้อมูล & บันทึกตรวจนับ</span>
                      </button>

                      {observedLocationName &&
                        observedLocationName !== scannedAsset.currentLocation?.locationName && (
                          <button
                            onClick={() => handleVerifyObservation(true)}
                            disabled={submittingAudit}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-sm transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                          >
                            <ArrowRightLeft className="w-4 h-4" />
                            <span>ย้ายตำแหน่งมาที่นี่ทันที</span>
                          </button>
                        )}
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Printable Tag Modal */}
      {scannedAsset && (
        <AssetTagModal
          assets={[scannedAsset]}
          businessName={business?.name || 'Zuri Business'}
          isOpen={tagModalOpen}
          onClose={() => setTagModalOpen(false)}
        />
      )}
    </div>
  )
}
