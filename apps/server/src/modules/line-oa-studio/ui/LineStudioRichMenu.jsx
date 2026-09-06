// @req FR-146, FR-151, FR-152 — LINE Studio Enterprise Rich Menu Builder
// @spec SDD-060, SDD-061 — Interactive Rich Menu Layout & Action Configurator
"use client";

import React, { useState } from "react";
import { MOCK_RICH_MENU_LAYOUTS } from "./mockStudioData";
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
  ChevronRight
} from "lucide-react";

export default function LineStudioRichMenu({ project }) {
  const [selectedLayoutId, setSelectedLayoutId] = useState("2x3");
  const [chatBarText, setChatBarText] = useState("เมนูหลัก");
  const [defaultOpen, setDefaultOpen] = useState(true);
  const [selectedZone, setSelectedZone] = useState("A");
  const [zoneActions, setZoneActions] = useState({
    A: { type: "uri", value: "https://zuri.ai/store", label: "สั่งซื้อสินค้า" },
    B: { type: "message", value: "เช็คสถานะออเดอร์", label: "สถานะออเดอร์" },
    C: { type: "message", value: "ติดต่อเจ้าหน้าที่", label: "ติดต่อแอดมิน" },
    D: { type: "uri", value: "https://liff.line.me/1657892011-kLa92mP", label: "สะสมแต้ม" },
    E: { type: "postback", value: "action=faq", label: "คำถามที่พบบ่อย" },
    F: { type: "uri", value: "https://zuri.ai/location", label: "แผนที่และสาขา" }
  });

  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deploySuccess, setDeploySuccess] = useState(false);

  const currentLayout = MOCK_RICH_MENU_LAYOUTS.find(l => l.id === selectedLayoutId) || MOCK_RICH_MENU_LAYOUTS[4];

  const handleUpdateZoneAction = (zone, key, val) => {
    setZoneActions(prev => ({
      ...prev,
      [zone]: {
        ...prev[zone],
        [key]: val
      }
    }));
  };

  const handleSaveDraft = () => {
    setSaving(true);
    setTimeout(() => setSaving(false), 1500);
  };

  const handleDeployToLine = () => {
    setDeploying(true);
    setTimeout(() => {
      setDeploying(false);
      setDeploySuccess(true);
      setTimeout(() => setDeploySuccess(false), 3000);
    }, 1800);
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
          <button
            onClick={handleSaveDraft}
            className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
          >
            <Save className="w-3.5 h-3.5 text-slate-500" />
            <span>{saving ? "กำลังบันทึก..." : "บันทึกแบบร่าง"}</span>
          </button>
          <button
            onClick={handleDeployToLine}
            disabled={deploying}
            className={`px-4 py-1.5 rounded-xl text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm ${
              deploySuccess
                ? "bg-emerald-600 shadow-emerald-500/20"
                : "bg-gradient-to-r from-brand-amber to-brand-hover hover:opacity-90 shadow-brand-amber/20"
            }`}
          >
            {deploySuccess ? <Check className="w-3.5 h-3.5" /> : <Rocket className="w-3.5 h-3.5" />}
            <span>{deploying ? "กำลังส่งไปยัง LINE..." : deploySuccess ? "Deploy สำเร็จแล้ว!" : "Deploy to LINE"}</span>
          </button>
        </div>
      </div>

      {/* Main Workspace: Left Layout Selector + Center Canvas + Right Zone Config */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Layout Templates */}
        <div className="w-60 border-r border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/60 p-4 overflow-y-auto shrink-0 space-y-4">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            เลือกรูปแบบโครงสร้าง (LAYOUT)
          </div>

          <div className="space-y-2">
            {MOCK_RICH_MENU_LAYOUTS.map(layout => (
              <button
                key={layout.id}
                onClick={() => {
                  setSelectedLayoutId(layout.id);
                  if (!layout.zones.includes(selectedZone)) {
                    setSelectedZone(layout.zones[0]);
                  }
                }}
                className={`w-full p-3 rounded-xl border text-left transition-all ${
                  selectedLayoutId === layout.id
                    ? "bg-brand-surface/50 dark:bg-slate-800 border-brand-amber text-brand-dark dark:text-brand-amber shadow-2xs font-bold"
                    : "bg-white dark:bg-slate-850 border-slate-200/70 dark:border-slate-750 text-slate-700 dark:text-slate-300 hover:bg-slate-100"
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span>{layout.name}</span>
                  <span className="font-mono text-[10px] text-slate-400">({layout.id})</span>
                </div>
                <div className="mt-1.5 text-[10px] text-slate-400 font-normal">
                  {layout.zones.length} พื้นที่สัมผัส (Zones {layout.zones.join(", ")})
                </div>
              </button>
            ))}
          </div>

          {/* Chat Bar Settings */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3 text-xs">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                ข้อความบนแถบเมนูแชท (Chat Bar)
              </label>
              <input
                type="text"
                value={chatBarText}
                onChange={(e) => setChatBarText(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-600 dark:text-slate-400">เปิดเมนูอัตโนมัติ</span>
              <input
                type="checkbox"
                checked={defaultOpen}
                onChange={(e) => setDefaultOpen(e.target.checked)}
                className="w-4 h-4 text-brand-amber rounded focus:ring-brand-amber"
              />
            </div>
          </div>
        </div>

        {/* Center: Interactive Visual Rich Menu Grid Canvas */}
        <div className="flex-1 bg-slate-100/50 dark:bg-slate-950 p-6 flex flex-col items-center justify-center overflow-y-auto">
          <div className="w-full max-w-xl space-y-3">
            <div className="text-center text-xs text-slate-500 font-thai">
              คลิกที่ช่อง (Zone) เพื่อตั้งค่า Action ให้กับปุ่มนั้นๆ
            </div>

            {/* Rich Menu Canvas (2500 x 1686 standard aspect ratio 3:2) */}
            <div className="w-full aspect-[3/2] rounded-2xl bg-white dark:bg-slate-850 border-2 border-slate-300 dark:border-slate-700 shadow-xl overflow-hidden relative grid p-2 gap-2"
              style={{
                gridTemplateRows: `repeat(${currentLayout.rows}, 1fr)`,
                gridTemplateColumns: `repeat(${currentLayout.cols}, 1fr)`
              }}
            >
              {currentLayout.zones.map((zone) => {
                const isSelected = selectedZone === zone;
                const action = zoneActions[zone] || { label: `Zone ${zone}`, type: "message" };

                return (
                  <button
                    key={zone}
                    onClick={() => setSelectedZone(zone)}
                    className={`rounded-xl p-3 flex flex-col items-center justify-center text-center transition-all border-2 relative group ${
                      isSelected
                        ? "bg-brand-surface/90 dark:bg-brand-amber/20 border-brand-amber ring-4 ring-brand-amber/20 shadow-md"
                        : "bg-slate-50 dark:bg-slate-800/80 border-dashed border-slate-300 dark:border-slate-700 hover:border-brand-amber/50 hover:bg-slate-100"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-brand-amber/15 text-brand-dark dark:text-brand-amber font-bold text-sm flex items-center justify-center mb-1">
                      {zone}
                    </div>
                    <div className="font-bold text-xs text-slate-800 dark:text-slate-100 group-hover:text-brand-amber">
                      {action.label || `Zone ${zone}`}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5 uppercase">
                      {action.type}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Bottom Simulated Chat Bar */}
            <div className="w-full py-2.5 px-4 rounded-xl bg-slate-850 text-white flex items-center justify-between text-xs font-semibold shadow-md">
              <span className="font-thai">{chatBarText}</span>
              <span className="text-slate-400 text-[10px]">▲ ยุบ/ขยายเมนู</span>
            </div>
          </div>
        </div>

        {/* Right: Zone Action Configurator */}
        <div className="w-72 border-l border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-850 p-4 overflow-y-auto shrink-0 space-y-4">
          <div className="pb-3 border-b border-slate-100 dark:border-slate-750">
            <h3 className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-brand-amber text-white flex items-center justify-center text-[10px] font-bold">
                {selectedZone}
              </span>
              <span>ตั้งค่าปุ่ม Zone {selectedZone}</span>
            </h3>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
              ชื่อปุ่มแสดงผล (Label)
            </label>
            <input
              type="text"
              value={zoneActions[selectedZone]?.label || ""}
              onChange={(e) => handleUpdateZoneAction(selectedZone, "label", e.target.value)}
              placeholder="เช่น สั่งซื้อสินค้า"
              className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
              ประเภทการทำงาน (Action Type)
            </label>
            <select
              value={zoneActions[selectedZone]?.type || "uri"}
              onChange={(e) => handleUpdateZoneAction(selectedZone, "type", e.target.value)}
              className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
            >
              <option value="uri">เปิดเว็บไซต์ (URI Link)</option>
              <option value="message">ส่งข้อความอัตโนมัติ (Message Text)</option>
              <option value="postback">Postback Event (สั่งรัน Flow)</option>
              <option value="richmenuswitch">สลับ Rich Menu (Switch Menu)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
              ค่าที่ส่ง / ลิงก์ (Target Value)
            </label>
            <input
              type="text"
              value={zoneActions[selectedZone]?.value || ""}
              onChange={(e) => handleUpdateZoneAction(selectedZone, "value", e.target.value)}
              placeholder={zoneActions[selectedZone]?.type === "uri" ? "https://..." : "ข้อความหรือค่าตัวแปร..."}
              className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white font-mono"
            />
          </div>

          <div className="p-3 rounded-xl bg-brand-surface/40 dark:bg-slate-800/40 border border-brand-amber/20 text-[11px] text-slate-600 dark:text-slate-300">
            <Info className="w-4 h-4 text-brand-amber inline-block mr-1 -mt-0.5" />
            <span>เมื่อผู้ใช้แตะที่พื้นที่นี้ใน LINE ระบบจะทำงานตามที่ระบุทันที</span>
          </div>
        </div>
      </div>
    </div>
  );
}
