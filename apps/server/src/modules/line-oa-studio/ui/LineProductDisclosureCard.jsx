// @req FR-235 — Business Owners explicitly control customer-facing product disclosure.
// @spec ZAI:LINE-CUSTOMER-PRODUCT-DISCLOSURE-PROPOSAL-20261024
// @tested tests/unit/line-product-disclosure-ui.test.js
"use client";

import React, { useEffect, useMemo, useSyncExternalStore } from "react";
import { DISCLOSURE_FIELDS } from "@/modules/knowledge/line-product-disclosure-fields";

export { DISCLOSURE_FIELDS };

const FIELD_OPTIONS = Object.freeze([
  { key: "sku", label: "SKU", detail: "รหัสสินค้าจากระบบ" },
  { key: "nameTh", label: "ชื่อภาษาไทย", detail: "ชื่อสินค้าที่ตรวจสอบแล้ว" },
  { key: "nameEn", label: "ชื่อภาษาอังกฤษ", detail: "แสดงเมื่อมีค่าในแหล่งข้อมูล" },
  { key: "unit", label: "หน่วย", detail: "หน่วยพื้นฐานของสินค้า" },
  { key: "category", label: "หมวดหมู่", detail: "แสดงเมื่อมีค่าในแหล่งข้อมูล" },
  { key: "productFamily", label: "กลุ่มสินค้า", detail: "แสดงเมื่อมีค่าในแหล่งข้อมูล" },
  { key: "dimensionsCm", label: "ขนาด (ซม.)", detail: "ส่วนประกอบและหน่วยตามแหล่งข้อมูล" },
  { key: "unitWeightKg", label: "น้ำหนักต่อหน่วย (กก.)", detail: "แสดงค่าเดิมตามแหล่งข้อมูล" },
]);

const FIELD_LABELS = Object.freeze(Object.fromEntries(FIELD_OPTIONS.map(({ key, label }) => [key, label])));

function createInitialState() {
  return {
    query: "",
    sourceQuery: "",
    products: [],
    sources: [],
    policies: [],
    fields: [...DISCLOSURE_FIELDS],
    productId: "",
    sourceId: "",
    selectedFields: [],
    unavailableFields: [],
    reason: "",
    preview: null,
    loading: false,
    busy: null,
    error: "",
    message: "",
    sourcesNextCursor: null,
    sourceLoading: false,
  };
}

function sameFields(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((field, index) => field === right[index]);
}

function selectedPolicyFor(state, productId = state.productId) {
  return state.policies
    .filter(policy => policy?.productId === productId)
    .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0] ?? null;
}

export function canPreviewDisclosure(state) {
  return Boolean(
    state?.productId
    && state?.sourceId
    && Array.isArray(state.selectedFields)
    && state.selectedFields.length > 0
    && state.selectedFields.every(field => DISCLOSURE_FIELDS.includes(field) && state.fields.includes(field))
    && !state.selectedFields.some(field => state.unavailableFields.includes(field))
    && !state.loading
    && !state.busy,
  );
}

export function canApproveDisclosure(state) {
  const preview = state?.preview;
  const selection = preview?.selection;
  return Boolean(
    preview?.previewHash
    && Number.isInteger(preview.expectedVersion)
    && selection
    && selection.productId === state.productId
    && selection.sourceId === state.sourceId
    && selection.revision === state.inputRevision
    && sameFields(selection.fields, state.selectedFields)
    && state.selectedFields.length > 0
    && !state.selectedFields.some(field => state.unavailableFields.includes(field))
    && Array.isArray(preview.values)
    && preview.values.length === state.selectedFields.length
    && state.selectedFields.every(field => preview.values.some(value => value.field === field))
    && Boolean(state.reason.trim())
    && !state.loading
    && !state.busy,
  );
}

