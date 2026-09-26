'use client'

// @req FR-173 — Knowledge source admission, queue monitor and corpus query in the Knowledge (GKS) slot
// @spec ADR-072, ADR-085, SEC-001, SEC-008
// @tested tests/unit/knowledge-documents-ui.test.js

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import {
  UploadCloud, FileText, Search, ListChecks, RefreshCw, Trash2,
  ExternalLink, CheckCircle2, AlertCircle, Clock, FileCheck, Layers,
  ChevronDown, ChevronUp, Copy, BookOpen
} from 'lucide-react'
import {
  PageHeader, Card, SectionTitle, Field, StatusPill, ErrorState, EmptyState
} from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api, useFetch, LoadingCard } from '@/modules/project-manager/components/useApi'

const TEMPLATES = [
  {
    name: 'โครง FAQ',
    title: 'FAQ — ร่าง',
    sourceKey: 'faq-draft',
    content: `# คำถามที่พบบ่อย

> เติมคำตอบจากข้อมูลที่ Business อนุมัติแล้วเท่านั้น

## คำถาม
คำตอบ:
`,
  },
  {
    name: 'โครงนโยบาย',
    title: 'นโยบาย — ร่าง',
    sourceKey: 'policy-draft',
    content: `# นโยบาย

> ระบุขอบเขต ผู้อนุมัติ และวันที่มีผลจากเอกสารจริง

## ขอบเขต
-

## ข้อกำหนด
1.
`,
  },
  {
    name: 'โครงเอกสาร',
    title: 'เอกสารความรู้ — ร่าง',
    sourceKey: 'knowledge-document-draft',
    content: `# ชื่อเอกสาร

> เติมเฉพาะข้อเท็จจริงที่ตรวจสอบและอนุมัติแล้ว

## ขอบเขต
-

## เนื้อหา
`,
  },
]

const MAX_TEXT_UPLOAD_BYTES = 1024 * 1024
const SUPPORTED_TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown'])

