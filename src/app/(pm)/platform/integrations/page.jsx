'use client'

import { useMemo, useState } from 'react'
import {
  KeyRound, ShieldCheck, Users, MessageSquare, Clock, Plus,
  CheckCircle2, Search, ArrowLeft, ExternalLink, Settings, Sparkles,
  Bot, RefreshCw, AlertTriangle, Layers, Database, Mail, Folder,
  Github, Globe, Radio, ChevronRight, Building2, Copy, Check
} from 'lucide-react'

import { Card, ErrorState, Field, PageHeader, SectionTitle, StatusPill } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api, LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'
import { LLM_PROVIDER_CATALOG, providerByKey } from '@/platform/integrations/llm/provider-catalog'
import { isSupabaseVaultSecretRef } from '@/platform/integrations/core/secret-manager'

// @req FR-080 — Platform Integrations & Connectors Marketplace Hub
// @spec ADR-032 D1-D4, SEC-016, SDD-044, NFR-008
// @tested tests/unit/fr080-ui-contract.test.js, tests/unit/line-registry-service.test.js

const SECRET_REF_ERROR_ID = 'integration-secret-ref-error'
const SECRET_REF_ERROR_TEXT = 'รูปแบบไม่ถูกต้อง — ต้องเป็น supabase-vault:<uuid> เท่านั้น ห้ามวางค่า secret จริงที่นี่'

const HEALTH_HINT = {
  CONNECTED: 'ทำงานปกติ',
  DEGRADED: 'ยังพิสูจน์ไม่ได้ว่าทำงานอยู่',
  ERROR: 'ใช้งานไม่ได้',
  DISABLED: 'ปิดใช้งานอยู่',
  MISCONFIGURED: 'ตั้งค่าไม่ครบ',
}

function HealthPanel({ health, kind }) {
  if (!health) return null
  const { state, reasons = [], evidence = {} } = health
  const lastEvent = evidence.lastEventAt ? new Date(evidence.lastEventAt).toLocaleString() : null
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Health</span>
        <StatusPill status={state} />
        <span className="text-muted">{HEALTH_HINT[state] || ''}</span>
      </div>
      {reasons.length > 0 && (
        <ul className="mt-1.5 list-disc pl-4 text-muted">
          {reasons.map((reason) => <li key={reason} className="font-mono">{reason}</li>)}
        </ul>
      )}
      {kind === 'CHANNEL' && (
        <p className="mt-1.5 text-muted">
          รับ event ล่าสุด: {lastEvent || 'ยังไม่เคยรับ event'}
        </p>
      )}
    </div>
  )
}

function IntegrationRow({ row }) {
  const isChannel = row.kind === 'CHANNEL'
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold">{row.name}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {isChannel ? 'Channel' : 'Model provider'} · {row.providerName || row.provider}
            {isChannel ? '' : ` · ${row.model || 'Model not set'}`}
          </p>
        </div>
        <StatusPill status={row.status} />
      </div>
      {!isChannel && (
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-3 text-[11px] max-md:grid-cols-1">
          <div><span className="text-muted">Secret reference</span><p className="font-mono">{row.secretRefMasked || 'ยังไม่ได้ผูก Vault reference'}</p></div>
          <div><span className="text-muted">Version / expiry</span><p>{row.credentialVersion || '—'} · {row.expiresAt ? new Date(row.expiresAt).toLocaleString() : 'refresh deadline 5m'}</p></div>
        </div>
      )}
      <HealthPanel health={row.health} kind={row.kind} />
    </Card>
  )
}

const DEPARTMENT_LABELS = {
  SALES_TEAM: 'ทีมเซลล์ / ฝ่ายขาย (Sales)',
  EXECUTIVE: 'ทีมผู้บริหาร (Executive)',
  OPERATIONS: 'ทีมปฏิบัติการ / โรงงาน (Operations)',
  SUPPORT: 'ทีมบริการลูกค้า (Support)',
  GENERAL: 'ทั่วไป (General)',
}

