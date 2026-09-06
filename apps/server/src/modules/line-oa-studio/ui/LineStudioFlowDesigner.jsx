// @req FR-146, FR-151 — LINE Studio Enterprise Flow Designer
// @spec SDD-060, SDD-061 — Visual Node-Based Conversation Flow Graph
"use client";

import React, { useState, useRef } from "react";
import {
  MOCK_FLOW_NODE_TYPES,
  MOCK_INITIAL_FLOW
} from "./mockStudioData";
import {
  Play,
  Save,
  Plus,
  Trash2,
  Settings2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Sparkles,
  Check,
  ChevronRight,
  Info,
  X,
  MessageSquare,
  Zap,
  LayoutTemplate,
  GitBranch,
  Globe,
  Send,
  Terminal,
  FileCode,
  Clock,
  Square
} from "lucide-react";

export default function LineStudioFlowDesigner({ project }) {
  const [nodes, setNodes] = useState(MOCK_INITIAL_FLOW.nodes);
  const [edges, setEdges] = useState(MOCK_INITIAL_FLOW.edges);
  const [selectedNodeId, setSelectedNodeId] = useState("node-2");
  const [scale, setScale] = useState(1);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [testSimulating, setTestSimulating] = useState(false);
  const [simLog, setSimLog] = useState([]);

  const canvasRef = useRef(null);
  const draggingNodeRef = useRef(null);
  const offsetRef = useRef({ x: 0, y: 0 });

  const getNodeIcon = (type) => {
    switch (type) {
      case "start": return <Play className="w-4 h-4 fill-current" />;
      case "message": return <MessageSquare className="w-4 h-4" />;
      case "quick_reply": return <Zap className="w-4 h-4" />;
      case "flex": return <LayoutTemplate className="w-4 h-4" />;
      case "condition": return <GitBranch className="w-4 h-4" />;
      case "liff": return <Globe className="w-4 h-4" />;
      case "push": return <Send className="w-4 h-4" />;
      case "api_call": return <Terminal className="w-4 h-4" />;
      case "variable": return <FileCode className="w-4 h-4" />;
      case "wait": return <Clock className="w-4 h-4" />;
      case "end": return <Square className="w-4 h-4" />;
      default: return <MessageSquare className="w-4 h-4" />;
    }
  };

  const handleAddNode = (typeItem) => {
    const newNodeId = `node-${Date.now()}`;
    const newNode = {
      id: newNodeId,
      type: typeItem.id,
      title: typeItem.name.toUpperCase(),
      subtitle: typeItem.id === "message" ? "ข้อความตอบกลับอัตโนมัติ" : `Node ${typeItem.name}`,
      x: 350 + Math.random() * 80,
      y: 200 + Math.random() * 80,
      config: {
        text: typeItem.id === "message" ? "พิมพ์ข้อความที่นี่..." : ""
      }
    };
    setNodes([...nodes, newNode]);
    setSelectedNodeId(newNodeId);

    // Auto connect to last node if exists
    if (nodes.length > 0) {
      const lastNode = nodes[nodes.length - 1];
      setEdges([...edges, { id: `e-${lastNode.id}-${newNodeId}`, from: lastNode.id, to: newNodeId }]);
    }
  };

  const handleMouseDownNode = (e, nodeId) => {
    e.stopPropagation();
    setSelectedNodeId(nodeId);
    draggingNodeRef.current = nodeId;
    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      offsetRef.current = {
        x: e.clientX - node.x,
        y: e.clientY - node.y
      };
    }
  };

  const handleMouseMoveCanvas = (e) => {
    if (!draggingNodeRef.current) return;
    const updatedX = e.clientX - offsetRef.current.x;
    const updatedY = e.clientY - offsetRef.current.y;

    setNodes(prev => prev.map(n => {
      if (n.id === draggingNodeRef.current) {
        return { ...n, x: Math.max(20, Math.min(updatedX, 1400)), y: Math.max(20, Math.min(updatedY, 900)) };
      }
      return n;
    }));
  };

  const handleMouseUpCanvas = () => {
    draggingNodeRef.current = null;
  };

  const handleDeleteNode = (nodeId) => {
    setNodes(nodes.filter(n => n.id !== nodeId));
    setEdges(edges.filter(e => e.from !== nodeId && e.to !== nodeId));
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
    }
  };

  const selectedNode = nodes.find(n => n.id === selectedNodeId);

  const handleSaveFlow = () => {
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const handleRunSimulation = () => {
    setTestSimulating(true);
    setSimLog([
      "🚀 เริ่มต้นจำลองเหตุการณ์: Follow Event (ผู้ใช้กดติดตาม LINE OA)",
      "▶️ กำลังส่งข้อมูลไปยัง Node [START]...",
      "⚡ ตรวจสอบเงื่อนไขการส่งต่อ Node Connection...",
      "💬 ดำเนินการ Node [MESSAGE]: ยินดีต้อนรับ สวัสดีครับ! ยินดีต้อนรับ🎉",
      "✅ ข้อความถูกส่งเข้าห้องแชทจำลองสำเร็จ (Response: 200 OK)"
    ]);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] min-h-[600px] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden font-thai">
      {/* Top Action Bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/80 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h2 className="font-bold text-slate-900 dark:text-white text-sm">
              {MOCK_INITIAL_FLOW.name}
            </h2>
            <span className="text-xs text-slate-400 font-mono">({project?.name || "LINE Studio"})</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleRunSimulation}
            className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
          >
            <Play className="w-3.5 h-3.5 text-emerald-500 fill-emerald-500" />
            <span>จำลองการทำงาน</span>
          </button>
          <button
            onClick={handleSaveFlow}
            className={`px-4 py-1.5 rounded-xl text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm ${
              saveSuccess
                ? "bg-emerald-600 shadow-emerald-500/20"
                : "bg-brand-amber hover:bg-brand-hover shadow-brand-amber/20"
            }`}
          >
            {saveSuccess ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span>{saveSuccess ? "บันทึกเรียบร้อย!" : "บันทึก Flow"}</span>
          </button>
        </div>
      </div>

      {/* Main Workspace: Left Node Palette + Center Visual Canvas + Right Node Editor Drawer */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Palette: Node Types */}
        <div className="w-56 border-r border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/60 p-3 overflow-y-auto shrink-0 space-y-3">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-1">
            NODE TYPES
          </div>
          <div className="space-y-1.5">
            {MOCK_FLOW_NODE_TYPES.map(type => (
              <button
                key={type.id}
                onClick={() => handleAddNode(type)}
                className="w-full flex items-center justify-between p-2 rounded-xl bg-white dark:bg-slate-850 hover:bg-brand-tint/20 dark:hover:bg-brand-surface/20 border border-slate-200/70 dark:border-slate-750 text-xs font-medium text-slate-800 dark:text-slate-200 transition-all shadow-2xs group"
              >
                <div className="flex items-center gap-2.5">
                  <div className={`p-1.5 rounded-lg border ${type.color}`}>
                    {getNodeIcon(type.id)}
                  </div>
                  <span>{type.name}</span>
                </div>
                <Plus className="w-3.5 h-3.5 text-slate-400 group-hover:text-brand-dark dark:group-hover:text-brand-amber transition-colors" />
              </button>
            ))}
          </div>
        </div>

        {/* Center Visual Canvas */}
        <div
          ref={canvasRef}
          onMouseMove={handleMouseMoveCanvas}
          onMouseUp={handleMouseUpCanvas}
          className="flex-1 relative bg-slate-100/60 dark:bg-slate-950 overflow-hidden cursor-crosshair select-none"
          style={{
            backgroundImage: "radial-gradient(#94a3b8 1px, transparent 1px)",
            backgroundSize: "24px 24px"
          }}
        >
          {/* SVG Connection Lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
            {edges.map(edge => {
              const fromNode = nodes.find(n => n.id === edge.from);
              const toNode = nodes.find(n => n.id === edge.to);
              if (!fromNode || !toNode) return null;

              const startX = fromNode.x + 200;
              const startY = fromNode.y + 60;
              const endX = toNode.x;
              const endY = toNode.y + 60;
              const controlDist = Math.abs(endX - startX) * 0.5;

              return (
                <path
                  key={edge.id}
                  d={`M ${startX} ${startY} C ${startX + controlDist} ${startY}, ${endX - controlDist} ${endY}, ${endX} ${endY}`}
                  fill="none"
                  stroke="#06C755"
                  strokeWidth="3"
                  strokeLinecap="round"
                  className="transition-all"
                />
              );
            })}
          </svg>

          {/* Node Elements */}
          {nodes.map(node => {
            const isSelected = selectedNodeId === node.id;
            return (
              <div
                key={node.id}
                onMouseDown={(e) => handleMouseDownNode(e, node.id)}
                style={{
                  transform: `translate(${node.x}px, ${node.y}px)`,
                  width: "200px"
                }}
                className={`absolute z-20 rounded-2xl bg-white dark:bg-slate-850 border-2 shadow-lg transition-shadow cursor-grab active:cursor-grabbing p-4 ${
                  isSelected
                    ? "border-brand-amber ring-4 ring-brand-amber/15 shadow-xl"
                    : "border-slate-200 dark:border-slate-700 hover:border-slate-400"
                }`}
              >
                {/* Node Top Header */}
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-750">
                  <div className="flex items-center gap-2">
                    <div className="p-1 rounded-md bg-amber-500/10 text-brand-amber">
                      {getNodeIcon(node.type)}
                    </div>
                    <span className="font-bold text-xs text-slate-800 dark:text-slate-100">
                      {node.title}
                    </span>
                  </div>
                  {nodes.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteNode(node.id);
                      }}
                      className="text-slate-300 hover:text-red-500 transition-colors p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Node Body */}
                <div className="mt-2.5 text-xs text-slate-600 dark:text-slate-300 whitespace-pre-line line-clamp-3">
                  {node.subtitle || node.config?.text || "ตั้งค่า Node นี้..."}
                </div>

                {/* Connection Ports */}
                <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-850 shadow-sm" />
                <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-850 shadow-sm" />
              </div>
            );
          })}

          {/* Canvas Floating Controls */}
          <div className="absolute bottom-5 left-5 z-30 flex items-center gap-1.5 p-1.5 rounded-xl bg-white/90 dark:bg-slate-850/90 border border-slate-200/80 dark:border-slate-700 shadow-md backdrop-blur-md">
            <button
              onClick={() => setScale(s => Math.min(s + 0.1, 1.5))}
              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-750"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={() => setScale(s => Math.max(s - 0.1, 0.6))}
              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-750"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={() => setScale(1)}
              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-750 text-xs font-mono px-2"
            >
              1:1
            </button>
          </div>
        </div>

        {/* Right Drawer: Node Configuration */}
        {selectedNode && (
          <div className="w-72 border-l border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-850 p-4 overflow-y-auto shrink-0 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-750">
              <div className="flex items-center gap-2 font-bold text-xs text-slate-800 dark:text-slate-200">
                <Settings2 className="w-4 h-4 text-brand-amber" />
                <span>คุณสมบัติ Node ({selectedNode.title})</span>
              </div>
              <button
                onClick={() => setSelectedNodeId(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                ชื่อหัวข้อ Node
              </label>
              <input
                type="text"
                value={selectedNode.title}
                onChange={(e) => {
                  const val = e.target.value;
                  setNodes(nodes.map(n => n.id === selectedNode.id ? { ...n, title: val } : n));
                }}
                className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
              />
            </div>

            {selectedNode.type === "start" && (
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  ประเภทเหตุการณ์เริ่มต้น (Trigger)
                </label>
                <select
                  value={selectedNode.config?.trigger || "follow_event"}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNodes(nodes.map(n => n.id === selectedNode.id ? { ...n, config: { ...n.config, trigger: val }, subtitle: val === "follow_event" ? "Follow Event" : val } : n));
                  }}
                  className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                >
                  <option value="follow_event">Follow Event (ผู้ใช้กดติดตาม)</option>
                  <option value="message_keyword">Message Keyword (คำสำคัญ)</option>
                  <option value="postback">Postback (กดปุ่มหรือ Rich Menu)</option>
                  <option value="qr_scan">QR Code Scan</option>
                </select>
              </div>
            )}

            {selectedNode.type === "message" && (
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  ข้อความตอบกลับ
                </label>
                <textarea
                  rows={4}
                  value={selectedNode.config?.text || ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNodes(nodes.map(n => n.id === selectedNode.id ? { ...n, config: { ...n.config, text: val }, subtitle: val } : n));
                  }}
                  placeholder="ใส่ข้อความต้อนรับหรือข้อมูลตอบกลับ..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-amber/30"
                />
              </div>
            )}

            <div className="p-3 rounded-xl bg-brand-surface/40 dark:bg-slate-800/40 border border-brand-amber/20 text-[11px] text-slate-600 dark:text-slate-300 flex items-start gap-2">
              <Info className="w-4 h-4 text-brand-amber shrink-0 mt-0.5" />
              <span>การแก้ไข Flow ในหน้านี้จะมีผลในทันทีเมื่อกดบันทึก</span>
            </div>
          </div>
        )}
      </div>

      {/* Simulation Modal */}
      {testSimulating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden font-thai">
            <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Play className="w-4 h-4 text-emerald-500 fill-emerald-500" />
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                  จำลองการรัน Flow ในสภาพแวดล้อมทดสอบ
                </h3>
              </div>
              <button
                onClick={() => setTestSimulating(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 bg-slate-950 text-emerald-400 font-mono text-xs space-y-2 max-h-72 overflow-y-auto">
              {simLog.map((log, idx) => (
                <div key={idx} className="leading-relaxed">
                  {log}
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <button
                onClick={() => setTestSimulating(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-200"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
