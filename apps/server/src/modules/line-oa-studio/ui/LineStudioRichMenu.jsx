// @req FR-146, FR-151, FR-152 — LINE Studio Enterprise Rich Menu Builder
// @spec SDD-060, SDD-061 — Live Rich Menu API & Layout Configurator
"use client";

import React, { useState, useEffect } from "react";
import {
  Smartphone,
  Save,
  Rocket,
  Check,
  LayoutGrid,
  Link,
  MessageSquare,
  Repeat,
  Sparkles,
  Info,
  ChevronRight,
  Plus,
  RefreshCw,
  AlertTriangle
} from "lucide-react";

const LAYOUT_OPTIONS = [
  { id: "1x1", name: "1 ช่อง เต็ม", rows: 1, cols: 1, zones: ["A"] },
  { id: "2x1", name: "2 ช่อง บน-ล่าง", rows: 2, cols: 1, zones: ["A", "B"] },
  { id: "1x2", name: "2 ช่อง ซ้าย-ขวา", rows: 1, cols: 2, zones: ["A", "B"] },
  { id: "2x2", name: "4 ช่อง จัตุรัส", rows: 2, cols: 2, zones: ["A", "B", "C", "D"] },
  { id: "2x3", name: "6 ช่อง มาตรฐาน", rows: 2, cols: 3, zones: ["A", "B", "C", "D", "E", "F"] },
  { id: "3x1", name: "3 ช่อง แถวเดี่ยว", rows: 1, cols: 3, zones: ["A", "B", "C"] }
];

