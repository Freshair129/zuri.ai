'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Card, Kpi, ModuleTabs, PageHeader, SectionTitle } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { INVENTORY_TABS } from '@/lib/module-tabs'
import {
  buildRecipeArchivePayload,
  buildRecipeBuildPayload,
  buildRecipeCreatePayload,
  buildRecipeUpdatePayload,
  recipeErrorMessage,
  resetRecipeDraft,
  validateRecipeLines,
} from '@/modules/inventory/components/recipe-ui'

// @req FR-072, FR-156, FR-177 — Business-scoped recipe (BOM) creation, inspection, versioned
//   UPDATE / ARCHIVE and atomic build through the existing Inventory APIs.
// @spec BR-002; SEC-001
// @tested tests/unit/inventory-recipe-ui.test.js, tests/e2e/fr156-inventory-recipes.spec.js

const fieldClass = 'w-full rounded-lg border border-[var(--border)] bg-white p-2 text-sm'
const STATUS_LABEL = { ACTIVE: 'ใช้งาน', ARCHIVED: 'เก็บถาวร' }

function Input({ label, className = '', ...props }) {
  return <label className="grid gap-1 text-xs font-semibold">
    <span>{label}</span>
    <input aria-label={label} className={fieldClass + (className ? ' ' + className : '')} {...props} />
  </label>
}

function Textarea({ label, ...props }) {
  return <label className="grid gap-1 text-xs font-semibold">
    <span>{label}</span>
    <textarea aria-label={label} className={fieldClass} rows={3} {...props} />
  </label>
}

function productLabel(product) {
  return [product?.code, product?.name].filter(Boolean).join(' · ') || product?.id || 'Product'
}

function quantityLabel(value) {
  if (value === null || value === undefined) return 'ไม่นับสต๊อก'
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 4 }).format(value)
}

function recipeEditDraft(recipe) {
  return {
    name: recipe.name ?? '',
    yieldQty: String(recipe.yieldQty ?? recipe.batchSize ?? ''),
    unit: recipe.unit ?? 'EA',
    notes: recipe.notes ?? '',
    scrapAllowanceFactor: String(recipe.scrapAllowanceFactor ?? 0),
    lines: (recipe.lines ?? []).map((line) => ({
      componentProductId: line.componentProductId,
      qty: String(line.qty),
      unit: line.unit ?? '',
      fixed: Boolean(line.fixed),
      note: line.note ?? '',
    })),
  }
}

function RecipeLinesEditor({ lines, products, onChange, disabled = false, labelPrefix }) {
  function changeLine(index, field, value) {
    onChange(lines.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line))
  }

  return <div className="grid gap-3">
    {lines.map((line, index) => {
      const componentLabel = labelPrefix + ' Component ' + (index + 1)
      return <fieldset key={index} disabled={disabled} className="grid gap-3 rounded-lg border border-[var(--border)] p-3 md:grid-cols-2">
        <legend className="px-1 text-xs font-semibold">ส่วนประกอบ {index + 1}</legend>
        <label className="grid gap-1 text-xs font-semibold">
          <span>Product ของ {componentLabel}</span>
          <select
            aria-label={'Product ของ ' + componentLabel}
            className={fieldClass}
            value={line.componentProductId}
            onChange={(event) => changeLine(index, 'componentProductId', event.target.value)}
          >
            <option value="">— เลือก Product —</option>
            {products.map((product) => <option key={product.id} value={product.id}>{productLabel(product)}</option>)}
          </select>
        </label>
        <Input
          label={'จำนวนต่อ batch ของ ' + componentLabel}
          type="number"
          min="0"
          step="any"
          value={line.qty}
          onChange={(event) => changeLine(index, 'qty', event.target.value)}
          required
        />
        <Input
          label={'หน่วยของ ' + componentLabel}
          maxLength={20}
          value={line.unit}
          onChange={(event) => changeLine(index, 'unit', event.target.value)}
        />
        <label className="flex items-center gap-2 self-end pb-2 text-xs font-semibold">
          <input
            aria-label={'ใช้จำนวนคงที่ต่อ batch ของ ' + componentLabel}
            type="checkbox"
            checked={Boolean(line.fixed)}
            onChange={(event) => changeLine(index, 'fixed', event.target.checked)}
          />
          ใช้จำนวนคงที่ต่อ batch
        </label>
        <Textarea
          label={'หมายเหตุของ ' + componentLabel}
          maxLength={300}
          value={line.note}
          onChange={(event) => changeLine(index, 'note', event.target.value)}
        />
        {lines.length > 1 && <div className="flex items-end">
          <button type="button" className="btn" disabled={disabled} onClick={() => onChange(lines.filter((_, lineIndex) => lineIndex !== index))}>
            ลบส่วนประกอบ {index + 1}
          </button>
        </div>}
      </fieldset>
    })}
    <div>
      <button
        type="button"
        className="btn"
        disabled={disabled || lines.length >= 200}
        onClick={() => onChange([...lines, { componentProductId: '', qty: '', unit: '', fixed: false, note: '' }])}
      >
        เพิ่มส่วนประกอบ
      </button>
    </div>
  </div>
}