const CONNECTORS_CATALOG = [
  {
    id: 'line-oa',
    name: 'LINE Official Account',
    description: 'แชตบอตซูริตอบลูกค้าอัตโนมัติ พร้อมระบบลงทะเบียนกลุ่มและส่งสรุปรายงาน',
    type: 'Channel / Ingress',
    badge: 'Primary Channel',
    category: 'CHANNELS',
    iconColor: '#06C755',
    isPopular: true,
    status: 'CONNECTED',
    hasCustomView: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (LLM Models)',
    description: 'เราเตอร์โมเดลปัญญาประดิษฐ์ เชื่อมต่อ Claude 3.5, GPT-4o, Gemini Flash',
    type: 'AI Models',
    badge: 'AI Core',
    category: 'AI_MODELS',
    iconColor: '#6366F1',
    isPopular: true,
    status: 'CONNECTED',
    hasCustomView: true,
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'ส่งแจ้งเตือนและข้อความอัตโนมัติเข้า Slack Workspaces ของทีมงาน',
    type: 'Channel / Web',
    badge: 'Community',
    category: 'CHANNELS',
    iconColor: '#E01E5A',
    isPopular: true,
    status: 'AVAILABLE',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'ซิงค์ฐานข้อมูลเอกสาร Project Wiki และ Task เข้าสู่ Zuri Workspace',
    type: 'Docs / Workspace',
    badge: 'Productivity',
    category: 'TOOLS',
    iconColor: '#000000',
    isPopular: true,
    status: 'AVAILABLE',
  },
  {
    id: 'microsoft-365',
    name: 'Microsoft 365',
    description: 'เชื่อมต่อ Outlook, Teams และ OneDrive สำหรับการทำงานร่วมกันในองค์กร',
    type: 'Enterprise',
    badge: 'Enterprise',
    category: 'TOOLS',
    iconColor: '#0078D4',
    isPopular: true,
    status: 'AVAILABLE',
  },
  {
    id: 'google-gemini',
    name: 'Google Gemini',
    description: 'เชื่อมต่อ Google Gemini Pro และ Flash สำหรับการประมวลผลเอกสาร',
    type: 'AI Models',
    badge: 'AI Core',
    category: 'AI_MODELS',
    iconColor: '#4285F4',
    status: 'AVAILABLE',
  },
  {
    id: 'vercel-webhook',
    name: 'Vercel Ingress & Webhooks',
    description: 'ช่องทางรับ Webhook เหตุการณ์อัตโนมัติจาก Vercel Cloud Serverless',
    type: 'Web',
    badge: 'Infrastructure',
    category: 'TOOLS',
    iconColor: '#000000',
    status: 'CONNECTED',
  },
  {
    id: 'gmail-alerts',
    name: 'Gmail & Email Dispatcher',
    description: 'ระบบส่งอีเมลแจ้งเตือนใบเสนอราคาและรายงานยอดขายประจำสัปดาห์',
    type: 'Web',
    badge: 'Mail',
    category: 'CHANNELS',
    iconColor: '#EA4335',
    status: 'AVAILABLE',
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'ดึงและซิงค์ตารางนัดหมายลูกค้าและกำหนดการส่งมอบงาน',
    type: 'Web',
    badge: 'Calendar',
    category: 'TOOLS',
    iconColor: '#4285F4',
    status: 'AVAILABLE',
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'จัดเก็บและแชร์เอกสาร สัญญาซื้อขาย และไฟล์แนบของโครงการ',
    type: 'Storage',
    badge: 'Storage',
    category: 'TOOLS',
    iconColor: '#34A853',
    status: 'AVAILABLE',
  },
  {
    id: 'github',
    name: 'GitHub Repositories',
    description: 'เชื่อมต่อคลังซอร์สโค้ดและติดตามสถานะงานพัฒนา Software Sprint',
    type: 'Code',
    badge: 'DevOps',
    category: 'TOOLS',
    iconColor: '#24292E',
    status: 'CONNECTED',
  },
]

