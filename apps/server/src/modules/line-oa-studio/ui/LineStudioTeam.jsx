// @req FR-146, FR-021, FR-061 — LINE Studio Enterprise Team & RBAC
// @spec SDD-060, SDD-061 — Live Team Directory & Workspace Invites
"use client";

import React, { useState, useEffect } from "react";
import { useScope } from "@/context/ScopeContext";
import {
  Users,
  UserPlus,
  Shield,
  Mail,
  Check,
  X,
  Crown,
  RefreshCw,
  Sparkles
} from "lucide-react";

export default function LineStudioTeam() {
  const scope = useScope();
  const activeWorkspace = scope?.shell?.activeWorkspace;

  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("DEVELOPER");
  const [inviting, setInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [error, setError] = useState("");

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/viewer");
      const data = await res.json();
      if (res.ok && data.user) {
        setMembers([
          {
            id: data.user.id,
            name: data.user.name || data.user.email?.split("@")[0] || "Owner Admin",
            email: data.user.email || "admin@zuri.ai",
            role: "OWNER",
            roleColor: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
            joinedDate: "ผู้ดูแลระบบปัจจุบัน",
            lastLogin: "ออนไลน์ขณะนี้"
          }
        ]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  const handleSendInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setInviting(true);
    setError("");
    try {
      const res = await fetch("/api/workspace-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail,
          role: inviteRole,
          workspaceId: activeWorkspace?.id
        })
      });

      // Add to local state
      const newMember = {
        id: `inv-${Date.now()}`,
        name: inviteEmail.split("@")[0],
        email: inviteEmail,
        role: inviteRole,
        roleColor: inviteRole === "ADMIN" ? "bg-purple-500/15 text-purple-600 border-purple-500/30" : "bg-blue-500/15 text-blue-600 border-blue-500/30",
        joinedDate: "ส่งคำเชิญแล้ว",
        lastLogin: "รอยืนยัน"
      };

      setMembers([...members, newMember]);
      setInviteSuccess(true);
      setTimeout(() => {
        setInviteSuccess(false);
        setShowInviteModal(false);
        setInviteEmail("");
      }, 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="space-y-6 pb-12 font-thai">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <Users className="w-6 h-6 text-brand-amber" />
            <span>Team & Permissions ({members.length} สมาชิก)</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            จัดการสิทธิ์การเข้าถึงและทีมนักพัฒนาของ LINE Studio Enterprise
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchMembers}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 text-slate-600 transition-colors"
            title="รีเฟรชข้อมูล"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => setShowInviteModal(true)}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-amber to-brand-hover hover:opacity-90 text-white text-xs font-semibold transition-all shadow-md shadow-brand-amber/20 flex items-center justify-center gap-2"
          >
            <UserPlus className="w-4 h-4" />
            <span>เชิญสมาชิกใหม่</span>
          </button>
        </div>
      </div>

      {/* Team Members List */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300">
          รายชื่อสมาชิกที่ได้รับสิทธิ์ใน Workspace นี้
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {members.map((member) => (
            <div
              key={member.id}
              className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/60 dark:hover:bg-slate-850/60 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-brand-amber/20 to-amber-500/30 text-brand-dark flex items-center justify-center font-bold text-sm">
                  {member.name.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-1.5">
                    <span>{member.name}</span>
                    {member.role === "OWNER" && <Crown className="w-3.5 h-3.5 text-amber-500" />}
                  </h4>
                  <p className="text-xs text-slate-400 flex items-center gap-1">
                    <Mail className="w-3 h-3" />
                    <span>{member.email}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs">
                <span className={`px-2.5 py-1 rounded-xl text-[10px] font-bold border ${member.roleColor}`}>
                  {member.role}
                </span>
                <span className="text-slate-400 text-[11px]">{member.lastLogin}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-brand-amber" />
                <span>เชิญสมาชิกเข้าสู่ LINE Studio</span>
              </h3>
              <button
                onClick={() => setShowInviteModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-rose-50 text-rose-700 text-xs border border-rose-200">
                {error}
              </div>
            )}

            <form onSubmit={handleSendInvite} className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">อีเมลผู้รับเชิญ</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="developer@company.com"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-2.5 text-xs focus:ring-2 focus:ring-brand-amber/30 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">บทบาทและสิทธิ์ (Role)</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-2.5 text-xs"
                >
                  <option value="DEVELOPER">DEVELOPER (ออกแบบ Flow, Flex, Rich Menu)</option>
                  <option value="OPERATOR">OPERATOR (ดูแลแชทสด Live CRM & ตอบลูกค้า)</option>
                  <option value="ADMIN">ADMIN (จัดการสิทธิ์และกุญแจ Edge Device)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="px-4 py-2 rounded-xl bg-brand-amber hover:bg-brand-hover text-white text-xs font-semibold shadow-sm"
                >
                  {inviting ? "กำลังส่งคำเชิญ..." : inviteSuccess ? "ส่งคำเชิญสำเร็จ!" : "ส่งคำเชิญ"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
