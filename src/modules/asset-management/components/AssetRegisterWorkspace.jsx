'use client'

// @req FR-133, FR-135 — interactive Asset Register workspace, search, filters, custody transfer, relocation, and project allocation.
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-register-service.test.js, tests/unit/asset-lifecycle-service.test.js
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Search,
  Filter,
  QrCode,
  Package,
  Layers,
  MapPin,
  User,
  Clock,
  FileText,
  AlertCircle,
  ChevronRight,
  X,
  Copy,
  Check,
  RefreshCw,
  SlidersHorizontal,
  ArrowUpRight,
  ShieldCheck,
  History,
  FolderKanban,
  ArrowRightLeft,
  Move,
  CornerUpLeft,
  Printer,
  Camera,
  CheckSquare,
  Square,
  Wrench,
  Calculator,
  TrendingDown,
} from 'lucide-react'
import { Card, SectionTitle, StatusPill, EmptyState } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import AssetTagModal from './AssetTagModal'
import { QrCodeSvg } from './AssetTagLabel'

const CATEGORIES = [
  { code: '', label: 'ทุกหมวดหมู่' },
  { code: 'IT_EQUIPMENT', label: 'อุปกรณ์ไอที / คอมพิวเตอร์' },
  { code: 'OFFICE_FURNITURE', label: 'เฟอร์นิเจอร์สำนักงาน' },
  { code: 'OFFICE_EQUIPMENT', label: 'เครื่องใช้สำนักงาน' },
  { code: 'VEHICLE', label: 'ยานพาหนะ' },
  { code: 'MACHINERY', label: 'เครื่องจักร / เครื่องมือ' },
  { code: 'ELECTRONICS', label: 'อุปกรณ์อิเล็กทรอนิกส์' },
  { code: 'GENERAL', label: 'ทั่วไป' },
]

const STATUSES = [
  { code: '', label: 'ทุกสถานะ' },
  { code: 'ACTIVE', label: 'ใช้งานปกติ (ACTIVE)' },
  { code: 'IN_USE', label: 'กำลังใช้งานในโครงการ (IN_USE)' },
  { code: 'MAINTENANCE', label: 'ส่งซ่อม / บำรุงรักษา (MAINTENANCE)' },
  { code: 'DISPOSED', label: 'ตัดจำหน่ายแล้ว (DISPOSED)' },
]