export default function LineStudioRichMenu({ project }) {
  const accountId = project?.id;

  const [menus, setMenus] = useState([]);
  const [selectedMenu, setSelectedMenu] = useState(null);
  const [selectedLayoutId, setSelectedLayoutId] = useState("2x3");
  const [chatBarText, setChatBarText] = useState("เมนูหลัก");
  const [selectedZone, setSelectedZone] = useState("A");
  const [zoneActions, setZoneActions] = useState({
    A: { type: "uri", value: "https://zuri.ai", label: "หน้าแรก" },
    B: { type: "message", value: "เช็คสถานะออเดอร์", label: "สถานะออเดอร์" },
    C: { type: "message", value: "ติดต่อเจ้าหน้าที่", label: "ติดต่อแอดมิน" },
    D: { type: "uri", value: "https://liff.line.me/app", label: "บริการสมาชิก" },
    E: { type: "postback", value: "action=faq", label: "คำถามที่พบบ่อย" },
    F: { type: "uri", value: "https://zuri.ai/location", label: "สาขาและแผนที่" }
  });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState("");

  const fetchMenus = async () => {
    if (!accountId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/line-oa/rich-menus?accountId=${encodeURIComponent(accountId)}`);
      const data = await res.json();
      if (res.ok && data.richMenus) {
        setMenus(data.richMenus);
        if (data.richMenus.length > 0 && !selectedMenu) {
          setSelectedMenu(data.richMenus[0]);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMenus();
  }, [accountId]);

  const currentLayout = LAYOUT_OPTIONS.find(l => l.id === selectedLayoutId) || LAYOUT_OPTIONS[4];

  const handleUpdateZoneAction = (zone, key, val) => {
    setZoneActions(prev => ({
      ...prev,
      [zone]: {
        ...prev[zone],
        [key]: val
      }
    }));
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    setError("");
    try {
      if (accountId) {
        const payload = {
          lineOaAccountId: accountId,
          code: `menu-${Date.now()}`,
          name: chatBarText || "Main Rich Menu",
          layout: selectedLayoutId,
          chatBarText: chatBarText,
          areasJson: JSON.stringify(zoneActions)
        };
        const res = await fetch("/api/line-oa/rich-menus", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.issues?.join(" · ") || errData.error || "Failed to save rich menu");
        }
        await fetchMenus();
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] min-h-[650px] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden font-thai">
      {/* Top Action Bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/80 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-brand-amber" />
            <h2 className="font-bold text-slate-900 dark:text-white text-sm">
              Rich Menu Builder
            </h2>
            <span className="text-xs text-slate-400 font-mono">({project?.name || "LINE Studio"})</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {error && <span className="text-xs text-rose-600 font-semibold">{error}</span>}
          <button
            onClick={handleSaveDraft}
            disabled={saving}
            className={`px-4 py-1.5 rounded-xl text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm ${
              saveSuccess
                ? "bg-emerald-600 shadow-emerald-500/20"
                : "bg-brand-amber hover:bg-brand-hover shadow-brand-amber/20"
            }`}
          >
            {saveSuccess ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span>{saving ? "กำลังบันทึก..." : saveSuccess ? "บันทึกสำเร็จ!" : "บันทึก Rich Menu"}</span>
          </button>
        </div>
      </div>

      {/* Main Studio Grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
        {/* Left Column: Layout Selector & Settings (4 cols) */}
        <div className="lg:col-span-4 p-5 border-r border-slate-200/80 dark:border-slate-800 overflow-y-auto space-y-5 bg-slate-50/40 dark:bg-slate-900/40">
          <div>
            <label className="text-xs font-bold text-slate-900 dark:text-white block mb-2">
              1. เลือกรูปแบบ Layout ช่องเมนู
            </label>
            <div className="grid grid-cols-2 gap-2">
              {LAYOUT_OPTIONS.map((layout) => (
                <button
                  key={layout.id}
                  onClick={() => {
                    setSelectedLayoutId(layout.id);
                    setSelectedZone(layout.zones[0]);
                  }}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    selectedLayoutId === layout.id
                      ? "border-brand-amber bg-brand-amber/10 text-brand-dark dark:text-brand-amber shadow-xs"
                      : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-850 text-slate-700 dark:text-slate-300 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs">{layout.name}</span>
                    <LayoutGrid className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">{layout.id} grid</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 pt-3 border-t border-slate-200/60 dark:border-slate-800">
            <label className="text-xs font-bold text-slate-900 dark:text-white block">
              2. ข้อความแถบเมนูด้านล่าง (Chat Bar Text)
            </label>
            <input
              type="text"
              value={chatBarText}
              onChange={(e) => setChatBarText(e.target.value)}
              placeholder="เช่น เมนูหลัก / กดเพื่อเปิดเมนู"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 p-2.5 text-xs focus:ring-2 focus:ring-brand-amber/30 focus:outline-none"
            />
          </div>

          <div className="space-y-3 pt-3 border-t border-slate-200/60 dark:border-slate-800">
            <label className="text-xs font-bold text-slate-900 dark:text-white block">
              3. ตั้งค่า Action ประจำโซน [{selectedZone}]
            </label>
            <div className="space-y-2.5">
              <div>
                <span className="text-[11px] text-slate-500 block mb-1">ประเภทการกระทำ (Action Type)</span>
                <select
                  value={zoneActions[selectedZone]?.type || "uri"}
                  onChange={(e) => handleUpdateZoneAction(selectedZone, "type", e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 p-2 text-xs"
                >
                  <option value="uri">🔗 เปิดลิงก์ URL / LIFF App</option>
                  <option value="message">💬 ส่งข้อความแชท (Message)</option>
                  <option value="postback">⚡ Postback Event Data</option>
                </select>
              </div>

              <div>
                <span className="text-[11px] text-slate-500 block mb-1">ค่า Value / URL / Payload</span>
                <input
                  type="text"
                  value={zoneActions[selectedZone]?.value || ""}
                  onChange={(e) => handleUpdateZoneAction(selectedZone, "value", e.target.value)}
                  placeholder="https://... หรือ ข้อความที่ต้องการส่ง"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 p-2.5 text-xs font-mono"
                />
              </div>

              <div>
                <span className="text-[11px] text-slate-500 block mb-1">ป้ายกำกับ (Label)</span>
                <input
                  type="text"
                  value={zoneActions[selectedZone]?.label || ""}
                  onChange={(e) => handleUpdateZoneAction(selectedZone, "label", e.target.value)}
                  placeholder="ชื่อปุ่ม"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 p-2.5 text-xs"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Live Mobile Mockup Preview (8 cols) */}
        <div className="lg:col-span-8 p-6 flex flex-col items-center justify-center bg-slate-100/60 dark:bg-slate-950/60 overflow-y-auto">
          <div className="w-full max-w-sm rounded-[36px] bg-slate-900 p-3.5 shadow-2xl border-4 border-slate-800">
            {/* Phone Screen Canvas */}
            <div className="w-full h-[520px] rounded-[26px] bg-[#849EB5] flex flex-col justify-between overflow-hidden relative">
              {/* Top Chat Bar */}
              <div className="bg-[#2E3C4E] px-4 py-2.5 text-white flex items-center justify-between text-xs font-bold shadow-xs">
                <span>{project?.name || "Zuri Support"}</span>
                <span className="text-[10px] text-emerald-400 font-normal">● Official</span>
              </div>

              {/* Chat Simulation Area */}
              <div className="p-3 space-y-2 text-xs overflow-y-auto">
                <div className="bg-white rounded-2xl rounded-tl-xs p-2.5 max-w-[80%] shadow-xs text-slate-800">
                  สวัสดีครับ มีอะไรให้เราช่วยเหลือหรือกดเมนูด้านล่างได้เลยครับ 🎉
                </div>
              </div>

              {/* Rich Menu Bottom Canvas */}
              <div className="bg-white border-t-2 border-slate-300">
                <div
                  className="grid gap-1 p-1 bg-slate-200"
                  style={{
                    gridTemplateRows: `repeat(${currentLayout.rows}, minmax(0, 1fr))`,
                    gridTemplateColumns: `repeat(${currentLayout.cols}, minmax(0, 1fr))`
                  }}
                >
                  {currentLayout.zones.map((zone) => {
                    const isSelected = selectedZone === zone;
                    const action = zoneActions[zone];

                    return (
                      <button
                        key={zone}
                        onClick={() => setSelectedZone(zone)}
                        className={`h-20 rounded-lg p-2 text-center flex flex-col items-center justify-center transition-all ${
                          isSelected
                            ? "bg-brand-amber text-white font-bold shadow-sm"
                            : "bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <span className="text-xs font-black">{zone}</span>
                        <span className="text-[10px] truncate max-w-[90%] font-semibold mt-0.5">
                          {action?.label || `โซน ${zone}`}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Bottom Chat Bar Trigger */}
                <div className="bg-slate-100 py-1.5 text-center text-[10px] font-bold text-slate-600 border-t border-slate-200">
                  ▲ {chatBarText}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
