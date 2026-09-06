// @req FR-146, FR-151 — LINE Studio Enterprise Flex Message Editor
// @spec SDD-060, SDD-061 — Visual & JSON Flex Message Builder + Live Mobile Phone Preview
"use client";

import React, { useState } from "react";
import { MOCK_FLEX_TEMPLATES } from "./mockStudioData";
import {
  Sparkles,
  Code2,
  Eye,
  Save,
  Send,
  Plus,
  Copy,
  Check,
  Smartphone,
  Layers,
  ArrowRight,
  ExternalLink,
  MessageCircle
} from "lucide-react";

export default function LineStudioFlexEditor({ project }) {
  const [templates, setTemplates] = useState(MOCK_FLEX_TEMPLATES);
  const [selectedTemplateId, setSelectedTemplateId] = useState("hero-card");
  const [editorMode, setEditorMode] = useState("visual"); // 'visual' | 'json'
  const [jsonContent, setJsonContent] = useState("");
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testSent, setTestSent] = useState(false);

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId) || templates[0];

  // Sync JSON when switching or changing
  React.useEffect(() => {
    if (selectedTemplate) {
      setJsonContent(JSON.stringify(selectedTemplate.json, null, 2));
    }
  }, [selectedTemplateId]);

  const handleUpdateField = (field, value) => {
    const updated = {
      ...selectedTemplate,
      [field]: value
    };
    // Also update json representation
    if (field === "title") {
      updated.json.body.contents[0].text = value;
    } else if (field === "subtitle" && updated.json.body.contents[1]) {
      updated.json.body.contents[1].text = value;
    }
    setTemplates(templates.map(t => t.id === selectedTemplate.id ? updated : t));
    setJsonContent(JSON.stringify(updated.json, null, 2));
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSendTest = () => {
    setTestSent(true);
    setTimeout(() => setTestSent(false), 3000);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] min-h-[650px] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden font-thai">
      {/* Top Action Bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/80 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-brand-amber" />
            <h2 className="font-bold text-slate-900 dark:text-white text-sm">
              Flex Message Designer
            </h2>
            <span className="text-xs text-slate-400 font-mono">({selectedTemplate.name})</span>
          </div>

          {/* Mode Switcher: Visual / JSON */}
          <div className="flex items-center p-1 rounded-xl bg-slate-200/80 dark:bg-slate-800 border border-slate-300/60 dark:border-slate-700 text-xs">
            <button
              onClick={() => setEditorMode("visual")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition-all ${
                editorMode === "visual"
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <Eye className="w-3.5 h-3.5 text-brand-amber" />
              <span>🎨 Visual</span>
            </button>
            <button
              onClick={() => setEditorMode("json")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition-all ${
                editorMode === "json"
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <Code2 className="w-3.5 h-3.5 text-blue-500" />
              <span>{`{ }`} JSON</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleSendTest}
            className={`px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm ${
              testSent ? "text-emerald-600 border-emerald-400" : ""
            }`}
          >
            {testSent ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Send className="w-3.5 h-3.5 text-brand-amber" />}
            <span>{testSent ? "ส่งไปยัง LINE แล้ว!" : "ส่งทดสอบ"}</span>
          </button>
          <button
            onClick={handleSave}
            className={`px-4 py-1.5 rounded-xl text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm ${
              saved ? "bg-emerald-600" : "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20"
            }`}
          >
            {saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span>{saved ? "บันทึกเรียบร้อย" : "บันทึก"}</span>
          </button>
        </div>
      </div>

      {/* 3-Column Workspace: Left Templates + Center Editor/Preview + Right Mobile Simulator */}
      <div className="flex-1 flex overflow-hidden">
        {/* Column 1: Templates Drawer */}
        <div className="w-56 border-r border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/60 p-3 overflow-y-auto shrink-0 space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              TEMPLATES
            </span>
            <button className="text-xs text-brand-amber hover:underline flex items-center gap-1">
              <Plus className="w-3 h-3" />
              <span>สร้างใหม่</span>
            </button>
          </div>

          <div className="space-y-1.5">
            {templates.map(tpl => (
              <button
                key={tpl.id}
                onClick={() => setSelectedTemplateId(tpl.id)}
                className={`w-full text-left p-3 rounded-xl border text-xs transition-all ${
                  selectedTemplateId === tpl.id
                    ? "bg-brand-surface/40 dark:bg-slate-800 border-brand-amber/50 font-bold text-brand-dark dark:text-brand-amber shadow-2xs"
                    : "bg-white dark:bg-slate-850 border-slate-200/70 dark:border-slate-750 text-slate-700 dark:text-slate-300 hover:bg-slate-100/60"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">🎴</span>
                  <span>{tpl.name}</span>
                </div>
                <div className="text-[10px] text-slate-400 font-normal mt-0.5 capitalize">
                  {tpl.category} · {tpl.type}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Column 2: Center Editor & Preview Area */}
        <div className="flex-1 border-r border-slate-200/80 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-950/40 p-6 overflow-y-auto flex flex-col items-center justify-start">
          {editorMode === "visual" ? (
            <div className="w-full max-w-md space-y-6">
              {/* Flex Message Preview Card Container */}
              <div className="w-full rounded-2xl bg-white dark:bg-slate-850 border border-slate-200/80 dark:border-slate-750 shadow-md overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-slate-100/80 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-xs text-slate-500">
                  <span className="font-bold uppercase tracking-wider text-[11px]">
                    FLEX MESSAGE PREVIEW
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-[10px] font-mono">
                    {selectedTemplate.type}
                  </span>
                </div>

                {/* Simulated Card Content */}
                <div className="p-5 space-y-4">
                  {selectedTemplate.heroImage && (
                    <div className="w-full h-40 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 relative">
                      <img
                        src={selectedTemplate.heroImage}
                        alt="Hero"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                      {selectedTemplate.title}
                    </h3>
                    {selectedTemplate.price && (
                      <div className="text-base font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                        {selectedTemplate.price}
                      </div>
                    )}
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {selectedTemplate.subtitle}
                    </p>
                  </div>

                  <div className="pt-2">
                    {selectedTemplate.id === "product-card" ? (
                      <div className="grid grid-cols-2 gap-2">
                        <button className="w-full py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50">
                          {selectedTemplate.button1Text || "สอบถาม"}
                        </button>
                        <button className="w-full py-2.5 rounded-xl bg-[#06C755] hover:bg-[#05a847] text-white text-xs font-semibold shadow-sm">
                          {selectedTemplate.button2Text || "สั่งซื้อ"}
                        </button>
                      </div>
                    ) : (
                      <button className="w-full py-2.5 rounded-xl bg-[#06C755] hover:bg-[#05a847] text-white text-xs font-semibold shadow-sm">
                        {selectedTemplate.primaryButtonText || "เปิดเว็บ"}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Visual Form Inputs to live-edit */}
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-850 border border-slate-200/80 dark:border-slate-750 shadow-xs space-y-3">
                <h4 className="font-bold text-xs text-slate-800 dark:text-slate-200">
                  แก้ไขข้อความและรูปภาพ
                </h4>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">หัวข้อ (Title)</label>
                  <input
                    type="text"
                    value={selectedTemplate.title}
                    onChange={(e) => handleUpdateField("title", e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">รายละเอียด (Subtitle)</label>
                  <input
                    type="text"
                    value={selectedTemplate.subtitle}
                    onChange={(e) => handleUpdateField("subtitle", e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="w-full h-full flex flex-col">
              <div className="flex items-center justify-between pb-2 text-xs text-slate-500">
                <span className="font-mono">flex-message.json</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(jsonContent);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="flex items-center gap-1 text-brand-amber hover:underline text-xs"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? "คัดลอกแล้ว" : "คัดลอก JSON"}</span>
                </button>
              </div>
              <textarea
                value={jsonContent}
                onChange={(e) => setJsonContent(e.target.value)}
                rows={20}
                className="w-full flex-1 p-4 rounded-2xl bg-slate-950 text-emerald-400 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-brand-amber/30 resize-none"
              />
            </div>
          )}
        </div>

        {/* Column 3: Right Rail - Ultra Realistic Mobile Phone Simulator */}
        <div className="w-80 p-4 bg-slate-100/70 dark:bg-slate-900/90 border-l border-slate-200/80 dark:border-slate-800 flex flex-col items-center justify-start shrink-0 overflow-y-auto">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Smartphone className="w-3.5 h-3.5 text-[#06C755]" />
            <span>LINE PREVIEW</span>
          </div>

          {/* Phone Frame */}
          <div className="w-68 rounded-3xl bg-slate-950 p-2.5 shadow-2xl border-4 border-slate-800 relative">
            {/* Phone Speaker Notch */}
            <div className="w-20 h-3.5 bg-slate-800 rounded-full mx-auto mb-2" />

            {/* Phone Screen Area */}
            <div className="rounded-2xl bg-[#7397B8] dark:bg-slate-900 overflow-hidden text-xs flex flex-col h-[480px]">
              {/* LINE Chat Top Bar */}
              <div className="bg-[#243547] text-white p-2.5 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-[#06C755] flex items-center justify-center text-[10px] font-bold">
                    L
                  </div>
                  <span className="font-bold text-xs">{project?.name || "LINE Studio"}</span>
                </div>
                <div className="text-[10px] text-slate-300 font-mono">12:00</div>
              </div>

              {/* Chat Message Stream */}
              <div className="flex-1 p-3 overflow-y-auto space-y-3">
                {/* Flex Message Bubble in Chat */}
                <div className="rounded-xl bg-white dark:bg-slate-800 shadow-md overflow-hidden text-slate-900 dark:text-white max-w-[220px]">
                  {selectedTemplate.heroImage && (
                    <img
                      src={selectedTemplate.heroImage}
                      alt="Hero"
                      className="w-full h-24 object-cover"
                    />
                  )}
                  <div className="p-3 space-y-1">
                    <div className="font-bold text-xs">{selectedTemplate.title}</div>
                    {selectedTemplate.price && (
                      <div className="font-bold text-[11px] text-[#06C755] font-mono">
                        {selectedTemplate.price}
                      </div>
                    )}
                    <div className="text-[10px] text-slate-500">{selectedTemplate.subtitle}</div>
                  </div>
                  <div className="p-2 pt-0">
                    <button className="w-full py-1.5 rounded-lg bg-[#06C755] text-white text-[10px] font-bold shadow-2xs">
                      {selectedTemplate.id === "product-card" ? "สั่งซื้อ" : "เปิดเว็บ"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Chat Input Bar */}
              <div className="bg-white dark:bg-slate-800 p-2 flex items-center gap-2 border-t border-slate-200 dark:border-slate-700">
                <div className="flex-1 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-400 text-[10px]">
                  พิมพ์ข้อความ...
                </div>
                <div className="w-6 h-6 rounded-full bg-[#06C755] flex items-center justify-center text-white text-[10px]">
                  ➤
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