export default function AssetRegisterWorkspace() {
  const scope = useScope()
  const business = scope.shell.activeBusiness

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState({ items: [], stats: { total: 0, active: 0, inUse: 0, maintenance: 0 } })
  const [search, setSearch] = useState('')
  const [categoryCode, setCategoryCode] = useState('')
  const [status, setStatus] = useState('')
  const [selectedAssetId, setSelectedAssetId] = useState(null)
  const [assetDetail, setAssetDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // Selection for Batch Printing
  const [selectedAssetIds, setSelectedAssetIds] = useState(new Set())
  const [tagModalOpen, setTagModalOpen] = useState(false)
  const [printAssets, setPrintAssets] = useState([])

  // Maintenance & Depreciation
  const [depreciationData, setDepreciationData] = useState(null)
  const [maintenanceLogs, setMaintenanceLogs] = useState([])

  // Context lookup options
  const [peopleList, setPeopleList] = useState([])
  const [projectsList, setProjectsList] = useState([])

  // Action Drawer Sub-Views: null | 'TRANSFER' | 'RELOCATE' | 'ALLOCATE' | 'RETURN' | 'MAINTENANCE' | 'COMPLETE_MAINT'
  const [activeAction, setActiveAction] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')

  // Form States
  const [transferForm, setTransferForm] = useState({
    personId: '',
    role: 'CUSTODIAN',
    orgUnitRef: '',
    note: '',
  })
  const [relocateForm, setRelocateForm] = useState({
    branchId: '',
    locationCode: '',
    locationName: '',
    note: '',
  })
  const [allocateForm, setAllocateForm] = useState({
    projectId: '',
    purpose: '',
    exclusive: true,
  })
  const [returnForm, setReturnForm] = useState({
    returnCondition: 'GOOD',
    note: '',
  })
  const [maintenanceForm, setMaintenanceForm] = useState({
    title: '',
    issueDescription: '',
    priority: 'NORMAL',
    serviceProvider: '',
    estimatedCost: '',
  })
  const [completeMaintForm, setCompleteMaintForm] = useState({
    resolutionNotes: '',
    actualCost: '',
    newCondition: 'GOOD',
    invoiceRef: '',
  })

  // 1. Fetch Registered Assets
  const fetchAssets = useCallback(async () => {
    if (!business?.id) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        businessId: business.id,
      })
      if (search) params.set('search', search)
      if (categoryCode) params.set('categoryCode', categoryCode)
      if (status) params.set('status', status)

      const res = await fetch(`/api/assets/register?${params.toString()}`)
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch (err) {
      console.error('Failed to fetch asset register:', err)
    } finally {
      setLoading(false)
    }
  }, [business?.id, search, categoryCode, status])

  // 2. Fetch People and Projects for Dropdowns
  useEffect(() => {
    if (!business?.id) return
    async function fetchLookupData() {
      try {
        const [peopleRes, projectsRes] = await Promise.all([
          fetch(`/api/people?businessId=${business.id}`),
          fetch(`/api/projects?businessId=${business.id}`),
        ])
        if (peopleRes.ok) {
          const pJson = await peopleRes.json()
          setPeopleList(pJson.items || pJson.people || [])
        }
        if (projectsRes.ok) {
          const prJson = await projectsRes.json()
          setProjectsList(prJson.items || prJson.projects || [])
        }
      } catch (err) {
        console.error('Failed to fetch lookup data:', err)
      }
    }
    fetchLookupData()
  }, [business?.id])

  useEffect(() => {
    fetchAssets()
  }, [fetchAssets])

  // 3. Fetch Single Asset Detail with History, Depreciation, and Maintenance
  const fetchAssetDetail = useCallback(
    async (id) => {
      if (!business?.id || !id) return
      setDetailLoading(true)
      try {
        const [assetRes, depRes, maintRes] = await Promise.all([
          fetch(`/api/assets/register/${id}?businessId=${business.id}`),
          fetch(`/api/assets/register/${id}/depreciation?businessId=${business.id}`),
          fetch(`/api/assets/register/${id}/maintenance?businessId=${business.id}`),
        ])

        if (assetRes.ok) {
          const json = await assetRes.json()
          setAssetDetail(json.asset)
        }
        if (depRes.ok) {
          const depJson = await depRes.json()
          setDepreciationData(depJson)
        } else {
          setDepreciationData(null)
        }
        if (maintRes.ok) {
          const mJson = await maintRes.json()
          setMaintenanceLogs(mJson.items || [])
        } else {
          setMaintenanceLogs([])
        }
      } catch (err) {
        console.error('Failed to fetch asset detail:', err)
      } finally {
        setDetailLoading(false)
      }
    },
    [business?.id]
  )

  const openDetail = (id) => {
    setSelectedAssetId(id)
    setActiveAction(null)
    setActionError('')
    setActionSuccess('')
    fetchAssetDetail(id)
  }

  const handleMaintenanceSubmit = async (e) => {
    e.preventDefault()
    if (!maintenanceForm.title.trim()) {
      setActionError('กรุณาระบุหัวข้อหรืออาการที่ต้องการส่งซ่อม')
      return
    }
    setActionLoading(true)
    setActionError('')
    try {
      const res = await fetch(`/api/assets/register/${selectedAssetId}/maintenance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          businessId: business.id,
          action: 'CREATE',
          title: maintenanceForm.title,
          issueDescription: maintenanceForm.issueDescription,
          priority: maintenanceForm.priority,
          serviceProvider: maintenanceForm.serviceProvider,
          estimatedCost: maintenanceForm.estimatedCost || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'เกิดข้อผิดพลาดในการเปิดใบแจ้งซ่อม')
      }
      setActionSuccess('บันทึกเปิดใบแจ้งซ่อมและปรับสถานะเป็น MAINTENANCE เรียบร้อยแล้ว')
      setActiveAction(null)
      fetchAssetDetail(selectedAssetId)
      fetchAssets()
    } catch (err) {
      setActionError(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  const handleCompleteMaintenanceSubmit = async (e) => {
    e.preventDefault()
    setActionLoading(true)
    setActionError('')
    try {
      const res = await fetch(`/api/assets/register/${selectedAssetId}/maintenance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          businessId: business.id,
          action: 'COMPLETE',
          resolutionNotes: completeMaintForm.resolutionNotes,
          actualCost: completeMaintForm.actualCost || undefined,
          newCondition: completeMaintForm.newCondition,
          invoiceRef: completeMaintForm.invoiceRef || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'เกิดข้อผิดพลาดในการบันทึกซ่อมเสร็จ')
      }
      setActionSuccess('บันทึกการซ่อมบำรุงเสร็จสิ้นและคืนสถานะอุปกรณ์เรียบร้อยแล้ว')
      setActiveAction(null)
      fetchAssetDetail(selectedAssetId)
      fetchAssets()
    } catch (err) {
      setActionError(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  const copyQrUri = (code) => {
    const uri = `zuri://assets/${business?.id}/${code}?v=1`
    navigator.clipboard.writeText(uri)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Action Handlers
  const handleTransferSubmit = async (e) => {
    e.preventDefault()
    if (!transferForm.personId) {
      setActionError('กรุณาเลือกผู้รับผิดชอบ')
      return
    }
    setActionLoading(true)
    setActionError('')
    try {
      const res = await fetch(`/api/assets/register/${selectedAssetId}/responsibility`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          businessId: business.id,
          role: transferForm.role,
          personId: transferForm.personId,
          orgUnitRef: transferForm.orgUnitRef || undefined,
          note: transferForm.note || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'เกิดข้อผิดพลาดในการโอนย้ายผู้ดูแล')
      }
      setActionSuccess('โอนย้ายผู้รับผิดชอบเรียบร้อยแล้ว')
      setActiveAction(null)
      fetchAssetDetail(selectedAssetId)
      fetchAssets()
    } catch (err) {
      setActionError(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  const handleRelocateSubmit = async (e) => {
    e.preventDefault()
    if (!relocateForm.locationCode || !relocateForm.locationName) {
      setActionError('กรุณากรอกรหัสและชื่อสถานที่ตั้ง')
      return
    }
    setActionLoading(true)
    setActionError('')
    try {
      const res = await fetch(`/api/assets/register/${selectedAssetId}/relocate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          businessId: business.id,
          branchId: relocateForm.branchId || undefined,
          locationCode: relocateForm.locationCode,
          locationName: relocateForm.locationName,
          note: relocateForm.note || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'เกิดข้อผิดพลาดในการย้ายสถานที่ตั้ง')
      }
      setActionSuccess('บันทึกการเปลี่ยนสถานที่ตั้งเรียบร้อยแล้ว')
      setActiveAction(null)
      fetchAssetDetail(selectedAssetId)
      fetchAssets()
    } catch (err) {
      setActionError(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  const handleAllocateSubmit = async (e) => {
    e.preventDefault()
    if (!allocateForm.projectId) {
      setActionError('กรุณาเลือกโครงการ (Project)')
      return
    }
    setActionLoading(true)
    setActionError('')
    try {
      const res = await fetch(`/api/assets/register/${selectedAssetId}/allocate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          businessId: business.id,
          projectId: allocateForm.projectId,
          purpose: allocateForm.purpose || undefined,
          exclusive: allocateForm.exclusive,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'เกิดข้อผิดพลาดในการจัดสรรเข้าโครงการ')
      }
      setActionSuccess('จัดสรรอุปกรณ์เข้าโครงการเรียบร้อยแล้ว')
      setActiveAction(null)
      fetchAssetDetail(selectedAssetId)
      fetchAssets()
    } catch (err) {
      setActionError(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  const handleReturnSubmit = async (e) => {
    e.preventDefault()
    setActionLoading(true)
    setActionError('')
    try {
      const res = await fetch(`/api/assets/register/${selectedAssetId}/return`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          businessId: business.id,
          returnCondition: returnForm.returnCondition,
          note: returnForm.note || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'เกิดข้อผิดพลาดในการบันทึกการคืนอุปกรณ์')
      }
      setActionSuccess('บันทึกการคืนอุปกรณ์และสภาพเรียบร้อยแล้ว')
      setActiveAction(null)
      fetchAssetDetail(selectedAssetId)
      fetchAssets()
    } catch (err) {
      setActionError(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  if (!business) {
    return (
      <EmptyState
        icon={Package}
        title="กรุณาเลือก Business เพื่อจัดการทะเบียนทรัพย์สิน"
        description="คุณจำเป็นต้องเลือกบริบทธุรกิจเพื่อเข้าถึงทะเบียนและประวัติของทรัพย์สิน"
      />
    )
  }

  const activeProjectAllocation = assetDetail?.projectAllocations?.find((a) => a.status === 'ACTIVE')

  return (
    <div className="space-y-6">
      {/* 1. Statistics Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <div className="flex items-center gap-2">
            <Package size={16} className="text-muted" />
            <p className="text-[11px] font-semibold text-muted">ทรัพย์สินทั้งหมด</p>
          </div>
          <p className="mt-1 text-2xl font-bold">{data.stats.total}</p>
        </Card>
        <Card>
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} style={{ color: 'var(--success)' }} />
            <p className="text-[11px] font-semibold text-muted">พร้อมใช้งาน (Active)</p>
          </div>
          <p className="mt-1 text-2xl font-bold">{data.stats.active}</p>
        </Card>
        <Card>
          <div className="flex items-center gap-2">
            <FolderKanban size={16} style={{ color: 'var(--action-primary)' }} />
            <p className="text-[11px] font-semibold text-muted">อยู่ในโครงการ (In Use)</p>
          </div>
          <p className="mt-1 text-2xl font-bold">{data.stats.inUse}</p>
        </Card>
        <Card>
          <div className="flex items-center gap-2">
            <AlertCircle size={16} style={{ color: 'var(--warning)' }} />
            <p className="text-[11px] font-semibold text-muted">ส่งซ่อม/บำรุงรักษา</p>
          </div>
          <p className="mt-1 text-2xl font-bold">{data.stats.maintenance}</p>
        </Card>
      </div>

      {/* 2. Filter & Search Controls */}
      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
            <input
              type="text"
              placeholder="ค้นหาด้วยรหัส AST-*, ชื่อทรัพย์สิน, Serial Number, ยี่ห้อ, รุ่น..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2 pl-9 pr-4 text-xs focus:border-[var(--action-primary)] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Filter size={14} className="text-muted" />
              <select
                value={categoryCode}
                onChange={(e) => setCategoryCode(e.target.value)}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs focus:outline-none"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs focus:outline-none"
            >
              {STATUSES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </select>

            <button
              onClick={fetchAssets}
              disabled={loading}
              className="btn btn-secondary flex items-center gap-1.5 px-3 py-2 text-xs"
              title="รีเฟรชข้อมูล"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              <span>รีเฟรช</span>
            </button>

            {selectedAssetIds.size > 0 && (
              <button
                onClick={() => {
                  const toPrint = data.items.filter((item) => selectedAssetIds.has(item.id))
                  setPrintAssets(toPrint)
                  setTagModalOpen(true)
                }}
                className="btn btn-primary flex items-center gap-1.5 px-3 py-2 text-xs"
              >
                <Printer size={13} />
                <span>พิมพ์ป้าย ({selectedAssetIds.size})</span>
              </button>
            )}

            <Link
              href="/assets/scanner"
              className="btn btn-secondary flex items-center gap-1.5 px-3 py-2 text-xs text-amber-600 dark:text-amber-500 font-semibold"
            >
              <Camera size={13} />
              <span>สแกน QR / ตรวจนับ</span>
            </Link>
          </div>
        </div>
      </Card>

      {/* 3. Register Table */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[var(--border)] bg-[var(--surface-subtle)] text-[11px] font-semibold text-muted">
              <tr>
                <th className="py-3 pl-3 pr-1 w-8">
                  <input
                    type="checkbox"
                    checked={data.items.length > 0 && selectedAssetIds.size === data.items.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedAssetIds(new Set(data.items.map((i) => i.id)))
                      } else {
                        setSelectedAssetIds(new Set())
                      }
                    }}
                    className="rounded"
                    aria-label="เลือกทั้งหมด"
                  />
                </th>
                <th className="py-3 pl-2 pr-2">รหัสทรัพย์สิน</th>
                <th className="px-3 py-3">ชื่อรายการ / สเปก</th>
                <th className="px-3 py-3">หมวดหมู่</th>
                <th className="px-3 py-3">สถานะ</th>
                <th className="px-3 py-3">ผู้รับผิดชอบ / ดูแล</th>
                <th className="px-3 py-3">สถานที่ตั้ง</th>
                <th className="px-3 py-3">วันที่รับ</th>
                <th className="py-3 pl-2 pr-4 text-right">การจัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-muted">
                    <RefreshCw size={24} className="mx-auto animate-spin opacity-50" />
                    <p className="mt-2 text-xs">กำลังโหลดทะเบียนทรัพย์สิน...</p>
                  </td>
                </tr>
              ) : data.items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center">
                    <Package size={32} className="mx-auto text-muted opacity-40" />
                    <p className="mt-2 font-bold text-[13px]">ยังไม่พบทรัพย์สินที่ขึ้นทะเบียน</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {search || categoryCode || status
                        ? 'ไม่พบข้อมูลที่ตรงกับตัวกรอง กรุณาลองเปลี่ยนคำค้นหา'
                        : 'เริ่มต้นด้วยการตรวจรับอุปกรณ์และขึ้นทะเบียนจากหลักฐาน'}
                    </p>
                    <div className="mt-4 flex justify-center gap-2">
                      <Link href="/assets/receiving" className="btn btn-primary text-xs">
                        ตรวจรับอุปกรณ์ใหม่
                      </Link>
                    </div>
                  </td>
                </tr>
              ) : (
                data.items.map((asset) => (
                  <tr
                    key={asset.id}
                    onClick={() => openDetail(asset.id)}
                    className="group cursor-pointer transition-colors hover:bg-[var(--surface-subtle)]"
                  >
                    <td className="py-3 pl-3 pr-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedAssetIds.has(asset.id)}
                        onChange={(e) => {
                          const next = new Set(selectedAssetIds)
                          if (e.target.checked) next.add(asset.id)
                          else next.delete(asset.id)
                          setSelectedAssetIds(next)
                        }}
                        className="rounded"
                        aria-label={`เลือก ${asset.assetCode}`}
                      />
                    </td>
                    <td className="py-3 pl-2 pr-2 font-mono font-bold text-[var(--action-primary)]">
                      <div className="flex items-center gap-1.5">
                        <QrCode size={13} className="text-muted group-hover:text-[var(--action-primary)]" />
                        <span>{asset.assetCode}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-semibold text-foreground">{asset.name}</p>
                      {(asset.brand || asset.model || asset.serialNumber) && (
                        <p className="text-[11px] text-muted">
                          {[asset.brand, asset.model, asset.serialNumber ? `S/N: ${asset.serialNumber}` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] font-medium">
                        {asset.categoryCode}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill status={asset.status} />
                    </td>
                    <td className="px-3 py-3">
                      {asset.accountablePerson ? (
                        <div className="flex items-center gap-1.5">
                          <User size={12} className="text-muted" />
                          <span>{asset.accountablePerson.displayName || asset.accountablePerson.email}</span>
                        </div>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {asset.currentLocation ? (
                        <div className="flex items-center gap-1.5">
                          <MapPin size={12} className="text-muted" />
                          <span>{asset.currentLocation.locationName || asset.currentLocation.locationCode}</span>
                        </div>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-muted">
                      {asset.receivedOn ? new Date(asset.receivedOn).toLocaleDateString('th-TH') : '-'}
                    </td>
                    <td className="py-3 pl-2 pr-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          openDetail(asset.id)
                        }}
                        className="btn btn-secondary inline-flex items-center gap-1 p-1.5 text-[11px]"
                      >
                        <span>ดูประวัติ / จัดการ</span>
                        <ChevronRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 4. Asset Detail & Action Drawer */}
      {selectedAssetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40 backdrop-blur-xs transition-opacity">
          <div className="relative h-full w-full max-w-xl overflow-y-auto border-l border-[var(--border)] bg-[var(--surface-elevated)] p-6 shadow-2xl">
            <button
              onClick={() => setSelectedAssetId(null)}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-muted hover:bg-[var(--surface-subtle)] hover:text-foreground"
            >
              <X size={18} />
            </button>

            {detailLoading || !assetDetail ? (
              <div className="flex h-full items-center justify-center">
                <RefreshCw size={24} className="animate-spin text-muted" />
              </div>
            ) : (
              <div className="space-y-5">
                {/* Header */}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 font-mono text-xs font-bold text-[var(--action-primary)]">
                      {assetDetail.assetCode}
                    </span>
                    <StatusPill status={assetDetail.status} />
                  </div>
                  <h2 className="mt-2 text-xl font-bold">{assetDetail.name}</h2>
                  {assetDetail.description && <p className="mt-1 text-xs text-muted">{assetDetail.description}</p>}
                </div>

                {/* Notifications */}
                {actionSuccess && (
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-xs text-emerald-600">
                    <Check size={14} />
                    <span>{actionSuccess}</span>
                  </div>
                )}
                {actionError && (
                  <div className="flex items-center gap-2 rounded-xl bg-red-500/10 p-3 text-xs text-red-600">
                    <AlertCircle size={14} />
                    <span>{actionError}</span>
                  </div>
                )}

                {/* Quick Action Toolbar */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
                  <p className="text-[11px] font-bold text-muted uppercase">Lifecycle Actions</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => setActiveAction(activeAction === 'TRANSFER' ? null : 'TRANSFER')}
                      className={`btn flex items-center gap-1.5 text-xs ${
                        activeAction === 'TRANSFER' ? 'btn-primary' : 'btn-secondary'
                      }`}
                    >
                      <ArrowRightLeft size={13} />
                      <span>โอนย้ายผู้ดูแล</span>
                    </button>
                    <button
                      onClick={() => setActiveAction(activeAction === 'RELOCATE' ? null : 'RELOCATE')}
                      className={`btn flex items-center gap-1.5 text-xs ${
                        activeAction === 'RELOCATE' ? 'btn-primary' : 'btn-secondary'
                      }`}
                    >
                      <Move size={13} />
                      <span>ย้ายสถานที่</span>
                    </button>
                    {activeProjectAllocation ? (
                      <button
                        onClick={() => setActiveAction(activeAction === 'RETURN' ? null : 'RETURN')}
                        className={`btn flex items-center gap-1.5 text-xs ${
                          activeAction === 'RETURN' ? 'btn-primary' : 'btn-secondary'
                        }`}
                      >
                        <CornerUpLeft size={13} />
                        <span>บันทึกคืนจากโปรเจกต์</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => setActiveAction(activeAction === 'ALLOCATE' ? null : 'ALLOCATE')}
                        className={`btn flex items-center gap-1.5 text-xs ${
                          activeAction === 'ALLOCATE' ? 'btn-primary' : 'btn-secondary'
                        }`}
                      >
                        <FolderKanban size={13} />
                        <span>จัดสรรเข้าโปรเจกต์</span>
                      </button>
                    )}

                    {assetDetail.status === 'MAINTENANCE' ? (
                      <button
                        onClick={() => setActiveAction(activeAction === 'COMPLETE_MAINT' ? null : 'COMPLETE_MAINT')}
                        className={`btn flex items-center gap-1.5 text-xs ${
                          activeAction === 'COMPLETE_MAINT' ? 'btn-primary' : 'btn-secondary text-emerald-600'
                        }`}
                      >
                        <Check size={13} />
                        <span>บันทึกซ่อมเสร็จ</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => setActiveAction(activeAction === 'MAINTENANCE' ? null : 'MAINTENANCE')}
                        className={`btn flex items-center gap-1.5 text-xs ${
                          activeAction === 'MAINTENANCE' ? 'btn-primary' : 'btn-secondary text-amber-600'
                        }`}
                      >
                        <Wrench size={13} />
                        <span>แจ้งซ่อม / บำรุงรักษา</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Dynamic Action Forms */}
                {activeAction === 'MAINTENANCE' && (
                  <Card className="border-[var(--action-primary)] bg-[var(--surface)]">
                    <h3 className="text-xs font-bold text-amber-600 flex items-center gap-1.5">
                      <Wrench size={14} />
                      <span>เปิดใบแจ้งซ่อม / บำรุงรักษา (Maintenance Ticket)</span>
                    </h3>
                    <form onSubmit={handleMaintenanceSubmit} className="mt-3 space-y-3 text-xs">
                      <div>
                        <label className="block text-[11px] text-muted">หัวข้อ / อาการที่ต้องซ่อมบำรุง *</label>
                        <input
                          type="text"
                          placeholder="เช่น แบตเตอรี่เสื่อม, จอดับ, ซ่อมบำรุงตามระยะรอบปี"
                          value={maintenanceForm.title}
                          onChange={(e) => setMaintenanceForm({ ...maintenanceForm, title: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2"
                          required
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] text-muted">ระดับความเร่งด่วน</label>
                          <select
                            value={maintenanceForm.priority}
                            onChange={(e) => setMaintenanceForm({ ...maintenanceForm, priority: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2"
                          >
                            <option value="LOW">ต่ำ (Low)</option>
                            <option value="NORMAL">ปกติ (Normal)</option>
                            <option value="HIGH">สูง (High)</option>
                            <option value="URGENT">ด่วนฉุกเฉิน (Urgent)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted">ผู้ให้บริการ / ศูนย์ซ่อม</label>
                          <input
                            type="text"
                            placeholder="เช่น Apple Care, ศูนย์บริการภายนอก"
                            value={maintenanceForm.serviceProvider}
                            onChange={(e) => setMaintenanceForm({ ...maintenanceForm, serviceProvider: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] text-muted">ประมาณการค่าใช้จ่าย (บาท)</label>
                          <input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={maintenanceForm.estimatedCost}
                            onChange={(e) => setMaintenanceForm({ ...maintenanceForm, estimatedCost: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted">รายละเอียดเพิ่มเติม</label>
                          <input
                            type="text"
                            placeholder="หมายเหตุอาการ"
                            value={maintenanceForm.issueDescription}
                            onChange={(e) => setMaintenanceForm({ ...maintenanceForm, issueDescription: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setActiveAction(null)}
                          className="btn btn-secondary text-xs"
                        >
                          ยกเลิก
                        </button>
                        <button type="submit" disabled={actionLoading} className="btn btn-primary text-xs">
                          {actionLoading ? 'กำลังบันทึก...' : 'เปิดใบแจ้งซ่อม'}
                        </button>
                      </div>
                    </form>
                  </Card>
                )}

                {activeAction === 'COMPLETE_MAINT' && (
                  <Card className="border-emerald-500 bg-[var(--surface)]">
                    <h3 className="text-xs font-bold text-emerald-600 flex items-center gap-1.5">
                      <Check size={14} />
                      <span>บันทึกการซ่อมบำรุงเสร็จสิ้น (Complete Maintenance)</span>
                    </h3>
                    <form onSubmit={handleCompleteMaintenanceSubmit} className="mt-3 space-y-3 text-xs">
                      <div>
                        <label className="block text-[11px] text-muted">สรุปผลการซ่อม / การเปลี่ยนอะไหล่</label>
                        <input
                          type="text"
                          placeholder="เช่น เปลี่ยนแบตเตอรี่ใหม่ และทดสอบการใช้งานผ่าน"
                          value={completeMaintForm.resolutionNotes}
                          onChange={(e) => setCompleteMaintForm({ ...completeMaintForm, resolutionNotes: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] text-muted">ค่าใช้จ่ายจริง (บาท)</label>
                          <input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={completeMaintForm.actualCost}
                            onChange={(e) => setCompleteMaintForm({ ...completeMaintForm, actualCost: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted">เลขที่ใบเสร็จ / Invoice</label>
                          <input
                            type="text"
                            placeholder="INV-XXXXX"
                            value={completeMaintForm.invoiceRef}
                            onChange={(e) => setCompleteMaintForm({ ...completeMaintForm, invoiceRef: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] text-muted">สภาพหลังซ่อมเสร็จ (New Condition)</label>
                        <select
                          value={completeMaintForm.newCondition}
                          onChange={(e) => setCompleteMaintForm({ ...completeMaintForm, newCondition: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2"
                        >
                          <option value="EXCELLENT">สมบูรณ์แบบ (EXCELLENT)</option>
                          <option value="GOOD">สภาพดีพร้อมใช้งาน (GOOD)</option>
                          <option value="FAIR">พอใช้ (FAIR)</option>
                        </select>
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setActiveAction(null)}
                          className="btn btn-secondary text-xs"
                        >
                          ยกเลิก
                        </button>
                        <button type="submit" disabled={actionLoading} className="btn btn-primary text-xs">
                          {actionLoading ? 'กำลังบันทึก...' : 'ยืนยันปิดงานซ่อม'}
                        </button>
                      </div>
                    </form>
                  </Card>
                )}

                {activeAction === 'TRANSFER' && (
                  <Card className="border-[var(--action-primary)] bg-[var(--surface)]">
                    <h3 className="text-xs font-bold">โอนย้ายสิทธิ์การดูแล (Transfer Custody)</h3>
                    <form onSubmit={handleTransferSubmit} className="mt-3 space-y-3 text-xs">
                      <div>
                        <label className="block text-[11px] text-muted">เลือกผู้รับผิดชอบใหม่ *</label>
                        <select
                          value={transferForm.personId}
                          onChange={(e) => setTransferForm({ ...transferForm, personId: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2"
                          required
                        >
                          <option value="">-- เลือกบุคคลากร --</option>
                          {peopleList.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name || p.email} ({p.role || 'Member'})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] text-muted">บทบาท (Role)</label>
                          <select
                            value={transferForm.role}
                            onChange={(e) => setTransferForm({ ...transferForm, role: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2"
                          >
                            <option value="CUSTODIAN">ผู้ดูแล (Custodian)</option>
                            <option value="ACCOUNTABLE">ผู้รับผิดชอบหลัก (Accountable)</option>
                            <option value="USER">ผู้ใช้งาน (User)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted">หน่วยงาน/แผนกอ้างอิง</label>
                          <input
                            type="text"
                            placeholder="เช่น Engineering / IT"
                            value={transferForm.orgUnitRef}
                            onChange={(e) => setTransferForm({ ...transferForm, orgUnitRef: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] text-muted">หมายเหตุการส่งมอบ</label>
                        <input
                          type="text"
                          placeholder="เหตุผลการโอนย้าย เช่น สลับเครื่องประจำตำแหน่ง"
                          value={transferForm.note}
                          onChange={(e) => setTransferForm({ ...transferForm, note: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2"
                        />
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setActiveAction(null)}
                          className="btn btn-secondary text-xs"
                        >
                          ยกเลิก
                        </button>
                        <button type="submit" disabled={actionLoading} className="btn btn-primary text-xs">
                          {actionLoading ? 'กำลังบันทึก...' : 'ยืนยันโอนย้าย'}
                        </button>
                      </div>
                    </form>
                  </Card>
                )}

                {activeAction === 'RELOCATE' && (
                  <Card className="border-[var(--action-primary)] bg-[var(--surface)]">
                    <h3 className="text-xs font-bold">บันทึกการเปลี่ยนสถานที่ตั้ง (Relocate)</h3>
                    <form onSubmit={handleRelocateSubmit} className="mt-3 space-y-3 text-xs">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] text-muted">รหัสสถานที่ (Location Code) *</label>
                          <input
                            type="text"
                            placeholder="เช่น ROOM-402, FL3-LAB"
                            value={relocateForm.locationCode}
                            onChange={(e) => setRelocateForm({ ...relocateForm, locationCode: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-muted">ชื่อสถานที่ / ห้อง *</label>
                          <input
                            type="text"
                            placeholder="เช่น ห้องปฏิบัติการวิศวกรรม"
                            value={relocateForm.locationName}
                            onChange={(e) => setRelocateForm({ ...relocateForm, locationName: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2"
                            required
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] text-muted">หมายเหตุการย้าย</label>
                        <input
                          type="text"
                          placeholder="เช่น ย้ายตามทีมขยายสาขา"
                          value={relocateForm.note}
                          onChange={(e) => setRelocateForm({ ...relocateForm, note: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2"
                        />
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setActiveAction(null)}
                          className="btn btn-secondary text-xs"
                        >
                          ยกเลิก
                        </button>
                        <button type="submit" disabled={actionLoading} className="btn btn-primary text-xs">
                          {actionLoading ? 'กำลังบันทึก...' : 'ยืนยันเปลี่ยนสถานที่'}
                        </button>
                      </div>
                    </form>
                  </Card>
                )}

                {activeAction === 'ALLOCATE' && (
                  <Card className="border-[var(--action-primary)] bg-[var(--surface)]">
                    <h3 className="text-xs font-bold">จัดสรรเข้าโครงการ (Allocate to Project)</h3>
                    <form onSubmit={handleAllocateSubmit} className="mt-3 space-y-3 text-xs">
                      <div>
                        <label className="block text-[11px] text-muted">เลือกโครงการ (Project) *</label>
                        <select
                          value={allocateForm.projectId}
                          onChange={(e) => setAllocateForm({ ...allocateForm, projectId: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2"
                          required
                        >
                          <option value="">-- เลือกโครงการ --</option>
                          {projectsList.map((proj) => (
                            <option key={proj.id} value={proj.id}>
                              {proj.title} ({proj.code || 'PRJ'})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-muted">วัตถุประสงค์การใช้งานในโครงการ</label>
                        <input
                          type="text"
                          placeholder="เช่น เครื่องทดสอบสำหรับสปรินต์พัฒนา API"
                          value={allocateForm.purpose}
                          onChange={(e) => setAllocateForm({ ...allocateForm, purpose: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="exclusive-alloc"
                          checked={allocateForm.exclusive}
                          onChange={(e) => setAllocateForm({ ...allocateForm, exclusive: e.target.checked })}
                          className="rounded"
                        />
                        <label htmlFor="exclusive-alloc" className="text-[11px] text-muted">
                          เป็นการผูกขาดเฉพาะโครงการนี้ (Exclusive Allocation)
                        </label>
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setActiveAction(null)}
                          className="btn btn-secondary text-xs"
                        >
                          ยกเลิก
                        </button>
                        <button type="submit" disabled={actionLoading} className="btn btn-primary text-xs">
                          {actionLoading ? 'กำลังจัดสรร...' : 'ยืนยันจัดสรร'}
                        </button>
                      </div>
                    </form>
                  </Card>
                )}

                {activeAction === 'RETURN' && (
                  <Card className="border-[var(--action-primary)] bg-[var(--surface)]">
                    <h3 className="text-xs font-bold">บันทึกการส่งคืนอุปกรณ์จากโครงการ</h3>
                    <form onSubmit={handleReturnSubmit} className="mt-3 space-y-3 text-xs">
                      <div>
                        <label className="block text-[11px] text-muted">สภาพอุปกรณ์เมื่อส่งคืน (Return Condition)</label>
                        <select
                          value={returnForm.returnCondition}
                          onChange={(e) => setReturnForm({ ...returnForm, returnCondition: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2"
                        >
                          <option value="EXCELLENT">สมบูรณ์แบบ (EXCELLENT)</option>
                          <option value="GOOD">สภาพดีพร้อมใช้งาน (GOOD)</option>
                          <option value="FAIR">สภาพพอใช้ (FAIR)</option>
                          <option value="POOR">ต้องตรวจเช็ก/ซ่อมแซม (POOR)</option>
                          <option value="DAMAGED">ชำรุดเสียหาย (DAMAGED)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-muted">บันทึกตรวจรับคืน</label>
                        <input
                          type="text"
                          placeholder="เช่น ตรวจสอบฟังก์ชันการทำงานแล้ว ครบถ้วน"
                          value={returnForm.note}
                          onChange={(e) => setReturnForm({ ...returnForm, note: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2"
                        />
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setActiveAction(null)}
                          className="btn btn-secondary text-xs"
                        >
                          ยกเลิก
                        </button>
                        <button type="submit" disabled={actionLoading} className="btn btn-primary text-xs">
                          {actionLoading ? 'กำลังบันทึก...' : 'ยืนยันการรับคืน'}
                        </button>
                      </div>
                    </form>
                  </Card>
                )}

                {/* QR Tag Panel */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 flex items-center justify-between gap-4">
                  <div className="space-y-1 overflow-hidden">
                    <p className="text-[11px] font-bold text-muted uppercase">Digital QR Tag & Payload</p>
                    <p className="font-mono text-xs break-all text-amber-700 dark:text-amber-500 font-semibold">
                      zuri://assets/{business.id}/{assetDetail.assetCode}?v=1
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => copyQrUri(assetDetail.assetCode)}
                        className="btn btn-secondary flex items-center gap-1 text-xs"
                      >
                        {copied ? <Check size={13} style={{ color: 'var(--success)' }} /> : <Copy size={13} />}
                        <span>{copied ? 'คัดลอกแล้ว' : 'คัดลอก URI'}</span>
                      </button>
                      <button
                        onClick={() => {
                          setPrintAssets([assetDetail])
                          setTagModalOpen(true)
                        }}
                        className="btn btn-primary flex items-center gap-1 text-xs"
                      >
                        <Printer size={13} />
                        <span>พิมพ์ป้าย QR</span>
                      </button>
                    </div>
                  </div>
                  <div className="shrink-0 bg-white p-1 rounded-lg border border-gray-200 shadow-xs">
                    <QrCodeSvg
                      value={`zuri://assets/${business.id}/${assetDetail.assetCode}?v=1`}
                      size={72}
                    />
                  </div>
                </div>

                {/* Specs Grid */}
                <div>
                  <SectionTitle caption="ข้อมูลจำเพาะและรหัสอ้างอิงทางกายภาพ">สเปกและรายละเอียด</SectionTitle>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg border border-[var(--border)] p-2.5">
                      <p className="text-[10px] text-muted">ยี่ห้อ (Brand)</p>
                      <p className="font-semibold">{assetDetail.brand || '-'}</p>
                    </div>
                    <div className="rounded-lg border border-[var(--border)] p-2.5">
                      <p className="text-[10px] text-muted">รุ่น (Model)</p>
                      <p className="font-semibold">{assetDetail.model || '-'}</p>
                    </div>
                    <div className="rounded-lg border border-[var(--border)] p-2.5">
                      <p className="text-[10px] text-muted">Serial Number</p>
                      <p className="font-mono font-semibold">{assetDetail.serialNumber || '-'}</p>
                    </div>
                    <div className="rounded-lg border border-[var(--border)] p-2.5">
                      <p className="text-[10px] text-muted">สภาพ (Condition)</p>
                      <p className="font-semibold">{assetDetail.condition || 'GOOD'}</p>
                    </div>
                    <div className="rounded-lg border border-[var(--border)] p-2.5">
                      <p className="text-[10px] text-muted">ยอดจัดซื้อ (Acquisition)</p>
                      <p className="font-semibold">
                        {assetDetail.acquisitionAmount
                          ? `${Number(assetDetail.acquisitionAmount).toLocaleString()} ${assetDetail.currency || 'THB'}`
                          : '-'}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[var(--border)] p-2.5">
                      <p className="text-[10px] text-muted">วันที่ขึ้นทะเบียน</p>
                      <p className="font-semibold">
                        {assetDetail.registeredAt ? new Date(assetDetail.registeredAt).toLocaleDateString('th-TH') : '-'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Depreciation Schedule Card (FR-136) */}
                <div>
                  <div className="flex items-center justify-between">
                    <SectionTitle caption="การคำนวณค่าเสื่อมราคาแบบเส้นตรง (Straight-Line Preview)">
                      ตารางค่าเสื่อมราคา (Depreciation Schedule)
                    </SectionTitle>
                    {depreciationData && (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                        {depreciationData.status || 'PREVIEW'}
                      </span>
                    )}
                  </div>

                  {depreciationData ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2.5">
                          <p className="text-[10px] text-muted">อายุการใช้งาน</p>
                          <p className="font-bold">{depreciationData.usefulLifeMonths} เดือน</p>
                        </div>
                        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2.5">
                          <p className="text-[10px] text-muted">มูลค่าซาก (Residual)</p>
                          <p className="font-bold">{Number(depreciationData.residualValue).toLocaleString()} {depreciationData.currency}</p>
                        </div>
                        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2.5">
                          <p className="text-[10px] text-muted">ค่าเสื่อม/เดือน</p>
                          <p className="font-bold text-[var(--action-primary)]">
                            {depreciationData.monthlyDepreciation || depreciationData.schedule?.[0]?.depreciation
                              ? `${Number(depreciationData.monthlyDepreciation || depreciationData.schedule[0].depreciation).toLocaleString()} ${depreciationData.currency}`
                              : '-'}
                          </p>
                        </div>
                      </div>

                      <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[11px]">
                        <table className="w-full text-left">
                          <thead className="border-b border-[var(--border)] bg-[var(--surface-subtle)] text-[10px] text-muted sticky top-0">
                            <tr>
                              <th className="p-2">งวดที่</th>
                              <th className="p-2">รอบเดือน</th>
                              <th className="p-2 text-right">ค่าเสื่อมงวดนี้</th>
                              <th className="p-2 text-right">ค่าเสื่อมสะสม</th>
                              <th className="p-2 text-right">มูลค่าสุทธิ (NBV)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--border)]">
                            {depreciationData.schedule?.slice(0, 12).map((s) => (
                              <tr key={s.period} className="hover:bg-[var(--surface-subtle)]">
                                <td className="p-2 font-mono">#{s.period}</td>
                                <td className="p-2">{s.periodStart || s.month}</td>
                                <td className="p-2 text-right font-mono">{Number(s.depreciation || s.depreciationAmount).toLocaleString()}</td>
                                <td className="p-2 text-right font-mono">{Number(s.accumulatedDepreciation).toLocaleString()}</td>
                                <td className="p-2 text-right font-mono font-semibold">{Number(s.bookValue).toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {depreciationData.schedule?.length > 12 && (
                        <p className="text-center text-[10px] text-muted">
                          แสดงตัวอย่าง 12 งวดแรก จากทั้งหมด {depreciationData.schedule.length} งวด
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted">ไม่มีข้อมูลตารางค่าเสื่อมราคา</p>
                  )}
                </div>

                {/* Maintenance Service History (AM-RQ-050..053) */}
                <div>
                  <SectionTitle caption="ประวัติการเปิดใบแจ้งซ่อม บำรุงรักษา และการเปลี่ยนอะไหล่">
                    ประวัติการซ่อมบำรุง (Maintenance History)
                  </SectionTitle>
                  {maintenanceLogs.length === 0 ? (
                    <p className="text-xs text-muted">ไม่มีประวัติการส่งซ่อมบำรุง</p>
                  ) : (
                    <div className="space-y-2">
                      {maintenanceLogs.map((m) => (
                        <div
                          key={m.id}
                          className="rounded-lg border border-[var(--border)] p-2.5 text-xs space-y-1 bg-[var(--surface)]"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-foreground flex items-center gap-1.5">
                              <Wrench size={12} className={m.action === 'ASSET_MAINTENANCE_LOGGED' ? 'text-amber-500' : 'text-emerald-500'} />
                              <span>{m.title || (m.action === 'ASSET_MAINTENANCE_COMPLETED' ? 'ปิดงานซ่อมบำรุง' : 'แจ้งซ่อม')}</span>
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                m.action === 'ASSET_MAINTENANCE_LOGGED'
                                  ? 'bg-amber-500/10 text-amber-600'
                                  : 'bg-emerald-500/10 text-emerald-600'
                              }`}
                            >
                              {m.action === 'ASSET_MAINTENANCE_LOGGED' ? 'เปิดงานซ่อม' : 'ซ่อมเสร็จ'}
                            </span>
                          </div>
                          {m.issueDescription && <p className="text-[11px] text-muted">{m.issueDescription}</p>}
                          {m.resolutionNotes && <p className="text-[11px] text-emerald-700 dark:text-emerald-400">ผลการซ่อม: {m.resolutionNotes}</p>}
                          <div className="flex items-center justify-between text-[10px] text-muted pt-1">
                            <span>
                              {m.serviceProvider ? `ศูนย์บริการ: ${m.serviceProvider}` : ''}
                              {m.actualCost ? ` · ค่าใช้จ่ายจริง: ${Number(m.actualCost).toLocaleString()} บาท` : m.estimatedCost ? ` · ประมาณการ: ${Number(m.estimatedCost).toLocaleString()} บาท` : ''}
                            </span>
                            <span>{new Date(m.occurredAt || m.loggedAt || m.completedAt).toLocaleDateString('th-TH')}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Printable Tag Modal */}
      <AssetTagModal
        assets={printAssets}
        businessName={business?.name || 'Zuri Business'}
        isOpen={tagModalOpen}
        onClose={() => setTagModalOpen(false)}
      />
    </div>
  )
}