export default function IntegrationsPage() {
  const scope = useScope()
  const businesses = scope.businesses || []
  const currentBusiness = scope.currentBusiness || businesses[0]

  // View state: 'CATALOG' | 'LINE_SETTINGS' | 'MODEL_SETTINGS'
  const [activeView, setActiveView] = useState('CATALOG')
  const [filterTab, setFilterTab] = useState('ALL') // 'ALL' | 'CONNECTED' | 'NOT_CONNECTED'
  const [searchQuery, setSearchQuery] = useState('')

  // Target business for registration
  const [targetBusinessId, setTargetBusinessId] = useState(currentBusiness?.id || '')
  const selectedBusiness = useMemo(() => {
    return businesses.find((b) => b.id === targetBusinessId) || currentBusiness
  }, [businesses, targetBusinessId, currentBusiness])

  const businessId = selectedBusiness?.id || currentBusiness?.id || ''
  const tenantId = selectedBusiness?.tenant?.id || '77cdbe70-3111-4a04-922a-8059be99a8b0'
  const tenantCode = selectedBusiness?.tenant?.code || 'TNT-ETOHGROUP'

  // LINE Settings Sub-tabs: 'GROUPS' | 'USERS' | 'WEBHOOK'
  const [lineTab, setLineTab] = useState('GROUPS')

  const path = `/api/platform/integrations${businessId ? `?businessId=${encodeURIComponent(businessId)}` : ''}`
  const integrations = useFetch(path, [businessId])

  const registryPath = `/api/platform/integrations/line-registry${businessId ? `?businessId=${encodeURIComponent(businessId)}` : ''}`
  const lineRegistry = useFetch(registryPath, [businessId, activeView, lineTab])

  // Model form state
  const [provider, setProvider] = useState('openrouter')
  const [name, setName] = useState('Phase 1 LLM')
  const [model, setModel] = useState('')
  const [secretRef, setSecretRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)

  // LINE Group form state
  const [groupName, setGroupName] = useState('')
  const [groupId, setGroupId] = useState('')
  const [groupUrl, setGroupUrl] = useState('')
  const [departmentType, setDepartmentType] = useState('SALES_TEAM')
  const [enableDailyReport, setEnableDailyReport] = useState(true)
  const [reportSchedule, setReportSchedule] = useState('0 9 * * *')
  const [groupBusy, setGroupBusy] = useState(false)
  const [groupMessage, setGroupMessage] = useState(null)
  const [groupError, setGroupError] = useState(null)

  // LINE User form state
  const [userDisplayName, setUserDisplayName] = useState('')
  const [lineUserId, setLineUserId] = useState('')
  const [userRole, setUserRole] = useState('Sales Executive')
  const [userDepartment, setUserDepartment] = useState('ฝ่ายขาย')
  const [userBusy, setUserBusy] = useState(false)
  const [userMessage, setUserMessage] = useState(null)
  const [userError, setUserError] = useState(null)

  const [copiedKey, setCopiedKey] = useState(null)
  const copyToClipboard = (key, text) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const rows = useMemo(() => Array.isArray(integrations.data) ? integrations.data : [], [integrations.data])
  const registryRows = useMemo(() => Array.isArray(lineRegistry.data) ? lineRegistry.data : [], [lineRegistry.data])

  const groupRows = useMemo(() => registryRows.filter((r) => r.kind === 'GROUP'), [registryRows])
  const userRows = useMemo(() => registryRows.filter((r) => r.kind === 'USER'), [registryRows])

  const secretRefTrimmed = secretRef.trim()
  const secretRefInvalid = secretRefTrimmed.length > 0 && !isSupabaseVaultSecretRef(secretRefTrimmed)

  // Filtered Catalog
  const filteredCatalog = useMemo(() => {
    return CONNECTORS_CATALOG.filter((item) => {
      if (filterTab === 'CONNECTED' && item.status !== 'CONNECTED') return false
      if (filterTab === 'NOT_CONNECTED' && item.status === 'CONNECTED') return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        return item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q) || item.type.toLowerCase().includes(q)
      }
      return true
    })
  }, [filterTab, searchQuery])

  const submitModel = async (event) => {
    event.preventDefault()
    if (secretRefInvalid) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await api('/api/platform/integrations', {
        method: 'POST',
        body: {
          businessId,
          provider,
          name: name.trim(),
          model: model.trim(),
          secretRef: secretRef.trim() || undefined,
        },
      })
      setMessage('บันทึก connection metadata แล้ว')
      setSecretRef('')
      await integrations.reload()
    } catch (caught) {
      setError(caught?.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const submitLineGroup = async (event) => {
    event.preventDefault()
    setGroupBusy(true)
    setGroupError(null)
    setGroupMessage(null)
    try {
      const automationJobs = enableDailyReport ? [
        {
          name: 'สรุปยอดขายและสถานะงานประจำวัน',
          schedule: reportSchedule,
          action: 'PUSH_DAILY_SALES_REPORT',
          enabled: true,
        }
      ] : []

      await api('/api/platform/integrations/line-registry', {
        method: 'POST',
        body: {
          businessId,
          name: groupName.trim(),
          groupId: groupId.trim(),
          groupUrl: groupUrl.trim() || undefined,
          departmentType,
          automationJobs,
        },
      })
      setGroupMessage('บันทึกข้อมูล LINE Group พร้อมผูก Tenant & Business ID สำเร็จ')
      setGroupName('')
      setGroupId('')
      setGroupUrl('')
      await lineRegistry.reload()
    } catch (caught) {
      setGroupError(caught?.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setGroupBusy(false)
    }
  }

  const submitLineUser = async (event) => {
    event.preventDefault()
    setUserBusy(true)
    setUserError(null)
    setUserMessage(null)
    try {
      await api('/api/platform/integrations/line-registry', {
        method: 'POST',
        body: {
          businessId,
          displayName: userDisplayName.trim(),
          userId: lineUserId.trim(),
          role: userRole.trim(),
          department: userDepartment.trim() || undefined,
        },
      })
      setUserMessage('บันทึกข้อมูล LINE User พร้อมผูก Tenant & Business ID สำเร็จ')
      setUserDisplayName('')
      setLineUserId('')
      await lineRegistry.reload()
    } catch (caught) {
      setUserError(caught?.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setUserBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}
      {activeView === 'CATALOG' ? (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Connectors</h1>
            <p className="mt-0.5 text-xs text-muted">
              จัดการช่องทางเชื่อมต่อ LINE Official Account, สมองกล AI และเครื่องมืออัตโนมัติในเครือ {selectedBusiness?.name || 'EtohGroup'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                className="input h-9 pl-8 text-xs min-w-[200px]"
                placeholder="Search connectors…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary h-9 text-xs font-semibold"
              onClick={() => setActiveView('LINE_SETTINGS')}
            >
              <Plus size={14} className="mr-1" /> Add Connector
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn btn-secondary h-8 px-2.5 text-xs"
              onClick={() => setActiveView('CATALOG')}
            >
              <ArrowLeft size={14} className="mr-1" /> Back to Connectors
            </button>
            <div>
              <h1 className="text-lg font-bold flex items-center gap-2">
                {activeView === 'LINE_SETTINGS' && (
                  <>
                    <span className="h-3 w-3 rounded-full bg-[#06C755]" />
                    LINE Official Account Hub
                  </>
                )}
                {activeView === 'MODEL_SETTINGS' && (
                  <>
                    <span className="h-3 w-3 rounded-full bg-[#6366F1]" />
                    AI Model & Provider Settings
                  </>
                )}
              </h1>
              <p className="text-[11px] text-muted">
                {activeView === 'LINE_SETTINGS' ? 'จัดการห้องแชตกลุ่ม, รายชื่อผู้ใช้ และระบบตั้งเวลางานอัตโนมัติ' : 'ตั้งค่า Vault reference และ Model AI'}
              </p>
            </div>
          </div>
          <span className="rounded bg-[var(--surface-muted)] px-2.5 py-1 text-[11px] font-semibold text-muted">
            {selectedBusiness ? selectedBusiness.name : 'All Businesses'}
          </span>
        </div>
      )}

      {/* VIEW 1: CONNECTORS CATALOG */}
      {activeView === 'CATALOG' && (
        <div className="space-y-6">
          {/* POPULAR SECTION */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted mb-3">Popular</p>
            <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
              {/* LINE Card */}
              <div
                onClick={() => setActiveView('LINE_SETTINGS')}
                className="group flex cursor-pointer items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] p-3.5 transition-all hover:border-[var(--brand-dark)] hover:shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#06C755] text-white font-bold">
                    <MessageSquare size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-bold">LINE Official Account</p>
                    <p className="text-[10px] text-muted">แชตบอตซูริ &amp; Groups Hub</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary h-7 px-2.5 text-[11px] font-semibold"
                  onClick={(e) => {
                    e.stopPropagation()
                    setActiveView('LINE_SETTINGS')
                  }}
                >
                  Configure
                </button>
              </div>

              {/* Slack Card */}
              <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] p-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E01E5A]/15 text-[#E01E5A] font-bold">
                    <Layers size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-bold">Slack</p>
                    <p className="text-[10px] text-muted">Workspace Alerts</p>
                  </div>
                </div>
                <button type="button" className="btn btn-secondary h-7 px-2.5 text-[11px]">Connect</button>
              </div>

              {/* Notion Card */}
              <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] p-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/10 text-black dark:text-white font-bold">
                    <Database size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-bold">Notion</p>
                    <p className="text-[10px] text-muted">Project Knowledge Wiki</p>
                  </div>
                </div>
                <button type="button" className="btn btn-secondary h-7 px-2.5 text-[11px]">Connect</button>
              </div>
            </div>
          </div>

          {/* FILTER TABS */}
          <div className="flex items-center gap-2 border-b border-[var(--border)] pb-2.5">
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${filterTab === 'ALL' ? 'bg-[var(--foreground)] text-[var(--background)]' : 'text-muted hover:text-[var(--foreground)]'}`}
              onClick={() => setFilterTab('ALL')}
            >
              All ({filteredCatalog.length})
            </button>
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${filterTab === 'CONNECTED' ? 'bg-[var(--foreground)] text-[var(--background)]' : 'text-muted hover:text-[var(--foreground)]'}`}
              onClick={() => setFilterTab('CONNECTED')}
            >
              Connected
            </button>
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${filterTab === 'NOT_CONNECTED' ? 'bg-[var(--foreground)] text-[var(--background)]' : 'text-muted hover:text-[var(--foreground)]'}`}
              onClick={() => setFilterTab('NOT_CONNECTED')}
            >
              Not connected
            </button>
          </div>

          {/* CONNECTORS TABLE */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
            <div className="grid grid-cols-12 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5 text-[11px] font-semibold text-muted">
              <div className="col-span-6">Connector</div>
              <div className="col-span-3">Type</div>
              <div className="col-span-3 text-right">Status / Action</div>
            </div>

            <div className="divide-y divide-[var(--border)]">
              {filteredCatalog.map((item) => {
                const isLine = item.id === 'line-oa'
                const isModel = item.id === 'openrouter'

                return (
                  <div
                    key={item.id}
                    className="grid grid-cols-12 items-center px-4 py-3 hover:bg-[var(--brand-surface)] transition-colors cursor-pointer"
                    onClick={() => {
                      if (isLine) setActiveView('LINE_SETTINGS')
                      else if (isModel) setActiveView('MODEL_SETTINGS')
                    }}
                  >
                    <div className="col-span-6 flex items-center gap-3">
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white font-bold"
                        style={{ backgroundColor: item.iconColor }}
                      >
                        {isLine ? <MessageSquare size={16} /> : isModel ? <Bot size={16} /> : item.name.slice(0, 1)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate flex items-center gap-1.5">
                          {item.name}
                          {isLine && (
                            <span className="rounded-full bg-[#06C755]/15 px-2 py-0.5 text-[10px] font-semibold text-[#06C755]">
                              {groupRows.length} Groups Registered
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-muted truncate">{item.description}</p>
                      </div>
                    </div>

                    <div className="col-span-3 flex items-center gap-1.5">
                      <span className="text-xs text-muted">{item.type}</span>
                      <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] text-muted">
                        {item.badge}
                      </span>
                    </div>

                    <div className="col-span-3 flex items-center justify-end gap-2">
                      {item.status === 'CONNECTED' ? (
                        <>
                          <span className="flex items-center gap-1 text-xs text-[var(--success)] font-medium">
                            <CheckCircle2 size={13} /> Connected
                          </span>
                          <button
                            type="button"
                            className="btn btn-secondary h-7 px-2 text-[11px] font-semibold"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (isLine) setActiveView('LINE_SETTINGS')
                              else if (isModel) setActiveView('MODEL_SETTINGS')
                            }}
                          >
                            Settings <ChevronRight size={12} className="ml-0.5" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary h-7 px-3 text-[11px]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Connect
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: LINE OFFICIAL ACCOUNT SETTINGS & REGISTRY HUB */}
      {activeView === 'LINE_SETTINGS' && (
        <div className="space-y-4">
          {/* SCOPE & TENANT CONTEXT CARD */}
          <div className="rounded-xl border border-[var(--brand-dark)]/20 bg-[var(--brand-surface)] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Building2 size={16} className="text-[var(--brand-dark)]" />
                <span className="text-xs font-bold text-[var(--foreground)]">ขอบเขตองค์กรและธุรกิจ (Tenant &amp; Business Scope):</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">เลือกธุรกิจ:</span>
                <select
                  className="input h-8 text-xs font-semibold py-0 pr-6"
                  value={targetBusinessId || businessId}
                  onChange={(e) => setTargetBusinessId(e.target.value)}
                >
                  {businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-3 border-t border-[var(--border)]/60 pt-2.5 text-xs max-md:grid-cols-1">
              <div className="flex items-center justify-between rounded bg-[var(--card)] px-2.5 py-1.5">
                <span className="text-muted">Tenant ID (tntid):</span>
                <div className="flex items-center gap-1.5 font-mono text-[11px]">
                  <span className="font-bold text-[var(--foreground)]">{tenantCode}</span>
                  <span className="text-muted">({tenantId.slice(0, 8)}…)</span>
                  <button
                    type="button"
                    className="text-muted hover:text-[var(--foreground)]"
                    onClick={() => copyToClipboard('tenantId', tenantId)}
                    title="Copy Full Tenant ID"
                  >
                    {copiedKey === 'tenantId' ? <Check size={12} className="text-[var(--success)]" /> : <Copy size={12} />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between rounded bg-[var(--card)] px-2.5 py-1.5">
                <span className="text-muted">Business ID (busid):</span>
                <div className="flex items-center gap-1.5 font-mono text-[11px]">
                  <span className="font-bold text-[var(--foreground)]">{selectedBusiness?.code || 'BUS-SMARTGIFT'}</span>
                  <span className="text-muted">({businessId.slice(0, 8)}…)</span>
                  <button
                    type="button"
                    className="text-muted hover:text-[var(--foreground)]"
                    onClick={() => copyToClipboard('businessId', businessId)}
                    title="Copy Full Business ID"
                  >
                    {copiedKey === 'businessId' ? <Check size={12} className="text-[var(--success)]" /> : <Copy size={12} />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="flex gap-2 border-b border-[var(--border)] pb-2">
            <button
              type="button"
              className={`btn text-xs font-semibold ${lineTab === 'GROUPS' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setLineTab('GROUPS')}
            >
              <MessageSquare size={14} className="mr-1.5" /> 👥 ห้องแชตกลุ่ม (LINE Groups Registry) ({groupRows.length})
            </button>
            <button
              type="button"
              className={`btn text-xs font-semibold ${lineTab === 'USERS' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setLineTab('USERS')}
            >
              <Users size={14} className="mr-1.5" /> 👤 สมาชิก / พนักงาน (LINE Users Registry) ({userRows.length})
            </button>
            <button
              type="button"
              className={`btn text-xs font-semibold ${lineTab === 'WEBHOOK' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setLineTab('WEBHOOK')}
            >
              <Radio size={14} className="mr-1.5" /> 📡 LINE Ingress &amp; Webhook
            </button>
          </div>

          {/* TAB: GROUPS */}
          {lineTab === 'GROUPS' && (
            <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
              <Card>
                <SectionTitle caption={`ผูกกับธุรกิจ: ${selectedBusiness?.name || 'SmartGift'} (tnt: ${tenantCode})`}>
                  ลงทะเบียน LINE Group ใหม่
                </SectionTitle>
                <form onSubmit={submitLineGroup} className="space-y-3">
                  <Field label="ชื่อกลุ่ม (Group Name)">
                    <input
                      className="input"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      placeholder="เช่น SmartGift - ทีมเซลล์องค์กร"
                      required
                    />
                  </Field>
                  <Field label="LINE Group ID (ขึ้นต้นด้วย C)" hint="ดูจากข้อความตอบกลับของบอท หรือ Vercel Ingress Logs">
                    <div className="flex gap-2">
                      <input
                        className="input font-mono"
                        value={groupId}
                        onChange={(e) => setGroupId(e.target.value)}
                        placeholder="C423a5c290822a200bf061623aeb2c713"
                        required
                      />
                      <button
                        type="button"
                        className="btn btn-secondary text-xs shrink-0"
                        onClick={() => setGroupId('C423a5c290822a200bf061623aeb2c713')}
                      >
                        ใส่ Test Group
                      </button>
                    </div>
                  </Field>
                  <Field label="ประเภทกลุ่ม / แผนก (Department Type)">
                    <select
                      className="input"
                      value={departmentType}
                      onChange={(e) => setDepartmentType(e.target.value)}
                    >
                      {Object.entries(DEPARTMENT_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="ลิงก์เชิญเข้ากลุ่ม (Group URL - ไม่บังคับ)">
                    <input
                      className="input"
                      value={groupUrl}
                      onChange={(e) => setGroupUrl(e.target.value)}
                      placeholder="https://line.me/R/ti/g/..."
                    />
                  </Field>

                  {/* Automation Section */}
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold flex items-center gap-1.5">
                        <Clock size={13} /> งานส่งรายงานอัตโนมัติ (Automate Job)
                      </span>
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={enableDailyReport}
                          onChange={(e) => setEnableDailyReport(e.target.checked)}
                        />
                        เปิดใช้งาน
                      </label>
                    </div>
                    {enableDailyReport && (
                      <div className="mt-2.5 space-y-2 border-t border-[var(--border)] pt-2 text-xs">
                        <p className="text-muted">ส่งสรุปยอดขาย รายการ Lead ใหม่ และสถิติประจำวันเข้ากลุ่มนี้อัตโนมัติ</p>
                        <Field label="รอบเวลาส่ง (Cron Expression)" hint="0 9 * * * = ทุกวัน เวลา 09:00 น.">
                          <input
                            className="input font-mono text-xs"
                            value={reportSchedule}
                            onChange={(e) => setReportSchedule(e.target.value)}
                            required
                          />
                        </Field>
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary w-full"
                    disabled={groupBusy || !businessId || !groupName.trim() || !groupId.trim()}
                  >
                    <Plus size={14} /> {groupBusy ? 'กำลังบันทึก…' : `บันทึก LINE Group ลงใน ${selectedBusiness?.name || 'Business'}`}
                  </button>
                </form>
                {groupMessage && <p className="mt-2 text-xs text-[var(--success)]" role="status">{groupMessage}</p>}
                {groupError && <p className="mt-2 text-xs text-[var(--danger)]" role="alert">{groupError}</p>}
              </Card>

              <div>
                <SectionTitle caption="ห้องแชตกลุ่มที่ลงทะเบียนและผูกสิทธิ์กับระบบไว้">
                  กลุ่มที่ลงทะเบียนแล้ว ({groupRows.length})
                </SectionTitle>
                {groupRows.length === 0 ? (
                  <Card>
                    <p className="text-xs text-muted">ยังไม่มีกลุ่ม LINE ที่ลงทะเบียนในระบบ</p>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {groupRows.map((row) => (
                      <Card key={row.id}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-bold">{row.name}</p>
                            <p className="mt-0.5 text-xs text-muted">
                              {DEPARTMENT_LABELS[row.metadata?.departmentType] || 'ทั่วไป'}
                            </p>
                          </div>
                          <StatusPill status={row.status} />
                        </div>

                        {/* TNT & BUSINESS BADGES */}
                        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-mono">
                          <div className="rounded bg-[var(--surface-muted)] px-2 py-1 flex items-center justify-between">
                            <span className="text-muted">tntid:</span>
                            <span className="font-bold text-[var(--foreground)] truncate ml-1">{row.tenantCode || row.tenantId?.slice(0, 8) || 'TNT-ETOH'}</span>
                          </div>
                          <div className="rounded bg-[var(--surface-muted)] px-2 py-1 flex items-center justify-between">
                            <span className="text-muted">busid:</span>
                            <span className="font-bold text-[var(--brand-dark)] truncate ml-1">{row.businessCode || row.businessName || row.businessId?.slice(0, 8)}</span>
                          </div>
                        </div>

                        <div className="mt-2 rounded bg-[var(--surface-muted)] p-2 text-xs font-mono text-muted">
                          GroupID: {row.externalAccountId}
                        </div>

                        {Array.isArray(row.metadata?.automationJobs) && row.metadata.automationJobs.length > 0 && (
                          <div className="mt-2.5 border-t border-[var(--border)] pt-2 text-xs">
                            <span className="font-semibold text-muted">Automate Jobs:</span>
                            <ul className="mt-1 space-y-1">
                              {row.metadata.automationJobs.map((job, idx) => (
                                <li key={idx} className="flex items-center gap-1 text-[11px] text-muted">
                                  <CheckCircle2 size={12} className="text-[var(--success)]" /> {job.name} ({job.schedule})
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: USERS */}
          {lineTab === 'USERS' && (
            <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
              <Card>
                <SectionTitle caption={`ผูกกับธุรกิจ: ${selectedBusiness?.name || 'SmartGift'} (tnt: ${tenantCode})`}>
                  ลงทะเบียน LINE User / ทีมงานรายบุคคล
                </SectionTitle>
                <form onSubmit={submitLineUser} className="space-y-3">
                  <Field label="ชื่อผู้ใช้ / ชื่อพนักงาน">
                    <input
                      className="input"
                      value={userDisplayName}
                      onChange={(e) => setUserDisplayName(e.target.value)}
                      placeholder="เช่น สมชาย เซลล์อาวุโส"
                      required
                    />
                  </Field>
                  <Field label="LINE User ID (ขึ้นต้นด้วย U)" hint="ดูจาก LINE Webhook Logs เมื่อผู้ใช้พิมพ์คุยกับบอท">
                    <input
                      className="input font-mono"
                      value={lineUserId}
                      onChange={(e) => setLineUserId(e.target.value)}
                      placeholder="U2962d3754b3390ec16c5a74ea154f742"
                      required
                    />
                  </Field>
                  <Field label="ตำแหน่ง / บทบาท (Role)">
                    <input
                      className="input"
                      value={userRole}
                      onChange={(e) => setUserRole(e.target.value)}
                      placeholder="เช่น Sales Manager, Operations Head"
                      required
                    />
                  </Field>
                  <Field label="แผนก (Department)">
                    <input
                      className="input"
                      value={userDepartment}
                      onChange={(e) => setUserDepartment(e.target.value)}
                      placeholder="เช่น ฝ่ายขาย, ฝ่ายบริหาร"
                    />
                  </Field>
                  <button
                    type="submit"
                    className="btn btn-primary w-full"
                    disabled={userBusy || !businessId || !userDisplayName.trim() || !lineUserId.trim()}
                  >
                    <Plus size={14} /> {userBusy ? 'กำลังบันทึก…' : `บันทึก LINE User ลงใน ${selectedBusiness?.name || 'Business'}`}
                  </button>
                </form>
                {userMessage && <p className="mt-2 text-xs text-[var(--success)]" role="status">{userMessage}</p>}
                {userError && <p className="mt-2 text-xs text-[var(--danger)]" role="alert">{userError}</p>}
              </Card>

              <div>
                <SectionTitle caption="รายชื่อพนักงานและผู้ใช้ LINE ที่ลงทะเบียนไว้">
                  ผู้ใช้ที่ลงทะเบียนแล้ว ({userRows.length})
                </SectionTitle>
                {userRows.length === 0 ? (
                  <Card>
                    <p className="text-xs text-muted">ยังไม่มีรายชื่อผู้ใช้ LINE ที่ลงทะเบียนในระบบ</p>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {userRows.map((row) => (
                      <Card key={row.id}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-bold">{row.name}</p>
                            <p className="mt-0.5 text-xs text-muted">
                              {row.metadata?.role || 'สมาชิก'} · {row.metadata?.department || 'ทั่วไป'}
                            </p>
                          </div>
                          <StatusPill status={row.status} />
                        </div>

                        {/* TNT & BUSINESS BADGES */}
                        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-mono">
                          <div className="rounded bg-[var(--surface-muted)] px-2 py-1 flex items-center justify-between">
                            <span className="text-muted">tntid:</span>
                            <span className="font-bold text-[var(--foreground)] truncate ml-1">{row.tenantCode || row.tenantId?.slice(0, 8) || 'TNT-ETOH'}</span>
                          </div>
                          <div className="rounded bg-[var(--surface-muted)] px-2 py-1 flex items-center justify-between">
                            <span className="text-muted">busid:</span>
                            <span className="font-bold text-[var(--brand-dark)] truncate ml-1">{row.businessCode || row.businessName || row.businessId?.slice(0, 8)}</span>
                          </div>
                        </div>

                        <div className="mt-2 rounded bg-[var(--surface-muted)] p-2 text-xs font-mono text-muted">
                          UserID: {row.externalAccountId}
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: WEBHOOK */}
          {lineTab === 'WEBHOOK' && (
            <div className="space-y-4">
              <Card>
                <SectionTitle caption="การเชื่อมต่อ LINE Messaging API Webhook URL">
                  Webhook Configuration
                </SectionTitle>
                <div className="space-y-3 text-xs">
                  <div>
                    <span className="font-semibold text-muted">Webhook URL สำหรับนำไปใส่ใน LINE Developers Console:</span>
                    <div className="mt-1.5 flex items-center gap-2 rounded bg-[var(--surface-muted)] p-2.5 font-mono text-[11px]">
                      <span className="flex-1 select-all">https://zuri-ai-woad.vercel.app/api/agent/line-webhook</span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] p-3 space-y-2">
                    <p className="font-semibold text-[var(--foreground)]">✅ สิ่งที่ระบบจัดการให้อัตโนมัติ:</p>
                    <ul className="list-disc pl-4 space-y-1 text-muted">
                      <li>ตรวจสอบ Webhook Verification Challenge จาก LINE Developer อัตโนมัติ</li>
                      <li>เชื่อมต่อสมองกล Zuri Brand Persona และองค์ความรู้ SmartGift Catalog</li>
                      <li>แยกแยะห้องแชตกลุ่ม (Group ID) และผู้ส่ง (User ID) ลงในระบบอัตโนมัติ</li>
                      <li>ส่งข้อความตอบกลับไปยัง LINE Messaging API แบบ Real-time ทันที</li>
                    </ul>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* VIEW 3: AI MODEL & PROVIDER SETTINGS */}
      {activeView === 'MODEL_SETTINGS' && (
        <>
          <Card warm className="mb-4">
            <div className="flex items-start gap-2">
              <ShieldCheck size={16} style={{ color: 'var(--action-primary)' }} aria-hidden />
              <p className="text-[11px] leading-5">สร้าง secret ใน Supabase Dashboard → Vault ก่อน แล้วนำมาใส่เฉพาะ reference รูปแบบ <code>supabase-vault:&lt;uuid&gt;</code> ที่นี่ หน้านี้จะไม่รับหรือแสดงค่า secret จริง</p>
            </div>
          </Card>
          <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
            <Card>
              <SectionTitle caption={selectedBusiness ? `Business ปัจจุบัน: ${selectedBusiness.name}` : 'เลือก Business จากตัวเลือกด้านบนก่อนสร้าง connection'}>เพิ่ม connection metadata</SectionTitle>
              <form onSubmit={submitModel}>
                <Field label="Provider">
                  <select className="input" value={provider} onChange={(event) => setProvider(event.target.value)} aria-label="Provider">
                    {LLM_PROVIDER_CATALOG.map(({ key, name }) => <option key={key} value={key}>{name}</option>)}
                  </select>
                </Field>
                <Field label="ชื่อ connection">
                  <input className="input" value={name} onChange={(event) => setName(event.target.value)} required aria-label="ชื่อ connection" />
                </Field>
                <Field label="Model">
                  <input className="input" value={model} onChange={(event) => setModel(event.target.value)} placeholder={`เช่น ${providerByKey(provider)?.modelHint ?? ''}`} required aria-label="Model" />
                </Field>
                <Field label="Supabase Vault reference" hint="ไม่ใช่ API key — ใส่เฉพาะ supabase-vault:<uuid> เท่านั้น">
                  <input
                    className="input font-mono"
                    value={secretRef}
                    onChange={(event) => setSecretRef(event.target.value)}
                    placeholder="supabase-vault:…"
                    aria-label="Supabase Vault reference"
                    aria-invalid={secretRefInvalid}
                    aria-describedby={secretRefInvalid ? SECRET_REF_ERROR_ID : undefined}
                  />
                  {secretRefInvalid && (
                    <p id={SECRET_REF_ERROR_ID} role="alert" className="mt-0.5 text-[10px] text-[var(--danger)]">
                      {SECRET_REF_ERROR_TEXT}
                    </p>
                  )}
                </Field>
                <button type="submit" className="btn btn-primary" disabled={busy || !businessId || !name.trim() || !model.trim() || secretRefInvalid}>
                  <KeyRound size={13} aria-hidden /> {busy ? 'กำลังบันทึก…' : 'บันทึก metadata'}
                </button>
              </form>
              {message && <p className="mt-2 text-[11px]" role="status">{message}</p>}
              {error && <p className="mt-2 text-[11px] text-[var(--danger)]" role="alert">{error}</p>}
            </Card>
            <div>
              <SectionTitle caption="Model provider ที่สร้างจากหน้านี้ และ LINE OA channel ที่ ingress บันทึกหลักฐานไว้">Connections</SectionTitle>
              {rows.length === 0
                ? <Card><p className="text-[11px] text-muted">ยังไม่มี connection ในขอบเขตนี้</p></Card>
                : <div className="space-y-3">{rows.map((row) => <IntegrationRow key={row.id} row={row} />)}</div>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