function friendlyError(status, payload) {
  if (payload?.error === "LINE_PRODUCT_DISCLOSURE_SEND_IN_PROGRESS") {
    return "กำลังส่งข้อความ LINE หรือยังยืนยันผลส่งไม่ได้ จึงยังเปลี่ยนสิทธิ์ไม่ได้ กรุณารอหรือตรวจสอบสถานะส่งแล้วลองอีกครั้ง";
  }
  if (payload?.error === "LINE_PRODUCT_DISCLOSURE_FIELD_UNAVAILABLE") {
    return "แหล่งข้อมูลนี้ไม่มีค่าของบางฟิลด์ที่เลือก กรุณาลดฟิลด์หรือเลือกแหล่งข้อมูลใหม่แล้วดูตัวอย่างอีกครั้ง";
  }
  if ([401, 403, 404].includes(status)) {
    return "ไม่สามารถเข้าถึงการตั้งค่าข้อมูลสินค้าของบัญชีนี้ได้ กรุณาตรวจสอบ Business และบัญชี LINE ที่เลือก";
  }
  if (status === 409) {
    return "ข้อมูลเปลี่ยนแปลงแล้ว กรุณาโหลดสถานะและดูตัวอย่างใหม่ก่อนดำเนินการ";
  }
  if (Array.isArray(payload?.issues) && payload.issues.length > 0) return payload.issues.join(" · ");
  if (typeof payload?.error === "string" && payload.error.trim()) return payload.error;
  return "ทำรายการข้อมูลสินค้าไม่สำเร็จ กรุณาลองอีกครั้ง";
}

function disclosureRequestUrl(accountId, businessId, query, sourceQuery = "", sourceCursor = null) {
  const params = [`businessId=${encodeURIComponent(businessId)}`];
  if (query.trim()) params.push(`q=${encodeURIComponent(query.trim())}`);
  if (sourceQuery.trim()) params.push(`sourceQuery=${encodeURIComponent(sourceQuery.trim())}`);
  if (sourceCursor) params.push(`sourceCursor=${encodeURIComponent(sourceCursor)}`);
  return `/api/line-oa/accounts/${encodeURIComponent(accountId)}/product-disclosure?${params.join("&")}`;
}

function mergeSources(existing, incoming) {
  const byId = new Map();
  for (const source of [...existing, ...incoming]) {
    if (source?.id) byId.set(source.id, source);
  }
  return [...byId.values()];
}

