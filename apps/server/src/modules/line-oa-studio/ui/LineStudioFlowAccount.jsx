// @req FR-146, FR-151 — LINE Studio Enterprise FlowAccount Mapping
// @spec SDD-060, SDD-061 — FlowAccount Catalog & SKU Mapping
"use client";

import React, { useState } from "react";
import { MOCK_FLOWACCOUNT_MAPPINGS } from "./mockStudioData";
import {
  FileSpreadsheet,
  Search,
  Filter,
  CheckCircle2,
  AlertCircle,
  Package,
  Layers,
  Sparkles,
  ArrowUpDown
} from "lucide-react";

export default function LineStudioFlowAccount() {
  const [items, setItems] = useState(MOCK_FLOWACCOUNT_MAPPINGS);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const filtered = items.filter(item => {
    const matchSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        item.productCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        item.extractedCode.toLowerCase().includes(searchQuery.toLowerCase());
    const matchCat = categoryFilter === "all" || item.category === categoryFilter;
    return matchSearch && matchCat;
  });

  return (
    <div className="space-y-6 pb-12 font-thai">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
            <span>FlowAccount Catalog & Code Mapping</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            จับคู่รหัสสินค้า SKU และระบบออกใบแจ้งหนี้อัตโนมัติของ FlowAccount สำหรับบอท LINE OA
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-600 font-semibold border border-emerald-500/20">
            ✓ เชื่อมต่อ FlowAccount API สำเร็จ
          </span>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-3 p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ค้นหาชื่อสินค้า, รหัส SKU, Supplier..."
            className="w-full pl-9 pr-4 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-brand-amber/30"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
          >
            <option value="all">ทุกหมวดหมู่ (All Categories)</option>
            <option value="Gift Set">Gift Set</option>
            <option value="Flash Drive">Flash Drive</option>
            <option value="แฟลชไดร์ฟ การ์ด">แฟลชไดร์ฟ การ์ด</option>
            <option value="กระบอกน้ำ">กระบอกน้ำ</option>
            <option value="บริการ">บริการ / ค่าใช้จ่าย</option>
          </select>
        </div>
      </div>

      {/* Mapping Table */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 text-slate-500 dark:text-slate-400 uppercase font-semibold">
              <th className="py-3 px-4">ชื่อสินค้า / บริการ</th>
              <th className="py-3 px-4">หมวดหมู่</th>
              <th className="py-3 px-4">รหัสเดิม</th>
              <th className="py-3 px-4">รหัสที่สกัดได้</th>
              <th className="py-3 px-4">Supplier</th>
              <th className="py-3 px-4">ชั้นราคา</th>
              <th className="py-3 px-4">สถานะแคตตาล็อก</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map(item => (
              <tr key={item.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-850/60">
                <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white max-w-xs">
                  <div className="line-clamp-1">{item.name}</div>
                </td>
                <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px]">
                    {item.category}
                  </span>
                </td>
                <td className="py-3.5 px-4 font-mono text-slate-500">
                  {item.productCode}
                </td>
                <td className="py-3.5 px-4 font-mono font-bold text-brand-dark dark:text-brand-amber">
                  {item.extractedCode}
                </td>
                <td className="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300">
                  {item.supplier}
                </td>
                <td className="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300">
                  {item.priceTier}
                </td>
                <td className="py-3.5 px-4">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    item.status.includes("ตรงแคตตาล็อก")
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                      : item.status.includes("ไม่มีรหัส")
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                  }`}>
                    {item.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