async function api(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw Object.assign(new Error(payload.error || 'Request failed'), { status: response.status, payload })
  }
  return payload
}

export default function InventoryRecipesPage() {
  const business = useScope().shell.activeBusiness
  const businessId = business?.id
  const [products, setProducts] = useState([])
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [shortages, setShortages] = useState([])
  const [createDraft, setCreateDraft] = useState(resetRecipeDraft)
  const [selectedRecipeId, setSelectedRecipeId] = useState('')
  const [detail, setDetail] = useState(null)
  const [detailQuantity, setDetailQuantity] = useState('')
  const [editDraft, setEditDraft] = useState(null)
  const [buildQuantity, setBuildQuantity] = useState('')
  const [outputLotCode, setOutputLotCode] = useState('')
  const [buildResult, setBuildResult] = useState(null)
  const refreshSequence = useRef(0)
  const currentBusinessId = useRef(businessId)
  const businessSequence = useRef(0)
  if (currentBusinessId.current !== businessId) {
    currentBusinessId.current = businessId
    businessSequence.current += 1
  }

  function isCurrentBusiness(sequence) {
    return sequence === businessSequence.current
  }

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current
    const currentBusinessSequence = businessSequence.current
    if (!businessId) {
      if (currentBusinessSequence !== businessSequence.current) return
      setProducts([])
      setRecipes([])
      setLoading(false)
      return
    }
    setLoading(true)
    const query = new URLSearchParams({ businessId, includeArchived: 'true' })
    try {
      const [productRows, recipeRows] = await Promise.all([
        api('/api/inventory/products?' + new URLSearchParams({ businessId })),
        api('/api/inventory/recipes?' + query),
      ])
      if (sequence !== refreshSequence.current || currentBusinessSequence !== businessSequence.current) return
      setProducts(Array.isArray(productRows) ? productRows.filter((product) => product.status !== 'ARCHIVED') : [])
      setRecipes(Array.isArray(recipeRows) ? recipeRows : [])
    } finally {
      if (sequence === refreshSequence.current && currentBusinessSequence === businessSequence.current) setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    setCreateDraft(resetRecipeDraft())
    setBusy(false)
    setLoading(false)
    setShortages([])
    setSelectedRecipeId('')
    setDetail(null)
    setEditDraft(null)
    setBuildResult(null)
    setError('')
    setMessage('')
    const currentBusinessSequence = businessSequence.current
    refresh().catch((loadError) => {
      if (currentBusinessSequence === businessSequence.current) setError(recipeErrorMessage(loadError))
    })
  }, [businessId, refresh])

  function showError(loadError) {
    setError(recipeErrorMessage(loadError))
    setShortages(Array.isArray(loadError?.payload?.details) ? loadError.payload.details : [])
  }

  async function loadDetail(id, quantity) {
    const query = Number.isInteger(Number(quantity)) && Number(quantity) > 0
      ? '?quantity=' + encodeURIComponent(String(Number(quantity)))
      : ''
    return api('/api/inventory/recipes/' + encodeURIComponent(id) + query)
  }

  async function openRecipe(id) {
    if (busy) return
    const currentBusinessSequence = businessSequence.current
    setBusy(true)
    setError('')
    setMessage('')
    setShortages([])
    setBuildResult(null)
    setDetail(null)
    setSelectedRecipeId(id)
    try {
      const loaded = await loadDetail(id)
      if (!isCurrentBusiness(currentBusinessSequence)) return
      setDetail(loaded)
      setDetailQuantity(String(loaded.batchSize))
      setBuildQuantity(String(loaded.batchSize))
      setOutputLotCode('')
      setEditDraft(recipeEditDraft(loaded))
    } catch (loadError) {
      if (isCurrentBusiness(currentBusinessSequence)) showError(loadError)
    } finally {
      if (isCurrentBusiness(currentBusinessSequence)) setBusy(false)
    }
  }

  async function createRecipe(event) {
    event.preventDefault()
    if (busy || !businessId) return
    const currentBusinessSequence = businessSequence.current
    const lineIssues = validateRecipeLines(createDraft.lines, createDraft.productId)
    if (lineIssues.length) {
      setError(lineIssues.join(' · '))
      setShortages([])
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    setShortages([])
    try {
      const created = await api('/api/inventory/recipes', 'POST', buildRecipeCreatePayload({
        ...createDraft,
        businessId,
      }))
      if (!isCurrentBusiness(currentBusinessSequence)) return
      setCreateDraft(resetRecipeDraft())
      await refresh()
      if (!isCurrentBusiness(currentBusinessSequence)) return
      const loaded = await loadDetail(created.id)
      if (!isCurrentBusiness(currentBusinessSequence)) return
      setSelectedRecipeId(created.id)
      setDetail(loaded)
      setDetailQuantity(String(loaded.batchSize))
      setBuildQuantity(String(loaded.batchSize))
      setEditDraft(recipeEditDraft(loaded))
      setMessage('สร้างสูตร ' + created.code + ' แล้ว')
    } catch (createError) {
      if (isCurrentBusiness(currentBusinessSequence)) showError(createError)
    } finally {
      if (isCurrentBusiness(currentBusinessSequence)) setBusy(false)
    }
  }

  async function calculateExplosion(event) {
    event.preventDefault()
    if (!selectedRecipeId || busy) return
    const currentBusinessSequence = businessSequence.current
    const quantity = Number(detailQuantity)
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError('จำนวนที่ใช้คำนวณ BOM ต้องเป็นจำนวนเต็มมากกว่า 0')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    setShortages([])
    try {
      const loaded = await loadDetail(selectedRecipeId, quantity)
      if (!isCurrentBusiness(currentBusinessSequence)) return
      setDetail(loaded)
      setMessage('คำนวณ BOM สำหรับ ' + quantity + ' หน่วยแล้ว')
    } catch (loadError) {
      if (isCurrentBusiness(currentBusinessSequence)) showError(loadError)
    } finally {
      if (isCurrentBusiness(currentBusinessSequence)) setBusy(false)
    }
  }

  async function updateRecipe(event) {
    event.preventDefault()
    if (!detail || !editDraft || busy || detail.status === 'ARCHIVED') return
    const currentBusinessSequence = businessSequence.current
    const lineIssues = validateRecipeLines(editDraft.lines, detail.productId)
    if (lineIssues.length) {
      setError(lineIssues.join(' · '))
      setShortages([])
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    setShortages([])
    try {
      const updated = await api(
        '/api/inventory/recipes/' + encodeURIComponent(detail.id),
        'PATCH',
        buildRecipeUpdatePayload({ ...editDraft, version: detail.version }),
      )
      if (!isCurrentBusiness(currentBusinessSequence)) return
      await refresh()
      if (!isCurrentBusiness(currentBusinessSequence)) return
      const loaded = await loadDetail(updated.id, detailQuantity)
      if (!isCurrentBusiness(currentBusinessSequence)) return
      setDetail(loaded)
      setEditDraft(recipeEditDraft(loaded))
      setMessage('บันทึกการแก้ไขสูตร ' + loaded.code + ' แล้ว')
    } catch (updateError) {
      if (isCurrentBusiness(currentBusinessSequence)) showError(updateError)
    } finally {
      if (isCurrentBusiness(currentBusinessSequence)) setBusy(false)
    }
  }

  async function archiveRecipe() {
    if (!detail || busy || detail.status === 'ARCHIVED') return
    const currentBusinessSequence = businessSequence.current
    setBusy(true)
    setError('')
    setMessage('')
    setShortages([])
    try {
      const archived = await api(
        '/api/inventory/recipes/' + encodeURIComponent(detail.id),
        'PATCH',
        buildRecipeArchivePayload(detail.version),
      )
      if (!isCurrentBusiness(currentBusinessSequence)) return
      await refresh()
      if (!isCurrentBusiness(currentBusinessSequence)) return
      const loaded = await loadDetail(archived.id, detailQuantity)
      if (!isCurrentBusiness(currentBusinessSequence)) return
      setDetail(loaded)
      setEditDraft(recipeEditDraft(loaded))
      setMessage('เก็บสูตร ' + loaded.code + ' ไว้ในประวัติแล้ว')
    } catch (archiveError) {
      if (isCurrentBusiness(currentBusinessSequence)) showError(archiveError)
    } finally {
      if (isCurrentBusiness(currentBusinessSequence)) setBusy(false)
    }
  }

  async function buildRecipe(event) {
    event.preventDefault()
    if (!detail || busy || detail.status === 'ARCHIVED') return
    const currentBusinessSequence = businessSequence.current
    const quantity = Number(buildQuantity)
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError('จำนวนที่ต้องการผลิตต้องเป็นจำนวนเต็มมากกว่า 0')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    setShortages([])
    setBuildResult(null)
    try {
      const result = await api(
        '/api/inventory/recipes/' + encodeURIComponent(detail.id) + '/build',
        'POST',
        buildRecipeBuildPayload({ businessId, quantity, outputLotCode }),
      )
      if (!isCurrentBusiness(currentBusinessSequence)) return
      setBuildResult(result)
      await refresh()
      if (!isCurrentBusiness(currentBusinessSequence)) return
      const loaded = await loadDetail(detail.id, detailQuantity)
      if (!isCurrentBusiness(currentBusinessSequence)) return
      setDetail(loaded)
      setMessage('Build สำเร็จ · ผลิตได้ ' + result.producedQty + ' หน่วย')
    } catch (buildError) {
      if (isCurrentBusiness(currentBusinessSequence)) showError(buildError)
    } finally {
      if (isCurrentBusiness(currentBusinessSequence)) setBusy(false)
    }
  }

  const activeProducts = products.filter((product) => product.businessId === businessId && product.status !== 'ARCHIVED')
  const activeRecipes = recipes.filter((recipe) => recipe.businessId === businessId)
  const selectedProduct = activeProducts.find((product) => product.id === detail?.productId)

  return <div>
    <PageHeader
      eyebrow="Inventory · FR-156"
      title="สูตรการผลิต (BOM)"
      subtitle={'จัดการสูตรตาม Product และขนาด batch' + (business ? ' · ' + business.name : '')}
      actions={<button type="button" className="btn" onClick={() => {
        const currentBusinessSequence = businessSequence.current
        refresh().catch((loadError) => {
          if (isCurrentBusiness(currentBusinessSequence)) showError(loadError)
        })
      }} disabled={loading || busy}><RefreshCw size={15} /> โหลดใหม่</button>}
    />
    <ModuleTabs tabs={INVENTORY_TABS} />

    {!business && <Card><p className="text-sm text-muted">เลือก Business ก่อนเพื่อจัดการสูตร (BOM)</p></Card>}
    {error && <Card className="mb-3">
      {/* One alert region holds the message and the shortage lines, so the
          components that are short are announced together with the error. */}
      <div role="alert">
        <p className="text-sm text-red-700">{error}</p>
        {shortages.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-red-700">
        {shortages.map((shortage, index) => <li key={shortage.componentProductId || index}>
            {shortage.code || productLabel(activeProducts.find((product) => product.id === shortage.componentProductId))}
            {' · ต้องเบิก '}{quantityLabel(shortage.required)}
            {' · มี '}{quantityLabel(shortage.onHand)}
            {' · ขาด '}{quantityLabel(shortage.shortage)}
          </li>)}
        </ul>}
      </div>
    </Card>}
    {message && <p role="status" className="mb-3 text-sm text-green-800">{message}</p>}

    {business && <div className="mb-4 grid gap-3 md:grid-cols-3">
      <Kpi label="สูตรทั้งหมด" value={activeRecipes.length} meta="รวมสูตรที่เก็บถาวร" />
      <Kpi label="สูตรที่ใช้งาน" value={activeRecipes.filter((recipe) => recipe.status !== 'ARCHIVED').length} />
      <Kpi label="Product ที่เลือกได้" value={activeProducts.length} meta="ไม่นับ Product ที่เก็บถาวร" />
    </div>}

    {business && <Card className="mb-4">
      <SectionTitle caption="เลือก output Product และ component จากแคตตาล็อกของ Business นี้">สร้างสูตร (BOM)</SectionTitle>
      {activeProducts.length === 0 && <p className="mb-3 text-sm text-muted">ยังไม่มี Product ที่เลือกได้ใน Business นี้</p>}
      <form onSubmit={createRecipe} className="grid gap-3">
        <fieldset disabled={busy || activeProducts.length === 0} className="grid gap-3 md:grid-cols-2">
          <Input label="รหัสสูตร" value={createDraft.code} maxLength={64} required onChange={(event) => setCreateDraft((draft) => ({ ...draft, code: event.target.value }))} />
          <Input label="ชื่อสูตร" value={createDraft.name} maxLength={200} required onChange={(event) => setCreateDraft((draft) => ({ ...draft, name: event.target.value }))} />
          <label className="grid gap-1 text-xs font-semibold">
            <span>Product ผลลัพธ์</span>
            <select
              aria-label="Product ผลลัพธ์"
              className={fieldClass}
              value={createDraft.productId}
              required
              onChange={(event) => {
                const productId = event.target.value
                const output = activeProducts.find((product) => product.id === productId)
                setCreateDraft((draft) => ({ ...draft, productId, unit: output?.unit ?? '' }))
              }}
            >
              <option value="">— เลือก Product —</option>
              {activeProducts.map((product) => <option key={product.id} value={product.id}>{productLabel(product)}</option>)}
            </select>
          </label>
          <Input label="ขนาด batch" type="number" min="1" step="1" value={createDraft.batchSize} required onChange={(event) => setCreateDraft((draft) => ({ ...draft, batchSize: event.target.value }))} />
          <Input label="ผลผลิตต่อ batch" type="number" min="1" step="1" value={createDraft.yieldQty} onChange={(event) => setCreateDraft((draft) => ({ ...draft, yieldQty: event.target.value }))} />
          <Input label="หน่วยผลผลิต" maxLength={20} value={createDraft.unit} onChange={(event) => setCreateDraft((draft) => ({ ...draft, unit: event.target.value }))} />
          <Input label="สัดส่วนเผื่อเสีย (0–0.20)" type="number" min="0" max="0.2" step="any" value={createDraft.scrapAllowanceFactor} onChange={(event) => setCreateDraft((draft) => ({ ...draft, scrapAllowanceFactor: event.target.value }))} />
          <Textarea label="หมายเหตุสูตร" maxLength={2000} value={createDraft.notes} onChange={(event) => setCreateDraft((draft) => ({ ...draft, notes: event.target.value }))} />
        </fieldset>
        <div className="grid gap-2">
          <SectionTitle caption="ปริมาณต่อ batch; เลือกจำนวนคงที่สำหรับ component ที่ไม่ปรับตามจำนวนผลิต">ส่วนประกอบ</SectionTitle>
          <RecipeLinesEditor
            labelPrefix="สูตรใหม่"
            lines={createDraft.lines}
            products={activeProducts}
            disabled={busy || activeProducts.length === 0}
            onChange={(lines) => setCreateDraft((draft) => ({ ...draft, lines }))}
          />
        </div>
        <p className="text-xs text-muted">สัดส่วนเผื่อเสียเป็นค่าระหว่าง 0 ถึง 0.20 เช่น 0.02 คือ 2%; ระบบรับเฉพาะ Product ที่ไม่ถูกเก็บถาวร</p>
        <button type="submit" className="btn btn-primary justify-self-start" disabled={busy || activeProducts.length === 0}>สร้างสูตร</button>
      </form>
    </Card>}

    {business && <Card className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle caption="เลือกสูตรเพื่อดู BOM ที่คำนวณจากยอด stock ledger">สูตรใน Business นี้</SectionTitle>
        <button type="button" className="btn" onClick={() => {
          const currentBusinessSequence = businessSequence.current
          refresh().catch((loadError) => {
            if (isCurrentBusiness(currentBusinessSequence)) showError(loadError)
          })
        }} disabled={loading || busy}>โหลดรายการ</button>
      </div>
      {loading ? <p className="text-sm text-muted">กำลังโหลดสูตรและ Product…</p> : <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead><tr className="border-b text-xs text-muted">
            <th className="p-2">รหัสสูตร</th><th className="p-2">Product ผลลัพธ์</th><th className="p-2">ขนาด batch</th><th className="p-2">สถานะ</th><th className="p-2">จำนวน Component</th>
          </tr></thead>
          <tbody>{activeRecipes.map((recipe) => <tr key={recipe.id} className={'border-b ' + (selectedRecipeId === recipe.id ? 'bg-[var(--brand-tint)]' : '')}>
            <td className="p-2"><button type="button" className="font-mono text-xs underline" disabled={busy} onClick={() => openRecipe(recipe.id)}>{recipe.code}</button></td>
            <td className="p-2">{productLabel(activeProducts.find((product) => product.id === recipe.productId))}</td>
            <td className="p-2">{recipe.batchSize} {recipe.unit}</td>
            <td className="p-2">{STATUS_LABEL[recipe.status] || recipe.status}</td>
            <td className="p-2">{recipe.lines?.length ?? 0}</td>
          </tr>)}</tbody>
        </table>
        {activeRecipes.length === 0 && <p className="py-3 text-sm text-muted">ยังไม่มีสูตร (BOM) ใน Business นี้</p>}
      </div>}
    </Card>}

    {detail && detail.businessId === businessId && <div className="grid gap-4">
      <Card>
        <SectionTitle caption={detail.code + ' · ' + productLabel(selectedProduct) + ' · version ' + detail.version}>รายละเอียดและการระเบิด BOM</SectionTitle>
        <p className="mb-3 text-sm">
          {detail.name} · batch {detail.batchSize} {detail.unit} · ผลผลิต {detail.yieldQty} {detail.unit}
          {' · สถานะ '}{STATUS_LABEL[detail.status] || detail.status}
          {' · เผื่อเสีย '}{detail.scrapAllowanceFactor}
        </p>
        <form onSubmit={calculateExplosion} className="mb-4 flex flex-wrap items-end gap-3">
          <Input label="จำนวนสำหรับคำนวณ BOM" type="number" min="1" step="1" value={detailQuantity} onChange={(event) => setDetailQuantity(event.target.value)} required />
          <button type="submit" className="btn" disabled={busy}>คำนวณ BOM</button>
        </form>
        <div className="mb-3 grid gap-3 md:grid-cols-2">
          <Kpi label="ผลิตได้สูงสุดจาก stock ledger" value={detail.maxBuildableQuantity ?? '—'} />
          <Kpi label="ส่วนประกอบที่ต้องใช้" value={detail.requirements?.lines?.length ?? 0} meta="แสดงจำนวนเบิกและยอดคงเหลือจาก ledger" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead><tr className="border-b text-xs text-muted">
              <th className="p-2">Component</th><th className="p-2">ตาม BOM</th><th className="p-2">ต้องเบิก</th><th className="p-2">คงเหลือ</th><th className="p-2">ขาด</th><th className="p-2">สถานะ</th>
            </tr></thead>
            <tbody>{(detail.requirements?.lines ?? []).map((line) => {
              const component = activeProducts.find((product) => product.id === line.componentProductId)
              return <tr key={line.componentProductId} className="border-b">
                <td className="p-2">{productLabel(component)}{line.fixed ? ' · คงที่' : ''}</td>
                <td className="p-2">{quantityLabel(line.required)} {line.unit || component?.unit || ''}</td>
                <td className="p-2">{quantityLabel(line.issueQty)} {line.unit || component?.unit || ''}</td>
                <td className="p-2">{quantityLabel(line.onHand)}</td>
                <td className="p-2">{quantityLabel(line.shortage)}</td>
                <td className="p-2">{line.onHand === null ? 'ไม่นับสต๊อก' : line.shortage > 0 ? 'สต๊อกไม่พอ' : 'พร้อม'}</td>
              </tr>
            })}</tbody>
          </table>
          {!detail.requirements?.lines?.length && <p className="py-3 text-sm text-muted">สูตรนี้ยังไม่มีบรรทัด BOM ให้แสดง</p>}
        </div>
        <p className="mt-3 text-xs text-muted">ยอดคงเหลือและจำนวนที่ผลิตได้สูงสุดมาจาก stock ledger ตาม API ของ FR-156; ไม่ใช่ค่า ATP จากระบบจองสินค้า</p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <SectionTitle caption="UPDATE แก้ fields ที่ service รองรับและแทนรายการ component ทั้งชุด">แก้ไขสูตร</SectionTitle>
          {detail.status === 'ARCHIVED'
            ? <p className="text-sm text-muted">สูตรที่เก็บถาวรแก้ไขไม่ได้</p>
            : editDraft && <form onSubmit={updateRecipe} className="grid gap-3">
              <fieldset disabled={busy} className="grid gap-3 md:grid-cols-2">
                <Input label="ชื่อสูตรที่แก้ไข" maxLength={200} value={editDraft.name} required onChange={(event) => setEditDraft((draft) => ({ ...draft, name: event.target.value }))} />
                <Input label="ผลผลิตต่อ batch ที่แก้ไข" type="number" min="1" step="1" value={editDraft.yieldQty} required onChange={(event) => setEditDraft((draft) => ({ ...draft, yieldQty: event.target.value }))} />
                <Input label="หน่วยผลผลิตที่แก้ไข" maxLength={20} value={editDraft.unit} required onChange={(event) => setEditDraft((draft) => ({ ...draft, unit: event.target.value }))} />
                <Input label="สัดส่วนเผื่อเสียที่แก้ไข (0–0.20)" type="number" min="0" max="0.2" step="any" value={editDraft.scrapAllowanceFactor} required onChange={(event) => setEditDraft((draft) => ({ ...draft, scrapAllowanceFactor: event.target.value }))} />
                <Textarea label="หมายเหตุสูตรที่แก้ไข" maxLength={2000} value={editDraft.notes} onChange={(event) => setEditDraft((draft) => ({ ...draft, notes: event.target.value }))} />
              </fieldset>
              <RecipeLinesEditor
                labelPrefix="แก้ไขสูตร"
                lines={editDraft.lines}
                products={products}
                disabled={busy}
                onChange={(lines) => setEditDraft((draft) => ({ ...draft, lines }))}
              />
              <button type="submit" className="btn btn-primary justify-self-start" disabled={busy}>บันทึกการแก้ไข</button>
            </form>}
          <div className="mt-3 border-t pt-3">
            <button type="button" className="btn" disabled={busy || detail.status === 'ARCHIVED'} onClick={archiveRecipe}>เก็บสูตรนี้ถาวร</button>
          </div>
        </Card>

        <Card>
          <SectionTitle caption="ส่งคำขอ Build ไปยัง service ซึ่งตัด component และรับ output ใน transaction เดียว">Build สูตร</SectionTitle>
          {detail.status === 'ARCHIVED'
            ? <p className="text-sm text-muted">สูตรที่เก็บถาวร Build ไม่ได้</p>
            : <form onSubmit={buildRecipe} className="grid gap-3 md:grid-cols-2">
              <Input label="จำนวนที่ต้องการผลิต" type="number" min="1" step="1" value={buildQuantity} required onChange={(event) => setBuildQuantity(event.target.value)} />
              {selectedProduct?.stockPolicy === 'TRACKED' && selectedProduct?.trackingMode === 'LOT' && <Input label="รหัส Lot ผลผลิต" maxLength={64} required value={outputLotCode} onChange={(event) => setOutputLotCode(event.target.value)} />}
              {selectedProduct?.trackingMode === 'SERIAL' && <p className="text-sm text-amber-800 md:col-span-2">Product ผลลัพธ์แบบ Serial ยัง Build ผ่านสูตรไม่ได้</p>}
              <button type="submit" className="btn btn-primary justify-self-start" disabled={busy}>Build ตามสูตร</button>
            </form>}
          {buildResult && <div className="mt-4 border-t pt-3">
            <SectionTitle caption={'Reference ' + buildResult.reference}>ผลการ Build</SectionTitle>
            <p role="status" className="text-sm">
              ผลิตได้ {buildResult.producedQty} หน่วย · จำนวนที่ขอ {buildResult.quantity}
              {buildResult.produced ? ' · คงเหลือผลผลิต ' + quantityLabel(buildResult.produced.onHandAfter) : ''}
            </p>
            <ul className="mt-2 list-disc pl-5 text-sm">
              {buildResult.consumed.map((line) => <li key={line.componentProductId}>
                {productLabel(activeProducts.find((product) => product.id === line.componentProductId))}
                {' · เบิก '}{quantityLabel(line.quantity)}
                {' · คงเหลือ '}{quantityLabel(line.onHandAfter)}
              </li>)}
            </ul>
          </div>}
        </Card>
      </div>
    </div>}
  </div>
}
