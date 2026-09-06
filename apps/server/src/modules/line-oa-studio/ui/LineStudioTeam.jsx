// @req FR-146, FR-021, FR-061 — LINE Studio Enterprise Team & RBAC
// @spec SDD-060, SDD-061 — Member Access Control
"use client";

import React, { useState } from "react";
import { MOCK_TEAM_MEMBERS } from "./mockStudioData";
import {
  Users,
  UserPlus,
  Shield,
  Mail,
  Check,
  X,
  Crown
} from "lucide-react";

export default function LineStudioTeam() {
  const [members, setMembers] = useState(MOCK_TEAM_MEMBERS);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("DEVELOPER");
  const [inviteSuccess, setInviteSuccess] = useState(false);

  const handleSendInvite = (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    const newMember = {
      id: `tm-${Date.now()}`,
      name: inviteEmail.split("@")[0],
      email: inviteEmail,
      role: inviteRole,
      roleColor: inviteRole === "ADMIN" ? "bg-purple-500/15 text-purple-600 border-purple-500/30" : "bg-blue-500/15 text-blue-600 border-blue-500/30",
      joinedDate: "06 ก.ย. 2569",
      lastLogin: "ยังไม่เคย"
    };

    setMembers([...members, newMember]);
    setInviteSuccess(true);
    setTimeout(() => {
      setInviteSuccess(false);
      setShowInviteModal(false);
      setInviteEmail("");
    }, 1500);
  };

  return (
    <div className="space-y-6 pb-12 font-thai">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <Users className="w-6 h-6 text-brand-amber" />
            <span>Team ({members.length} สมาชิก)</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            จัดการสิทธิ์การเข้าถึงและทีมนักพัฒนาของ LINE Studio Enterprise
          </p>
        </div>

        <button
          onClick={() => setShowInviteModal(true)}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-90 text-white text-xs font-semibold transition-all shadow-md shadow-emerald-600/20 flex items-center gap-2"
        >
          <UserPlus className="w-4 h-4" />
          <span>+ เชิญสมาชิก</span>
        </button>
      </div>

      {/* Invite Box (matching screenshot 783126196...) */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 shadow-sm space-y-4">
        <h3 className="font-bold text-sm text-slate-900 dark:text-white">
          เชิญสมาชิกใหม่
        </h3>
        <form onSubmit={handleSendInvite} className="flex flex-col sm:flex-row items-center gap-3">
          <input
            type="email"
            required
            placeholder="อีเมลสมาชิก เช่น developer@brand.co.th"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="flex-1 w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-brand-amber/30"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="w-full sm:w-44 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-amber/30"
          >
            <option value="DEVELOPER">Developer</option>
            <option value="ADMIN">Admin</option>
            <option value="EDITOR">Editor</option>
            <option value="VIEWER">Viewer</option>
          </select>
          <button
            type="submit"
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-all shrink-0 shadow-sm"
          >
            {inviteSuccess ? "ส่งคำเชิญแล้ว!" : "ส่งคำเชิญ"}
          </button>
        </form>
      </div>

      {/* Members Table */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 text-slate-500 dark:text-slate-400 uppercase font-semibold">
              <th className="py-3 px-4">สมาชิก</th>
              <th className="py-3 px-4">Role</th>
              <th className="py-3 px-4">เข้าร่วมเมื่อ</th>
              <th className="py-3 px-4 text-right">Login ล่าสุด</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {members.map(m => (
              <tr key={m.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-850/60">
                <td className="py-3.5 px-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/15 text-emerald-600 font-bold flex items-center justify-center text-xs">
                      {m.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">{m.name}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{m.email}</div>
                    </div>
                  </div>
                </td>
                <td className="py-3.5 px-4">
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${m.roleColor}`}>
                    {m.role}
                  </span>
                </td>
                <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                  {m.joinedDate}
                </td>
                <td className="py-3.5 px-4 text-right text-slate-500">
                  {m.lastLogin}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