export default function KnowledgeDocumentsView({ initialTab = 'intake' }) {
  const scope = useScope()
  const businessId = scope.currentBusiness?.id || scope.shell?.activeBusinessId || ''
  const businessName = scope.currentBusiness?.name || 'Current Business'
  const [activeTab, setActiveTab] = useState(initialTab)
  const [message, setMessage] = useState(null)
  const [messageType, setMessageType] = useState('info')

  const notify = (msg, type = 'info') => {
    setMessage(msg)
    setMessageType(type)
    if (type === 'success') {
      setTimeout(() => setMessage(null), 5000)
    }
  }

  // Scoped knowledge admission list fetch with auto-poll for running jobs
  const queryPath = businessId ? `/api/knowledge/ingestions?businessId=${encodeURIComponent(businessId)}` : null
  const [admissions, setAdmissions] = useState({ data: null, loading: Boolean(queryPath), error: null })
  const pollTimerRef = useRef(null)

  const reloadAdmissions = useCallback(async () => {
    if (!queryPath) {
      setAdmissions({ data: null, loading: false, error: null })
      return
    }
    try {
      const data = await api(queryPath)
      setAdmissions({ data, loading: false, error: null })
    } catch (err) {
      setAdmissions({ data: null, loading: false, error: err.message })
    }
  }, [queryPath])

  useEffect(() => {
    reloadAdmissions()
  }, [reloadAdmissions])

  // Auto poll every 3s if any admission is QUEUED or RUNNING
  useEffect(() => {
    const items = admissions.data?.items || []
    const hasActive = items.some((item) => ['QUEUED', 'RUNNING'].includes(item.status))
    if (hasActive) {
      pollTimerRef.current = setTimeout(reloadAdmissions, 3000)
    }
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [admissions.data, reloadAdmissions])

  // Business FileAssets fetch for 1-click admission
  const filesPath = businessId ? `/api/business/files?businessId=${encodeURIComponent(businessId)}` : null
  const businessFiles = useFetch(filesPath, [businessId])

  if (!businessId) {
    return (
      <div className="space-y-4" data-testid="knowledge-documents-view">
        <PageHeader
          eyebrow="KNOWLEDGE (GKS)"
          title="Documents & Intake"
          subtitle="อัพโหลดและนำเข้าเอกสาร Text/Markdown ของ Business ผ่าน Knowledge admission queue ของ zuri-ai"
        />
        <EmptyState
          title="กรุณาเลือก Business"
          hint="เลือก Business ที่ต้องการจากแถบด้านบน เพื่อเข้าถึงการจัดการเอกสารความรู้"
        />
      </div>
    )
  }

  return (
    <div className="space-y-5" data-testid="knowledge-documents-view">
      <PageHeader
        eyebrow="KNOWLEDGE (GKS)"
        title="Documents & Intake"
        subtitle={`อัพโหลด นำเข้า และจัดการเอกสาร Text/Markdown สำหรับ ${businessName} ผ่าน Knowledge admission queue (17 stages; local/isolated surface)`}
        actions={
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[var(--brand-tint)] px-3 py-1 text-xs font-semibold text-[var(--brand-dark)]">
              {businessName}
            </span>
            <button
              type="button"
              className="btn flex items-center gap-1 text-xs"
              onClick={reloadAdmissions}
              aria-label="Refresh admissions"
            >
              <RefreshCw size={13} /> รีเฟรช
            </button>
          </div>
        }
      />

      {/* Notification Banner */}
      {message && (
        <div
          role="alert"
          className={`flex items-start justify-between rounded-lg p-3 text-xs ${
            messageType === 'error'
              ? 'bg-[var(--danger-bg)] text-[var(--danger)] border border-[var(--danger)]/30'
              : messageType === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {messageType === 'error' ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
            <span>{message}</span>
          </div>
          <button
            type="button"
            className="text-xs font-bold hover:underline"
            onClick={() => setMessage(null)}
          >
            ปิด
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex border-b border-[var(--border)] gap-2" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'intake'}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-semibold transition ${
            activeTab === 'intake'
              ? 'border-[var(--action-primary)] text-[var(--action-primary)]'
              : 'border-transparent text-muted hover:text-[var(--text)]'
          }`}
          onClick={() => setActiveTab('intake')}
          data-testid="tab-intake"
        >
          <UploadCloud size={15} /> อัพโหลดและเพิ่มเอกสาร (Intake)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'queue'}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-semibold transition ${
            activeTab === 'queue'
              ? 'border-[var(--action-primary)] text-[var(--action-primary)]'
              : 'border-transparent text-muted hover:text-[var(--text)]'
          }`}
          onClick={() => setActiveTab('queue')}
          data-testid="tab-queue"
        >
          <ListChecks size={15} /> สถานะคิวประมวลผล (Queue)
          {admissions.data?.items?.length > 0 && (
            <span className="rounded-full bg-[var(--mid-surface)] px-1.5 py-0.2 text-[10px] text-muted">
              {admissions.data.items.length}
            </span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'search'}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-semibold transition ${
            activeTab === 'search'
              ? 'border-[var(--action-primary)] text-[var(--action-primary)]'
              : 'border-transparent text-muted hover:text-[var(--text)]'
          }`}
          onClick={() => setActiveTab('search')}
          data-testid="tab-search"
        >
          <Search size={15} /> ค้นหาความรู้ & Citation (Query)
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === 'intake' && (
        <IntakeTabPanel
          businessId={businessId}
          businessFiles={businessFiles}
          onSuccess={(jobId, text, type = 'success') => {
            notify(text || `ส่งเอกสารเข้าคิวเรียบร้อย (Job ID: ${jobId})`, type)
            reloadAdmissions()
          }}
          onError={(err) => notify(err, 'error')}
        />
      )}

      {activeTab === 'queue' && (
        <QueueTabPanel
          admissions={admissions}
          onReload={reloadAdmissions}
          onWithdrawSuccess={(sourceId) => {
            notify(`ถอน source ${sourceId} ออกจากคลังความรู้สำเร็จ`, 'success')
            reloadAdmissions()
          }}
          onError={(err) => notify(err, 'error')}
        />
      )}

      {activeTab === 'search' && (
        <SearchTabPanel
          businessId={businessId}
          onError={(err) => notify(err, 'error')}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 1: Intake Panel (Dropzone, Manual Entry, Existing FileAssets)
// ---------------------------------------------------------------------------
// The structured SmartGift format the admission API accepts on a FILE source (FR-187).
// Kept as a literal: importing the adapter would pull zod into the client bundle.
export const SMARTGIFT_CATALOG_FORMAT = 'SMARTGIFT_CATALOG_V1'

export function existingAssetAdmissionBody({ businessId, asset, format = null }) {
  return {
    businessId,
    projectId: null,
    idempotencyKey: `asset:${format ? `${format}:` : ''}${asset.id}:${asset.sha256 || asset.version || Date.now()}`,
    source: {
      kind: 'FILE',
      fileAssetId: asset.id,
      ...(format ? { format } : {}),
    },
  }
}

export function catalogAdmissionMessage(admission) {
  return `SmartGift catalog: เข้าคิว ${admission.admittedCount}/${admission.recordCount} record · ไม่เปลี่ยน ${admission.unchangedCount} · ถูกปฏิเสธ ${admission.deniedCount}`
}

export function catalogUploadMessage(result) {
  if (result.knowledgeStatus && result.knowledgeStatus !== 'ADMITTED') {
    const status = result.knowledgeStatus === 'UNAVAILABLE' ? 'ยังไม่พร้อม' : 'ไม่สำเร็จ'
    const code = result.knowledgeCode ? ` (${result.knowledgeCode})` : ''
    return `${result.fileName} · บันทึกไฟล์ต้นฉบับแล้ว · Knowledge ${status}${code}`
  }
  return `${result.fileName}${result.reused ? ' (ไฟล์เดิม)' : ''} · ${catalogAdmissionMessage(result.admission)}`
}

export function catalogUploadBody({ businessId, fileName, contentBase64 }) {
  return { businessId, projectId: null, name: fileName, contentBase64 }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.readAsDataURL(file)
  })
}

// Mode 4: upload a catalog JSON straight to the private knowledge store and
// admit it as a structured projection (POST /api/knowledge/catalog-files).
function CatalogUploadCard({ businessId, onSuccess, onError, onUploaded }) {
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    if (!file) return onError('กรุณาเลือกไฟล์ .json')
    setBusy(true)
    try {
      const res = await api('/api/knowledge/catalog-files', {
        method: 'POST',
        body: catalogUploadBody({ businessId, fileName: file.name, contentBase64: await readFileAsBase64(file) }),
      })
      setFile(null)
      onUploaded?.()
      onSuccess(null, catalogUploadMessage(res), res.knowledgeStatus === 'ADMITTED' ? 'success' : 'info')
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="space-y-3" data-testid="catalog-upload">
      <SectionTitle caption="ไฟล์ JSON ของ SmartGift catalog (ProductMaster / BundleOffer / PriceListEntry) จะถูกตรวจรูปแบบ เก็บใน storage ส่วนตัว (MinIO) และแยกเข้าคลังความรู้ทีละ record">
        อัพโหลด SmartGift catalog
      </SectionTitle>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
        <input className="input flex-1" type="file" accept=".json,application/json" onChange={(event) => setFile(event.target.files?.[0] || null)} data-testid="catalog-upload-file" />
        <button className="btn btn-primary text-xs flex items-center gap-1" type="submit" disabled={busy || !file}>
          <UploadCloud size={13} /> {busy ? 'กำลังอัพโหลด…' : 'อัพโหลดและนำเข้า'}
        </button>
      </form>
    </Card>
  )
}

export function isTextAsset(asset) {
  const name = (asset.name || '').toLowerCase()
  return name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.markdown') || asset.mime?.includes('markdown') || asset.mime === 'text/plain'
}

export function isCatalogAsset(asset) {
  return (asset.name || '').toLowerCase().endsWith('.json') || asset.mime === 'application/json'
}

function IntakeTabPanel({ businessId, businessFiles, onSuccess, onError }) {
  const [uploadMode, setUploadMode] = useState('file') // 'file' | 'editor' | 'asset' | 'catalog'
  const [dragOver, setDragOver] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileContent, setFileContent] = useState('')
  const [title, setTitle] = useState('')
  const [sourceKey, setSourceKey] = useState('')
  const [version, setVersion] = useState('1.0')
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Direct Editor State
  const [editorTitle, setEditorTitle] = useState('')
  const [editorSourceKey, setEditorSourceKey] = useState('')
  const [editorVersion, setEditorVersion] = useState('1.0')
  const [editorContent, setEditorContent] = useState('')

  const handleFile = async (file) => {
    if (!file) return
    const name = String(file.name || '').toLowerCase()
    const extension = name.slice(name.lastIndexOf('.'))
    if (!SUPPORTED_TEXT_EXTENSIONS.has(extension)) {
      onError('รองรับเฉพาะไฟล์ .txt, .md หรือ .markdown')
      return
    }
    if (file.size > MAX_TEXT_UPLOAD_BYTES) {
      onError('ไฟล์เอกสารต้องมีขนาดไม่เกิน 1 MiB')
      return
    }
    try {
      const text = await file.text()
      setSelectedFile(file)
      setFileContent(text)
      const baseName = file.name.replace(/\.[^/.]+$/, '')
      const cleanSlug = baseName.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'document'
      setTitle(baseName)
      setSourceKey(cleanSlug)
      setVersion('1.0')
      setPreviewExpanded(text.length < 500)
    } catch (err) {
      onError(`ไม่สามารถอ่านไฟล์ได้: ${err.message}`)
    }
  }

  const submitFileUpload = async (e) => {
    e.preventDefault()
    if (!selectedFile || !fileContent.trim()) {
      onError('กรุณาเลือกไฟล์ที่มีเนื้อหา')
      return
    }
    setSubmitting(true)
    try {
      const idempotencyKey = `upload:${sourceKey.trim()}:${Date.now()}`
      const payload = {
        businessId,
        projectId: null,
        idempotencyKey,
        source: {
          kind: 'TEXT',
          sourceKey: sourceKey.trim() || selectedFile.name,
          version: version.trim() || '1.0',
          title: title.trim() || selectedFile.name,
          content: fileContent,
        },
      }

      const res = await api('/api/knowledge/ingestions', {
        method: 'POST',
        body: payload,
      })

      setSelectedFile(null)
      setFileContent('')
      setTitle('')
      setSourceKey('')
      onSuccess(res.admissionId || res.id)
    } catch (err) {
      onError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const submitEditorInput = async (e) => {
    e.preventDefault()
    if (!editorContent.trim()) {
      onError('กรุณากรอกเนื้อหาเอกสาร')
      return
    }
    if (!editorSourceKey.trim()) {
      onError('กรุณาระบุ Source Key')
      return
    }
    setSubmitting(true)
    try {
      const key = editorSourceKey.trim()
      const idempotencyKey = `editor:${key}:${Date.now()}`
      const payload = {
        businessId,
        projectId: null,
        idempotencyKey,
        source: {
          kind: 'TEXT',
          sourceKey: key,
          version: editorVersion.trim() || '1.0',
          title: editorTitle.trim() || key,
          content: editorContent,
        },
      }

      const res = await api('/api/knowledge/ingestions', {
        method: 'POST',
        body: payload,
      })

      setEditorContent('')
      setEditorTitle('')
      setEditorSourceKey('')
      onSuccess(res.admissionId || res.id)
    } catch (err) {
      onError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // `format` names a structured projection (FR-187). The server then splits the
  // file into one source per record; without it a JSON file is refused.
  const admitExistingAsset = async (asset, format = null) => {
    try {
      const res = await api('/api/knowledge/ingestions', {
        method: 'POST',
        body: existingAssetAdmissionBody({ businessId, asset, format }),
      })
      if (format) {
        onSuccess(null, catalogAdmissionMessage(res))
        return
      }
      onSuccess(res.admissionId || res.id)
    } catch (err) {
      onError(err.message)
    }
  }

  const applyTemplate = (tpl) => {
    setEditorTitle(tpl.title)
    setEditorSourceKey(tpl.sourceKey)
    setEditorVersion('1.0')
    setEditorContent(tpl.content)
  }

  return (
    <div className="space-y-4">
      {/* Mode Switcher */}
      <div className="flex gap-2">
        <button
          type="button"
          className={`btn text-xs ${uploadMode === 'file' ? 'btn-primary' : ''}`}
          onClick={() => setUploadMode('file')}
          data-testid="mode-file"
        >
          <UploadCloud size={14} className="mr-1 inline" /> อัพโหลดไฟล์ (.md / .txt)
        </button>
        <button
          type="button"
          className={`btn text-xs ${uploadMode === 'editor' ? 'btn-primary' : ''}`}
          onClick={() => setUploadMode('editor')}
          data-testid="mode-editor"
        >
          <FileText size={14} className="mr-1 inline" /> พิมพ์หรือวาง Markdown โดยตรง
        </button>
        <button
          type="button"
          className={`btn text-xs ${uploadMode === 'asset' ? 'btn-primary' : ''}`}
          onClick={() => setUploadMode('asset')}
          data-testid="mode-asset"
        >
          <Layers size={14} className="mr-1 inline" /> เลือกจาก File Assets ในระบบ
        </button>
        <button
          type="button"
          className={`btn text-xs ${uploadMode === 'catalog' ? 'btn-primary' : ''}`}
          onClick={() => setUploadMode('catalog')}
          data-testid="mode-catalog"
        >
          <FileCheck size={14} className="mr-1 inline" /> อัพโหลด SmartGift catalog (.json)
        </button>
      </div>

      {uploadMode === 'catalog' && (
        <CatalogUploadCard businessId={businessId} onSuccess={onSuccess} onError={onError} onUploaded={businessFiles.reload} />
      )}

      {/* Mode 1: File Dropzone & Details */}
      {uploadMode === 'file' && (
        <Card className="space-y-4">
          <SectionTitle caption="รองรับเอกสารข้อความ UTF-8 (.md, .markdown, .txt) ขนาดไม่เกิน 1 MiB">
            อัพโหลดเอกสารเข้าสู่ระบบความรู้
          </SectionTitle>

          {/* Dropzone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const file = e.dataTransfer.files?.[0]
              if (file) handleFile(file)
            }}
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition ${
              dragOver
                ? 'border-[var(--brand-dark)] bg-[var(--brand-surface)]'
                : 'border-[var(--border)] hover:border-[var(--brand-dark)]/50 bg-[var(--app-surface)]'
            }`}
            data-testid="file-dropzone"
          >
            <UploadCloud size={32} className="text-[var(--brand-dark)] mb-2" />
            <p className="text-sm font-semibold">ลากและวางไฟล์เอกสารที่นี่ หรือคลิกเพื่อเลือกไฟล์</p>
            <p className="text-xs text-muted mt-1">.txt, .md หรือ .markdown</p>
            <label className="btn btn-primary mt-3 cursor-pointer text-xs">
              เลือกไฟล์จากเครื่อง
              <input
                type="file"
                className="hidden"
                accept=".txt,.md,.markdown,text/plain,text/markdown"
                onChange={(e) => handleFile(e.target.files?.[0])}
                data-testid="file-input"
              />
            </label>
          </div>

          {/* Selected File Form */}
          {selectedFile && (
            <form onSubmit={submitFileUpload} className="space-y-3 rounded-lg border border-[var(--border)] p-4 bg-[var(--card)]">
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={18} className="text-[var(--brand-dark)] shrink-0" />
                  <span className="font-semibold text-xs truncate">{selectedFile.name}</span>
                  <span className="text-[10px] text-muted shrink-0">({(selectedFile.size / 1024).toFixed(1)} KB)</span>
                </div>
                <button
                  type="button"
                  className="text-xs text-[var(--danger)] hover:underline"
                  onClick={() => { setSelectedFile(null); setFileContent('') }}
                >
                  ยกเลิก
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="ชื่อเอกสาร (Title)">
                  <input
                    className="input text-xs"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    placeholder="ชื่อที่ปรากฏในผลค้นหา"
                    data-testid="input-title"
                  />
                </Field>
                <Field label="Source Key (รหัสเอกสาร)">
                  <input
                    className="input text-xs font-mono"
                    value={sourceKey}
                    onChange={(e) => setSourceKey(e.target.value)}
                    required
                    placeholder="เช่น policy-guideline-v1"
                    data-testid="input-source-key"
                  />
                </Field>
                <Field label="เวอร์ชัน (Version)">
                  <input
                    className="input text-xs font-mono"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    required
                    placeholder="1.0"
                    data-testid="input-version"
                  />
                </Field>
              </div>

              {/* Content Preview Toggle */}
              <div>
                <button
                  type="button"
                  className="flex items-center gap-1 text-[11px] font-semibold text-[var(--brand-dark)] hover:underline"
                  onClick={() => setPreviewExpanded(!previewExpanded)}
                >
                  {previewExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  {previewExpanded ? 'ซ่อนตัวอย่างเนื้อหา' : 'แสดงตัวอย่างเนื้อหาไฟล์ (Preview)'}
                </button>
                {previewExpanded && (
                  <pre className="mt-2 max-h-48 overflow-auto rounded border border-[var(--border)] p-2 text-[11px] font-mono bg-[var(--mid-surface)] text-[var(--text)]">
                    {fileContent.slice(0, 2000)}
                    {fileContent.length > 2000 ? '\n... (เนื้อหาถูกตัดทอนสำหรับการแสดงผลตัวอย่าง)' : ''}
                  </pre>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="submit"
                  className="btn btn-primary text-xs flex items-center gap-1.5"
                  disabled={submitting}
                  data-testid="submit-admission"
                >
                  <UploadCloud size={14} />
                  {submitting ? 'กำลังส่งเข้าคิว...' : 'Queue Admission (นำเข้าสู่คลังความรู้)'}
                </button>
              </div>
            </form>
          )}
        </Card>
      )}

      {/* Mode 2: Direct Markdown Editor */}
      {uploadMode === 'editor' && (
        <Card className="space-y-4">
          <SectionTitle caption="สร้างหรือแก้ไขเนื้อหาความรู้แบบ Markdown โดยตรง พร้อมชุดแม่แบบเริ่มต้น">
            พิมพ์หรือวางข้อความ Markdown
          </SectionTitle>

          {/* Templates Picker */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted flex items-center gap-1">
              <BookOpen size={13} /> แม่แบบเริ่มต้น:
            </span>
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.sourceKey}
                type="button"
                className="btn text-[11px] py-1 px-2.5 hover:border-[var(--brand-dark)]"
                onClick={() => applyTemplate(tpl)}
              >
                {tpl.name}
              </button>
            ))}
          </div>

          <form onSubmit={submitEditorInput} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="ชื่อเอกสาร (Title)">
                <input
                  className="input text-xs"
                  value={editorTitle}
                  onChange={(e) => setEditorTitle(e.target.value)}
                  required
                  placeholder="เช่น คู่มือขั้นตอนการทำงาน"
                  data-testid="editor-title"
                />
              </Field>
              <Field label="Source Key">
                <input
                  className="input text-xs font-mono"
                  value={editorSourceKey}
                  onChange={(e) => setEditorSourceKey(e.target.value)}
                  required
                  placeholder="manual-operation-v1"
                  data-testid="editor-source-key"
                />
              </Field>
              <Field label="เวอร์ชัน">
                <input
                  className="input text-xs font-mono"
                  value={editorVersion}
                  onChange={(e) => setEditorVersion(e.target.value)}
                  required
                  placeholder="1.0"
                />
              </Field>
            </div>

            <Field label="เนื้อหาเอกสาร (Markdown)">
              <textarea
                className="input min-h-[220px] font-mono text-xs leading-relaxed"
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                required
                placeholder="# พาดหัวหลัก&#10;&#10;รายละเอียดข้อความ และหัวข้อย่อย..."
                data-testid="editor-content"
              />
            </Field>

            <div className="flex justify-end">
              <button
                type="submit"
                className="btn btn-primary text-xs flex items-center gap-1.5"
                disabled={submitting}
                data-testid="editor-submit"
              >
                <UploadCloud size={14} />
                {submitting ? 'กำลังส่งเข้าคิว...' : 'Queue Admission (นำเข้าความรู้)'}
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* Mode 3: Existing FileAssets Intake */}
      {uploadMode === 'asset' && (
        <Card className="space-y-3">
          <SectionTitle caption="เลือกไฟล์ Text/Markdown หรือ SmartGift catalog (.json) ที่เคยอัพโหลดไว้ในระบบ File Manager เพื่อนำเข้าคลังความรู้">
            ไฟล์ในระบบของ Business นี้
          </SectionTitle>

          {businessFiles.loading && <LoadingCard />}
          {businessFiles.error && <ErrorState detail={businessFiles.error} retry={businessFiles.reload} />}

          {!businessFiles.loading && !businessFiles.error && (
            <div className="space-y-2">
              {(businessFiles.data?.assets || []).filter((a) => {
                return isTextAsset(a) || isCatalogAsset(a)
              }).length === 0 ? (
                <p className="text-xs text-muted p-4 text-center">ไม่มีไฟล์ Text, Markdown หรือ SmartGift catalog ในระบบ File Manager ของ Business นี้</p>
              ) : (
                (businessFiles.data?.assets || [])
                  .filter((a) => isTextAsset(a) || isCatalogAsset(a))
                  .map((asset) => (
                    <div
                      key={asset.id}
                      className="flex items-center justify-between rounded-lg border border-[var(--border)] p-2.5 text-xs hover:border-[var(--brand-dark)]/40 transition"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold truncate">{asset.name}</p>
                        <p className="text-[10px] text-muted">{asset.storageKind} · {asset.size} bytes · {asset.status}</p>
                      </div>
                      {isCatalogAsset(asset) ? (
                        <button
                          type="button"
                          data-testid="admit-smartgift-catalog"
                          className="btn btn-primary text-xs flex items-center gap-1 ml-3 shrink-0"
                          onClick={() => admitExistingAsset(asset, SMARTGIFT_CATALOG_FORMAT)}
                        >
                          <UploadCloud size={13} /> นำเข้าเป็น SmartGift catalog
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary text-xs flex items-center gap-1 ml-3 shrink-0"
                          onClick={() => admitExistingAsset(asset)}
                        >
                          <UploadCloud size={13} /> นำเข้าเป็นความรู้
                        </button>
                      )}
                    </div>
                  ))
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 2: Admission Queue Panel
// ---------------------------------------------------------------------------
function QueueTabPanel({ admissions, onReload, onWithdrawSuccess, onError }) {
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [withdrawingId, setWithdrawingId] = useState(null)

  const items = admissions.data?.items || []

  const filteredItems = useMemo(() => {
    if (filterStatus === 'ALL') return items
    if (filterStatus === 'ACTIVE') return items.filter((i) => ['QUEUED', 'RUNNING'].includes(i.status))
    return items.filter((i) => i.status === filterStatus)
  }, [items, filterStatus])

  const handleWithdraw = async (item) => {
    if (!item.source?.id) return
    const confirmed = window.confirm(`คุณแน่ใจหรือไม่ว่าต้องการถอนเอกสาร "${item.source.title || item.source.sourceKey}" ออกจากคลังความรู้?`)
    if (!confirmed) return

    setWithdrawingId(item.source.id)
    try {
      await api(`/api/knowledge/sources/${encodeURIComponent(item.source.id)}`, {
        method: 'DELETE',
        body: {
          expectedVersion: item.revision ?? 1,
        },
      })
      onWithdrawSuccess(item.source.id)
    } catch (err) {
      onError(err.message)
    } finally {
      setWithdrawingId(null)
    }
  }

  const statusLabel = (status) => {
    switch (status) {
      case 'QUEUED': return 'รอประมวลผล (Queued)'
      case 'RUNNING': return 'กำลังประมวลผล (Running)'
      case 'PUBLISHED': return 'เผยแพร่แล้ว (Published)'
      case 'FAILED': return 'ประมวลผลไม่สำเร็จ (Failed)'
      case 'SUPERSEDED': return 'มีเวอร์ชันใหม่ทดแทน (Superseded)'
      case 'WITHDRAWN': return 'ถอนความรู้แล้ว (Withdrawn)'
      default: return status
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
        <div>
          <SectionTitle caption="รายการคำขอนำเข้าเอกสาร (Admissions) และความคืบหน้าของ 17-stage ingestion">
            สถานะคิวการนำเข้าความรู้
          </SectionTitle>
        </div>
        <div className="flex items-center gap-2">
          {/* Status Filter */}
          <select
            className="input text-xs py-1"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="ALL">ทุกสถานะ ({items.length})</option>
            <option value="ACTIVE">กำลังดำเนินการ (Queued / Running)</option>
            <option value="PUBLISHED">เผยแพร่แล้ว (Published)</option>
            <option value="FAILED">ล้มเหลว (Failed)</option>
            <option value="WITHDRAWN">ถอนแล้ว (Withdrawn)</option>
          </select>
          <button
            type="button"
            className="btn text-xs flex items-center gap-1"
            onClick={onReload}
            aria-label="Refresh list"
          >
            <RefreshCw size={13} /> รีเฟรช
          </button>
        </div>
      </div>

      {admissions.loading && <LoadingCard />}
      {admissions.error && <ErrorState detail={admissions.error} retry={onReload} />}

      {!admissions.loading && !admissions.error && (
        <>
          {filteredItems.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted">
              {items.length === 0 ? 'ยังไม่มีรายการเอกสารที่ถูกนำเข้าใน Business นี้' : 'ไม่พบรายการที่ตรงกับตัวกรองที่เลือก'}
            </div>
          ) : (
            <div className="space-y-2.5" data-testid="admissions-list">
              {filteredItems.map((item) => {
                const isFailed = item.status === 'FAILED'
                const isPublished = item.status === 'PUBLISHED'
                const isWithdrawn = item.status === 'WITHDRAWN'
                const canWithdraw = item.source?.id && !item.source?.revoked && !isWithdrawn

                return (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--border)] p-3 hover:bg-[var(--app-surface)]/50 transition"
                    data-testid={`admission-item-${item.id}`}
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill status={item.status} />
                        <span className="font-semibold text-xs text-[var(--text)]">
                          {item.source?.title || item.source?.sourceKey || item.sourceVersion}
                        </span>
                        <span className="text-[10px] font-mono text-muted">
                          rev {item.revision} · ver {item.sourceVersion}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
                        <span>สถานะ: {statusLabel(item.status)}</span>
                        {item.attempts > 0 && <span>Attempts: {item.attempts}</span>}
                        {item.snapshotId && <span className="font-mono">Snapshot: {item.snapshotId.slice(0, 10)}...</span>}
                        {item.createdAt && (
                          <span className="flex items-center gap-1">
                            <Clock size={11} /> {new Date(item.createdAt).toLocaleString('th-TH')}
                          </span>
                        )}
                      </div>

                      {isFailed && item.failureCode && (
                        <p className="text-[11px] text-[var(--danger)] mt-1 font-mono">
                          Error Code: {item.failureCode}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {canWithdraw && (
                        <button
                          type="button"
                          className="btn px-2.5 py-1 text-[11px] text-[var(--danger)] hover:bg-[var(--danger-bg)] flex items-center gap-1"
                          onClick={() => handleWithdraw(item)}
                          disabled={withdrawingId === item.source?.id}
                          data-testid={`withdraw-${item.source.id}`}
                        >
                          <Trash2 size={12} />
                          {withdrawingId === item.source?.id ? 'กำลังถอน...' : 'Withdraw'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Tab 3: Search & Citations Panel
// ---------------------------------------------------------------------------
function SearchTabPanel({ businessId, onError }) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState(null)

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    try {
      const data = await api('/api/knowledge/queries', {
        method: 'POST',
        body: {
          businessId,
          projectId: null,
          query: query.trim(),
          topK: 10,
        },
      })
      setResults(data)
    } catch (err) {
      onError(err.message)
    } finally {
      setSearching(false)
    }
  }

  return (
    <Card className="space-y-4">
      <SectionTitle caption="ทดสอบสืบค้นคำตอบจากเอกสารความรู้ที่ผ่านการ Publish เข้าสู่ Corpus Generation">
        ค้นหาและทดสอบความรู้ (Corpus Query)
      </SectionTitle>

      <form onSubmit={handleSearch} className="flex gap-2" data-testid="search-form">
        <input
          className="input flex-1 text-xs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="พิมพ์คำถามหรือคำค้นจากเอกสารที่ผ่านการอนุมัติ..."
          required
          data-testid="search-input"
        />
        <button
          type="submit"
          className="btn btn-primary text-xs flex items-center gap-1.5 px-4"
          disabled={searching}
          data-testid="search-submit"
        >
          <Search size={14} />
          {searching ? 'กำลังค้นหา...' : 'ค้นหาความรู้'}
        </button>
      </form>

      {/* Search Results */}
      {results && (
        <div className="space-y-3 pt-2" aria-live="polite" data-testid="search-results">
          <div className="flex items-center justify-between text-xs text-muted border-b border-[var(--border)] pb-2">
            <span>Corpus Generation: <strong className="font-mono">{results.corpusGeneration ?? '—'}</strong></span>
            <span>พบผลลัพธ์ {results.results?.length || 0} รายการ</span>
          </div>

          {!results.results?.length ? (
            <div className="py-6 text-center text-xs text-muted">
              ไม่พบเนื้อหาความรู้ที่ตรงกับคำค้นหาใน Published Corpus ของ Business นี้
            </div>
          ) : (
            <div className="space-y-2.5">
              {results.results.map((item, idx) => (
                <div
                  key={item.citationId || item.id || idx}
                  className="rounded-lg border border-[var(--border)] p-3 bg-[var(--app-surface)]/40 text-xs space-y-1.5"
                  data-testid={`search-result-${idx}`}
                >
                  <p className="leading-relaxed font-sans text-[var(--text)] whitespace-pre-wrap">{item.text}</p>
                  <div className="flex items-center justify-between pt-1 border-t border-[var(--border)]/50 text-[10px] text-muted">
                    <span>Rank score: {typeof item.score === 'number' ? item.score.toFixed(4) : '—'}</span>
                    {item.citationId && (
                      <a
                        href={`/api/knowledge/citations/${encodeURIComponent(item.citationId)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-[var(--brand-dark)] font-semibold hover:underline"
                      >
                        <ExternalLink size={11} /> ดูหลักฐานอ้างอิง (Citation)
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