export function createDisclosureController({ businessId, accountId, fetchImpl = (...args) => globalThis.fetch(...args) }) {
  let state = { ...createInitialState(), inputRevision: 0 };
  let active = true;
  let listRequestId = 0;
  let sourceRequestId = 0;
  let operationId = 0;
  let inputRevision = 0;
  const listeners = new Set();

  function emit(patch) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  function isCurrentOperation(id, revision) {
    return active && id === operationId && revision === inputRevision;
  }

  function requestUrl({ query = state.query, sourceQuery = state.sourceQuery, sourceCursor = null } = {}) {
    return disclosureRequestUrl(accountId, businessId, query, sourceQuery, sourceCursor);
  }

  async function request(method, body, options = {}) {
    const url = body
      ? `/api/line-oa/accounts/${encodeURIComponent(accountId)}/product-disclosure`
      : requestUrl(options);
    const response = await fetchImpl(url, {
      method,
      ...(body ? {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      } : {}),
    });
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    if (!response.ok) {
      const error = new Error(friendlyError(response.status, payload));
      error.status = response.status;
      throw error;
    }
    return payload && typeof payload === "object" ? payload : {};
  }

  function invalidateInput(patch, { clearUnavailable = false } = {}) {
    if (!active || state.busy === "approve" || state.busy === "withdraw") return false;
    inputRevision += 1;
    operationId += 1;
    emit({
      ...patch,
      inputRevision,
      preview: null,
      ...(clearUnavailable ? { unavailableFields: [] } : {}),
      busy: null,
      error: "",
      message: "",
    });
    return true;
  }

  function currentPolicy() {
    return selectedPolicyFor(state);
  }

  function failValidation(message) {
    emit({ error: message, message: "" });
    return false;
  }

  async function load({ preserveSourcePages = false } = {}) {
    if (!businessId || !accountId || !active) return false;
    const requestId = ++listRequestId;
    const requestSourceId = ++sourceRequestId;
    const previousSources = state.sources;
    const previousCursor = state.sourcesNextCursor;
    emit({ loading: true });
    try {
      const result = await request("GET");
      if (!active || requestId !== listRequestId) return false;
      const products = Array.isArray(result.products) ? result.products : [];
      const sources = Array.isArray(result.sources) ? result.sources : [];
      const policies = Array.isArray(result.policies) ? result.policies : [];
      const fields = Array.isArray(result.fields)
        ? DISCLOSURE_FIELDS.filter(field => result.fields.includes(field))
        : [];
      const selectedFields = state.selectedFields.filter(field => fields.includes(field));
      const sourceResponseIsCurrent = requestSourceId === sourceRequestId;
      emit({
        products,
        policies,
        fields,
        selectedFields,
        loading: false,
        ...(sourceResponseIsCurrent ? {
          sources: preserveSourcePages ? mergeSources(previousSources, sources) : sources,
          sourcesNextCursor: preserveSourcePages ? previousCursor : result.sourcesNextCursor ?? null,
          sourceLoading: false,
        } : {}),
      });
      return true;
    } catch (error) {
      if (active && requestId === listRequestId) {
        emit({ loading: false, error: error.message, message: "" });
      }
      return false;
    }
  }

  async function loadSourcePage({ replace = false } = {}) {
    if (!businessId || !accountId || !active || state.busy === "approve" || state.busy === "withdraw") return false;
    const cursor = replace ? null : state.sourcesNextCursor;
    if (!replace && (!cursor || state.sourceLoading)) return false;
    const requestId = ++sourceRequestId;
    const query = state.query;
    const sourceQuery = state.sourceQuery;
    emit({ sourceLoading: true, error: "", message: "" });
    try {
      const result = await request("GET", null, { query, sourceQuery, sourceCursor: cursor });
      if (!active || requestId !== sourceRequestId
        || query !== state.query || sourceQuery !== state.sourceQuery) return false;
      const sources = Array.isArray(result.sources) ? result.sources : [];
      const nextCursor = result.sourcesNextCursor ?? null;
      if (nextCursor !== null && typeof nextCursor !== "string") {
        throw new Error("รายการแหล่งข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง กรุณาลองใหม่");
      }
      if (!replace && nextCursor && nextCursor === cursor) {
        throw new Error("ไม่สามารถโหลดหน้าถัดไปของแหล่งข้อมูลได้ กรุณาค้นหาใหม่");
      }
      emit({
        sources: replace ? sources : mergeSources(state.sources, sources),
        sourcesNextCursor: nextCursor,
        sourceLoading: false,
      });
      return true;
    } catch (error) {
      if (active && requestId === sourceRequestId) {
        emit({ sourceLoading: false, error: error.message, message: "" });
      }
      return false;
    }
  }

  async function setQuery(query) {
    const value = String(query ?? "");
    if (value === state.query) return false;
    const changed = invalidateInput({
      query: value,
      productId: "",
      sourceId: "",
      selectedFields: [],
    }, { clearUnavailable: true });
    return changed ? load() : false;
  }

  function setSourceQuery(query) {
    const value = String(query ?? "");
    if (value === state.sourceQuery) return false;
    const changed = invalidateInput({
      sourceQuery: value,
      sourceId: "",
      selectedFields: [],
      sources: [],
      sourcesNextCursor: null,
      sourceLoading: false,
    }, { clearUnavailable: true });
    return changed ? loadSourcePage({ replace: true }) : false;
  }

  function loadMoreSources() {
    return loadSourcePage();
  }

  function setProductId(productId) {
    const value = String(productId ?? "");
    if (value && !state.products.some(product => product.id === value)) return false;
    if (value === state.productId) return false;
    return invalidateInput({
      productId: value,
      sourceId: "",
      selectedFields: [],
    }, { clearUnavailable: true });
  }

  function setSourceId(sourceId) {
    const value = String(sourceId ?? "");
    if (value && !state.sources.some(source => source.id === value)) return false;
    if (value === state.sourceId) return false;
    return invalidateInput({
      sourceId: value,
      selectedFields: [],
    }, { clearUnavailable: true });
  }

  function toggleField(field) {
    if (!DISCLOSURE_FIELDS.includes(field) || !state.fields.includes(field)) return false;
    const selected = state.selectedFields.includes(field);
    if (!state.productId || !state.sourceId || (state.unavailableFields.includes(field) && !selected)) return false;
    const selectedFields = selected
      ? state.selectedFields.filter(item => item !== field)
      : DISCLOSURE_FIELDS.filter(item => state.selectedFields.includes(item) || item === field);
    return invalidateInput({ selectedFields });
  }

  function setReason(reason) {
    const value = String(reason ?? "");
    if (value === state.reason) return false;
    return invalidateInput({ reason: value });
  }

  function canWithdraw() {
    const policy = currentPolicy();
    return Boolean(
      state.productId
      && policy?.enabled
      && Number.isInteger(policy.version)
      && state.reason.trim()
      && !state.loading
      && !state.busy,
    );
  }

  async function preview() {
    if (!canPreviewDisclosure(state)) {
      return failValidation("เลือกสินค้า แหล่งข้อมูล และอย่างน้อยหนึ่งช่องที่เปิดเผยได้ก่อนดูตัวอย่าง");
    }
    const fields = DISCLOSURE_FIELDS.filter(field => state.selectedFields.includes(field));
    const body = {
      action: "PREVIEW",
      businessId,
      productId: state.productId,
      sourceId: state.sourceId,
      fields,
    };
    const revision = inputRevision;
    const id = ++operationId;
    emit({ busy: "preview", error: "", message: "" });
    try {
      const result = await request("POST", body);
      if (!isCurrentOperation(id, revision)) return false;
      if (typeof result.previewHash !== "string" || !result.previewHash.trim()
        || !Number.isInteger(result.expectedVersion)
        || !Array.isArray(result.values)
        || typeof result.exampleText !== "string") {
        throw new Error("ตัวอย่างข้อมูลจากเซิร์ฟเวอร์ไม่ครบถ้วน กรุณาลองใหม่");
      }
      const seen = new Set();
      const values = [];
      for (const item of result.values) {
        if (!fields.includes(item?.field) || item.value == null || seen.has(item.field)) continue;
        if (typeof item.value === "string" && !item.value.trim()) continue;
        seen.add(item.field);
        values.push({ field: item.field, value: item.value });
      }
      const unavailableFields = fields.filter(field => !seen.has(field));
      emit({
        busy: null,
        preview: {
          previewHash: result.previewHash,
          expectedVersion: result.expectedVersion,
          values,
          exampleText: result.exampleText,
          selection: { productId: state.productId, sourceId: state.sourceId, fields, revision },
        },
        unavailableFields,
      });
      return true;
    } catch (error) {
      if (isCurrentOperation(id, revision)) {
        emit({
          busy: null,
          ...(error.status === 409 ? { preview: null, unavailableFields: [] } : {}),
          error: error.message,
          message: "",
        });
        if (error.status === 409) await load({ preserveSourcePages: true });
      }
      return false;
    } finally {
      if (isCurrentOperation(id, revision) && state.busy) emit({ busy: null });
    }
  }

  async function approve() {
    if (!canApproveDisclosure(state)) {
      return failValidation(state.reason.trim()
        ? "ดูตัวอย่างข้อมูลปัจจุบันใหม่ก่อนอนุมัติ"
        : "กรอกเหตุผลก่อนอนุมัติการเปิดเผยข้อมูล");
    }
    const previewData = state.preview;
    const body = {
      action: "APPROVE",
      businessId,
      productId: state.productId,
      sourceId: state.sourceId,
      fields: [...previewData.selection.fields],
      expectedVersion: previewData.expectedVersion,
      previewHash: previewData.previewHash,
      reason: state.reason.trim(),
    };
    const revision = inputRevision;
    const id = ++operationId;
    emit({ busy: "approve", error: "", message: "" });
    try {
      await request("POST", body);
      if (!isCurrentOperation(id, revision)) return false;
      inputRevision += 1;
      emit({
        inputRevision,
        busy: null,
        preview: null,
        unavailableFields: [],
        error: "",
        message: "อนุมัติช่องข้อมูลที่เลือกแล้ว",
      });
      await load({ preserveSourcePages: true });
      return true;
    } catch (error) {
      if (isCurrentOperation(id, revision)) {
        if (error.status === 409) inputRevision += 1;
        emit({
          inputRevision,
          busy: null,
          ...(error.status === 409 ? { preview: null, unavailableFields: [] } : {}),
          error: error.message,
          message: "",
        });
        if (error.status === 409) await load({ preserveSourcePages: true });
      }
      return false;
    } finally {
      if (isCurrentOperation(id, revision) && state.busy) emit({ busy: null });
    }
  }

  async function withdraw() {
    const policy = currentPolicy();
    if (!canWithdraw()) {
      return failValidation(state.reason.trim()
        ? "เลือกสินค้าที่มีการอนุมัติอยู่ก่อนถอน"
        : "กรอกเหตุผลก่อนถอนการเปิดเผยข้อมูล");
    }
    const body = {
      action: "WITHDRAW",
      businessId,
      productId: state.productId,
      expectedVersion: policy.version,
      reason: state.reason.trim(),
    };
    const revision = inputRevision;
    const id = ++operationId;
    emit({ busy: "withdraw", error: "", message: "" });
    try {
      await request("POST", body);
      if (!isCurrentOperation(id, revision)) return false;
      inputRevision += 1;
      emit({
        inputRevision,
        busy: null,
        preview: null,
        unavailableFields: [],
        error: "",
        message: "ถอนการเปิดเผยข้อมูลสินค้าสำหรับลูกค้าแล้ว",
      });
      await load({ preserveSourcePages: true });
      return true;
    } catch (error) {
      if (isCurrentOperation(id, revision)) {
        if (error.status === 409) inputRevision += 1;
        emit({
          inputRevision,
          busy: null,
          ...(error.status === 409 ? { preview: null, unavailableFields: [] } : {}),
          error: error.message,
          message: "",
        });
        if (error.status === 409) await load({ preserveSourcePages: true });
      }
      return false;
    } finally {
      if (isCurrentOperation(id, revision) && state.busy) emit({ busy: null });
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    activate() {
      active = true;
    },
    deactivate() {
      active = false;
      listRequestId += 1;
      sourceRequestId += 1;
      operationId += 1;
      inputRevision += 1;
      state = {
        ...state,
        inputRevision,
        preview: null,
        unavailableFields: [],
        busy: null,
        loading: false,
        sourceLoading: false,
      };
    },
    load,
    setQuery,
    setSourceQuery,
    loadMoreSources,
    setProductId,
    setSourceId,
    toggleField,
    setReason,
    preview,
    approve,
    withdraw,
  };
}

function displayValue(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "ไม่สามารถแสดงค่าได้";
  }
}

function policyStatus(policy) {
  if (!policy.enabled) return "ไม่ได้เปิดเผย";
  return policy.stale ? "ข้อมูลเปลี่ยนแปลง ต้องดูตัวอย่างและอนุมัติใหม่" : "อนุมัติให้ลูกค้าเห็น";
}

export default function LineProductDisclosureCard({ businessId, accountId }) {
  const controller = useMemo(
    () => createDisclosureController({ businessId, accountId }),
    [businessId, accountId],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);

  useEffect(() => {
    controller.activate();
    void controller.load();
    return () => controller.deactivate();
  }, [controller]);

  if (!businessId || !accountId) {
    return (
      <section className="grid gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 text-xs text-[var(--text-primary)]">
        <h3 className="font-bold text-sm">ข้อมูลสินค้าที่อนุญาตให้ลูกค้าเห็น</h3>
        <p>เลือก Business และบัญชี LINE ที่เชื่อมต่อแล้วเพื่อจัดการข้อมูลสินค้า</p>
      </section>
    );
  }

  const selectedProduct = state.products.find(product => product.id === state.productId) ?? null;
  const selectedSource = state.sources.find(source => source.id === state.sourceId) ?? null;
  const currentPolicy = selectedPolicyFor(state);
  const commitBusy = state.busy === "approve" || state.busy === "withdraw";
  const approveDisabled = !canApproveDisclosure(state);
  const previewDisabled = !canPreviewDisclosure(state);
  const withdrawDisabled = !currentPolicy?.enabled || !state.reason.trim() || state.loading || Boolean(state.busy);

  return (
    <section aria-labelledby={`product-disclosure-title-${accountId}`} className="grid gap-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 text-[var(--text-primary)]">
      <header className="grid gap-1">
        <h3 id={`product-disclosure-title-${accountId}`} className="font-bold text-sm">ข้อมูลสินค้าที่อนุญาตให้ลูกค้าเห็น</h3>
        <p className="text-xs text-[var(--text-secondary)]">
          เลือกสินค้า แหล่งข้อมูลที่เผยแพร่แล้ว และช่องข้อมูลอย่างชัดเจน ระบบตรวจสอบการจับคู่สินค้ากับแหล่งข้อมูลก่อนแสดงตัวอย่าง
        </p>
      </header>

      <p className="rounded-lg border border-[var(--status-warning)] bg-[var(--status-warning-bg)] p-3 text-xs leading-relaxed">
        ราคาและสต็อกต้องได้รับอนุญาตแยกต่างหาก การอนุมัตินี้ไม่อนุญาตให้อ่านราคา, ATP หรือจำนวนคงเหลือ และไม่ให้คำมั่นเรื่องจำนวนที่พอขายหรือการจัดส่ง
      </p>

      {state.loading && <p role="status" className="text-xs text-[var(--text-secondary)]">กำลังโหลดข้อมูลสินค้าและสถานะปัจจุบัน…</p>}
      {state.error && <p role="alert" className="rounded-lg border border-[var(--status-danger)] bg-[var(--status-danger-bg)] p-3 text-xs">{state.error}</p>}
      {state.message && <p role="status" className="rounded-lg border border-[var(--status-success)] bg-[var(--status-success-bg)] p-3 text-xs">{state.message}</p>}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold">
          ค้นหาสินค้าใน Business นี้
          <input
            type="search"
            value={state.query}
            onChange={event => { void controller.setQuery(event.target.value); }}
            disabled={commitBusy}
            placeholder="ค้นหาด้วยชื่อหรือรหัสสินค้า"
            className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--action-primary-active)] disabled:opacity-50"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          เลือกสินค้า
          <select
            value={state.productId}
            onChange={event => controller.setProductId(event.target.value)}
            disabled={state.loading || commitBusy || state.products.length === 0}
            className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--text-primary)] disabled:opacity-50"
          >
            <option value="">เลือกสินค้าโดยตรง</option>
            {state.products.map(product => (
              <option key={product.id} value={product.id}>{product.code} · {product.name}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          ค้นหาแหล่งข้อมูลที่เผยแพร่แล้ว
          <input
            type="search"
            value={state.sourceQuery}
            onChange={event => controller.setSourceQuery(event.target.value)}
            disabled={commitBusy}
            maxLength={100}
            placeholder="ค้นหาจากชื่อแหล่งข้อมูล"
            className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--action-primary-active)] disabled:opacity-50"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          เลือกแหล่งข้อมูลสินค้า
          <select
            value={state.sourceId}
            onChange={event => controller.setSourceId(event.target.value)}
            disabled={state.loading || state.sourceLoading || commitBusy || state.sources.length === 0}
            className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--text-primary)] disabled:opacity-50"
          >
            <option value="">เลือกแหล่งข้อมูลโดยตรง</option>
            {state.sources.map(source => (
              <option key={source.id} value={source.id}>{source.title} · {source.id}</option>
            ))}
          </select>
        </label>
      </div>

      {state.sourceLoading && (
        <p role="status" className="text-xs text-[var(--text-secondary)]">กำลังค้นหาแหล่งข้อมูลที่เผยแพร่แล้ว…</p>
      )}
      {!state.sourceLoading && state.sources.length === 0 && state.sourceQuery && (
        <p className="text-xs text-[var(--text-secondary)]">
          {state.sourcesNextCursor
            ? "ยังไม่พบชื่อที่ตรงกันในช่วงนี้ ยังมีรายการให้ค้นหาต่อ"
            : "ไม่พบแหล่งข้อมูลที่ตรงกับคำค้นหา"}
        </p>
      )}
      {state.sourcesNextCursor && (
        <button
          type="button"
          disabled={state.sourceLoading || state.loading || commitBusy}
          onClick={() => { void controller.loadMoreSources(); }}
          className="justify-self-start rounded-lg border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.sourceLoading ? "กำลังโหลดแหล่งข้อมูล…" : "โหลดแหล่งข้อมูลเพิ่มเติม"}
        </button>
      )}

      {(selectedProduct || selectedSource) && (
        <div className="grid gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3 text-xs">
          <h4 className="font-semibold">การจับคู่ที่ตรวจสอบ</h4>
          <p>สินค้า: {selectedProduct ? `${selectedProduct.code} · ${selectedProduct.name}` : "ยังไม่ได้เลือก"}</p>
          <p>แหล่งข้อมูล: {selectedSource ? `${selectedSource.title} · ${selectedSource.id}` : "ยังไม่ได้เลือก"}</p>
          <p className="text-[var(--text-secondary)]">การเลือกนี้ระบุคู่สินค้าและแหล่งข้อมูลที่ต้องตรวจสอบแบบตรงรายการ ไม่มีการจับคู่จากชื่อหรือรหัสบางส่วนโดยอัตโนมัติ</p>
        </div>
      )}

      <fieldset disabled={commitBusy} className="grid gap-2 rounded-lg border border-[var(--border-subtle)] p-3 disabled:opacity-70">
        <legend className="px-1 text-xs font-bold">เลือกช่องข้อมูลสำหรับลูกค้า</legend>
        <p className="text-[11px] text-[var(--text-secondary)]">ทุกช่องเริ่มต้นปิดอยู่ รวมถึง SKU รหัสภายในไม่ใช่สิทธิ์เปิดเผย</p>
        {FIELD_OPTIONS.map(({ key, label, detail }) => {
          const checked = state.selectedFields.includes(key);
          const unavailable = state.unavailableFields.includes(key);
          const supported = state.fields.includes(key);
          const disabled = !supported || (unavailable && !checked) || (!state.productId || !state.sourceId);
          return (
            <label key={key} className="flex items-start gap-2 rounded-md px-1 py-1 text-xs">
              <input
                type="checkbox"
                aria-label={`อนุญาตให้เปิดเผย ${label}`}
                checked={checked}
                disabled={disabled}
                onChange={() => controller.toggleField(key)}
                className="mt-0.5 accent-[var(--action-primary-active)] focus:ring-[var(--action-primary-active)]"
              />
              <span className="grid gap-0.5">
                <span className="font-semibold">{label}</span>
                <span className="text-[var(--text-secondary)]">{unavailable ? "ไม่มีค่าในแหล่งข้อมูลนี้ จึงเปิดเผยไม่ได้" : detail}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <label className="grid gap-1 text-xs font-semibold">
        เหตุผลในการอนุมัติหรือถอน
        <textarea
          rows={2}
          value={state.reason}
          onChange={event => controller.setReason(event.target.value)}
          disabled={commitBusy}
          placeholder="ระบุเหตุผลสำหรับบันทึกการอนุมัติหรือถอน"
          className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--action-primary-active)] disabled:opacity-50"
        />
        <span className="font-normal text-[var(--text-secondary)]">การแก้ไขเหตุผลหรือช่องข้อมูลจะล้างตัวอย่าง ต้องดูตัวอย่างใหม่ก่อนอนุมัติ</span>
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={previewDisabled}
          onClick={() => { void controller.preview(); }}
          className="rounded-lg bg-[var(--button-secondary-bg)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.busy === "preview" ? "กำลังตรวจสอบ…" : "ดูตัวอย่างค่าที่เลือก"}
        </button>
        <button
          type="button"
          disabled={approveDisabled}
          onClick={() => { void controller.approve(); }}
          className="rounded-lg bg-[var(--button-primary-bg)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--button-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.busy === "approve" ? "กำลังอนุมัติ…" : "อนุมัติให้ลูกค้าเห็น"}
        </button>
        <button
          type="button"
          disabled={withdrawDisabled}
          onClick={() => { void controller.withdraw(); }}
          className="rounded-lg border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.busy === "withdraw" ? "กำลังถอน…" : "ถอนการเปิดเผยสำหรับสินค้าที่เลือก"}
        </button>
      </div>

      {state.preview && (
        <section aria-label="ตัวอย่างข้อมูลลูกค้า" className="grid gap-2 rounded-lg border border-[var(--action-primary-active)] bg-[var(--bg-subtle)] p-3 text-xs">
          <h4 className="font-bold">ตัวอย่างจากค่าที่เลือก</h4>
          {state.preview.values.length > 0 ? (
            <ul className="grid gap-1">
              {state.preview.values.map(item => (
                <li key={item.field}><strong>{FIELD_LABELS[item.field]}:</strong> {displayValue(item.value)}</li>
              ))}
            </ul>
          ) : <p>ยังไม่มีค่าที่เปิดเผยได้จากแหล่งข้อมูลนี้</p>}
          {state.unavailableFields.length > 0 && (
            <p className="text-[var(--status-warning)]">
              ช่องที่ไม่มีค่าในแหล่งข้อมูล: {state.unavailableFields.map(field => FIELD_LABELS[field]).join(", ")}. ยกเลิกช่องเหล่านี้ก่อนดูตัวอย่างใหม่
            </p>
          )}
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--card-bg)] p-2">
            <p className="mb-1 font-semibold">ข้อความตัวอย่างที่ระบบจะใช้</p>
            <p className="whitespace-pre-wrap">{state.preview.exampleText}</p>
          </div>
        </section>
      )}

      <section aria-label="สถานะนโยบายข้อมูลสินค้า" className="grid gap-2 border-t border-[var(--border-subtle)] pt-3">
        <h4 className="text-xs font-bold">สถานะปัจจุบันของข้อมูลสินค้า</h4>
        {state.policies.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)]">ยังไม่มีนโยบายเปิดเผยข้อมูลสินค้าในบัญชีนี้</p>
        ) : (
          <ul className="grid gap-2">
            {state.policies.map((policy, index) => {
              const product = state.products.find(item => item.id === policy.productId);
              const source = state.sources.find(item => item.id === policy.sourceId);
              const fields = Array.isArray(policy.fields)
                ? policy.fields.filter(field => FIELD_LABELS[field]).map(field => FIELD_LABELS[field])
                : [];
              return (
                <li key={`${policy.productId}-${policy.version ?? index}`} className="grid gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-2 text-xs">
                  <p className="font-semibold">{product ? `${product.code} · ${product.name}` : `สินค้า ${policy.productId}`}</p>
                  <p>{policyStatus(policy)} · เวอร์ชัน {policy.version ?? "—"}{policy.stale ? " · แหล่งข้อมูลหรือสินค้ามีการเปลี่ยนแปลง" : ""}</p>
                  <p>แหล่งข้อมูล: {source?.title ?? policy.sourceId ?? "—"}</p>
                  <p>ช่องที่เลือก: {fields.length ? fields.join(", ") : "ไม่มี"}</p>
                </li>
              );
            })}
          </ul>
        )}
        {currentPolicy?.enabled && currentPolicy.stale && (
          <p className="rounded-lg border border-[var(--status-warning)] bg-[var(--status-warning-bg)] p-2 text-xs">
            การอนุมัติเดิมล้าสมัย ต้องตรวจสอบตัวอย่างและอนุมัติใหม่ก่อนใช้ข้อมูลที่เปลี่ยนแปลง
          </p>
        )}
      </section>
    </section>
  );
}
