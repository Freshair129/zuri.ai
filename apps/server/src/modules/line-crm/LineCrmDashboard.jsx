'use client'

import React, { useState } from 'react'
import {
  Users,
  UserPlus,
  MessageSquare,
  Coins,
  Send,
  Bot,
  ArrowUpRight,
  ChevronRight,
  Sparkles
} from 'lucide-react'
import { INITIAL_STATS, TIERS, TOP_ACTIVE_USERS, CHAT_CONVERSATIONS } from './mockData'

// @req FR-091 — LineCRM-MCP Dashboard Screen
// @spec SDD-050, ADR-060, ADR-061

export default function LineCrmDashboard({ onNavigate }) {
  const [timeRange, setTimeRange] = useState('7d')

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-purple-700 via-fuchsia-600 to-pink-600 p-6 text-white shadow-lg">
        <div className="relative z-10 space-y-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            แดชบอร์ด LineCRM-MCP
          </h1>
          <p className="text-sm text-purple-100">
            ศูนย์รวมข้อมูล CRM, LINE OA, Automation และ AI MCP แบบ All-in-One
          </p>
          <div className="pt-2 flex items-center gap-2 text-xs text-purple-200">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>อัปเดตล่าสุด: 11 ส.ค. 2569 14:26</span>
          </div>
        </div>
        <div className="absolute right-0 top-0 -mt-8 -mr-8 h-48 w-48 rounded-full bg-white/10 blur-2xl pointer-events-none" />
      </div>

      {/* Row 1: 6 Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {/* Card 1: Total Members */}
        <div className="rounded-xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">สมาชิกทั้งหมด</span>
            <Users className="h-4 w-4 text-purple-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white">
              {INITIAL_STATS.totalMembers.toLocaleString()}
            </span>
            <span className="inline-flex items-center text-[11px] font-bold text-emerald-600">
              <ArrowUpRight className="h-3 w-3" /> {INITIAL_STATS.membersGrowth}%
            </span>
          </div>
          <div className="mt-1 text-[10px] text-slate-400">จากสัปดาห์ที่แล้ว</div>
        </div>

        {/* Card 2: New Followers */}
        <div className="rounded-xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">ผู้ติดตามใหม่วันนี้</span>
            <UserPlus className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white">
              {INITIAL_STATS.newFollowersToday}
            </span>
            <span className="inline-flex items-center text-[11px] font-bold text-emerald-600">
              <ArrowUpRight className="h-3 w-3" /> {INITIAL_STATS.followersGrowth}%
            </span>
          </div>
          <div className="mt-1 text-[10px] text-slate-400">จากเมื่อวาน</div>
        </div>

        {/* Card 3: Messages Today */}
        <div className="rounded-xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">ข้อความวันนี้</span>
            <MessageSquare className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white">
              {INITIAL_STATS.messagesToday.toLocaleString()}
            </span>
            <span className="inline-flex items-center text-[11px] font-bold text-emerald-600">
              <ArrowUpRight className="h-3 w-3" /> {INITIAL_STATS.messagesGrowth}%
            </span>
          </div>
          <div className="mt-1 text-[10px] text-slate-400">จากเมื่อวาน</div>
        </div>

        {/* Card 4: Total Points */}
        <div className="rounded-xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">แต้มคงเหลือรวม</span>
            <Coins className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white">
              {INITIAL_STATS.totalPoints.toLocaleString()}
            </span>
            <span className="inline-flex items-center text-[11px] font-bold text-emerald-600">
              <ArrowUpRight className="h-3 w-3" /> {INITIAL_STATS.pointsGrowth}%
            </span>
          </div>
          <div className="mt-1 text-[10px] text-slate-400">จากสัปดาห์ที่แล้ว</div>
        </div>

        {/* Card 5: Active Campaigns */}
        <div className="rounded-xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">แคมเปญที่กำลังทำงาน</span>
            <Send className="h-4 w-4 text-rose-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white">
              {INITIAL_STATS.activeCampaigns}
            </span>
          </div>
          <div className="mt-1 text-[10px] text-slate-400">ดูแคมเปญทั้งหมด</div>
        </div>

        {/* Card 6: AI Tasks */}
        <div className="rounded-xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">AI Tasks</span>
            <Bot className="h-4 w-4 text-purple-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white">
              {INITIAL_STATS.aiTasksToday}
            </span>
          </div>
          <div className="mt-1 text-[10px] text-slate-400">รอดำเนินการ {INITIAL_STATS.aiTasksPending} งาน</div>
        </div>
      </div>

      {/* Row 2: 3 Analytics Columns */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Column 1: Campaign Performance (5 cols) */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm lg:col-span-4 dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">ประสิทธิภาพแคมเปญ</h3>
              <p className="text-xs text-slate-400">อัตราการส่ง เปิดอ่าน และคลิก</p>
            </div>
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              <option value="7d">7 วันที่ผ่านมา</option>
              <option value="30d">30 วันที่ผ่านมา</option>
            </select>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2 border-b border-slate-100 pb-3 text-center dark:border-slate-800">
            <div>
              <div className="text-[10px] text-slate-400">ส่งข้อความ</div>
              <div className="text-xs font-bold text-slate-800 dark:text-white">12,458</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">เปิดอ่าน</div>
              <div className="text-xs font-bold text-purple-600">7,842 <span className="text-[9px] text-emerald-600 font-normal">62.9%</span></div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">คลิก</div>
              <div className="text-xs font-bold text-pink-600">1,256 <span className="text-[9px] text-emerald-600 font-normal">10.1%</span></div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">คอนเวอร์ชัน</div>
              <div className="text-xs font-bold text-amber-600">325 <span className="text-[9px] text-emerald-600 font-normal">2.61%</span></div>
            </div>
          </div>

          {/* Line Curve Mockup SVG */}
          <div className="relative mt-4 h-48 w-full">
            <div className="flex items-center gap-4 text-[10px] font-semibold text-slate-500 mb-2">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-purple-600" /> เปิดอ่าน</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-pink-500" /> คลิก</span>
            </div>
            <svg className="h-36 w-full" viewBox="0 0 300 120" preserveAspectRatio="none">
              <defs>
                <linearGradient id="purpleGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#9333ea" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#9333ea" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="pinkGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ec4899" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#ec4899" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* Grid lines */}
              <line x1="0" y1="20" x2="300" y2="20" stroke="#f1f5f9" strokeDasharray="3 3" />
              <line x1="0" y1="60" x2="300" y2="60" stroke="#f1f5f9" strokeDasharray="3 3" />
              <line x1="0" y1="100" x2="300" y2="100" stroke="#f1f5f9" strokeDasharray="3 3" />

              {/* Area 1: Opened */}
              <path d="M 0 80 Q 40 75, 80 85 T 160 30 T 240 60 T 300 45 L 300 120 L 0 120 Z" fill="url(#purpleGrad)" />
              <path d="M 0 80 Q 40 75, 80 85 T 160 30 T 240 60 T 300 45" fill="none" stroke="#9333ea" strokeWidth="2.5" />

              {/* Area 2: Clicked */}
              <path d="M 0 105 Q 40 100, 80 102 T 160 85 T 240 92 T 300 88 L 300 120 L 0 120 Z" fill="url(#pinkGrad)" />
              <path d="M 0 105 Q 40 100, 80 102 T 160 85 T 240 92 T 300 88" fill="none" stroke="#ec4899" strokeWidth="2" />
            </svg>
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>30 ก.ค.</span>
              <span>31 ก.ค.</span>
              <span>1 ส.ค.</span>
              <span>2 ส.ค.</span>
              <span>3 ส.ค.</span>
              <span>4 ส.ค.</span>
              <span>5 ส.ค.</span>
            </div>
          </div>
        </div>

        {/* Column 2: Webhook Activity (4 cols) */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm lg:col-span-4 dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Webhook Activity (LINE OA)</h3>
              <p className="text-xs text-slate-400">สถานะการรับส่งข้อความ Real-time</p>
            </div>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              94.3% สำเร็จ
            </span>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2 border-b border-slate-100 pb-3 text-center dark:border-slate-800">
            <div>
              <div className="text-[10px] text-slate-400">ทั้งหมด</div>
              <div className="text-xs font-bold text-slate-800 dark:text-white">3,726</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">สำเร็จ</div>
              <div className="text-xs font-bold text-emerald-600">3,512</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">ล้มเหลว</div>
              <div className="text-xs font-bold text-rose-600">142 <span className="text-[9px] font-normal">3.8%</span></div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">Pending</div>
              <div className="text-xs font-bold text-amber-600">72 <span className="text-[9px] font-normal">1.9%</span></div>
            </div>
          </div>

          {/* Bar Chart Mockup */}
          <div className="mt-4 flex h-40 items-end justify-between gap-2 pt-4">
            {[
              { day: '30 ก.ค.', val: 68 },
              { day: '31 ก.ค.', val: 62 },
              { day: '1 ส.ค.', val: 66 },
              { day: '2 ส.ค.', val: 64 },
              { day: '3 ส.ค.', val: 88 },
              { day: '4 ส.ค.', val: 67 },
              { day: '5 ส.ค.', val: 92 },
            ].map((bar, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t-md bg-purple-500/80 transition-all hover:bg-purple-600"
                  style={{ height: `${bar.val}%` }}
                />
                <span className="text-[9px] text-slate-400">{bar.day}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Column 3: Recent Conversations (4 cols) */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm lg:col-span-4 dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">การสนทนาล่าสุด</h3>
              <p className="text-xs text-slate-400">ข้อความจากลูกค้า LINE OA</p>
            </div>
            <button
              onClick={() => onNavigate('chat')}
              className="text-xs font-semibold text-purple-600 hover:text-purple-700 dark:text-purple-400"
            >
              ไปที่แชทสด →
            </button>
          </div>

          <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {CHAT_CONVERSATIONS.slice(0, 5).map((chat) => (
              <div
                key={chat.id}
                onClick={() => onNavigate('chat')}
                className="flex cursor-pointer items-center justify-between py-2.5 hover:bg-slate-50/80 rounded-lg px-2 transition-colors dark:hover:bg-slate-800/50"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${chat.avatarBg}`}>
                    {chat.avatar}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-bold text-slate-800 dark:text-white">{chat.name}</span>
                      <span className="rounded bg-amber-100 px-1 py-0.2 text-[9px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        {chat.tier}
                      </span>
                    </div>
                    <p className="truncate text-[11px] text-slate-400">{chat.lastMessage}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] text-slate-400">{chat.time}</div>
                  {chat.unread > 0 && (
                    <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-purple-600 text-[9px] font-bold text-white">
                      {chat.unread}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 3: Tier Breakdown & Top Active Users */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Tier Breakdown (7 cols) */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm lg:col-span-7 dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">สรุปสมาชิกตามระดับ (Tier)</h3>
              <p className="text-xs text-slate-400">สัดส่วนสมาชิกระดับต่าง ๆ และแต้มเฉลี่ย</p>
            </div>
            <button
              onClick={() => onNavigate('members')}
              className="text-xs font-semibold text-purple-600 hover:text-purple-700 dark:text-purple-400"
            >
              ดูสมาชิกทั้งหมด →
            </button>
          </div>

          <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row">
            {/* Donut Chart Visual */}
            <div className="relative flex h-36 w-36 shrink-0 items-center justify-center">
              <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#f1f5f9" strokeWidth="3" />
                {/* Bronze 50.6% */}
                <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#CD7F32" strokeWidth="3.5" strokeDasharray="50.6 49.4" strokeDashoffset="0" />
                {/* Silver 31.2% */}
                <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#94A3B8" strokeWidth="3.5" strokeDasharray="31.2 68.8" strokeDashoffset="-50.6" />
                {/* Gold 13.3% */}
                <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#F59E0B" strokeWidth="3.5" strokeDasharray="13.3 86.7" strokeDashoffset="-81.8" />
                {/* Platinum 4.9% */}
                <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#0284C7" strokeWidth="3.5" strokeDasharray="4.9 95.1" strokeDashoffset="-95.1" />
              </svg>
              <div className="absolute text-center">
                <div className="text-base font-black text-slate-800 dark:text-white">2,458</div>
                <div className="text-[10px] text-slate-400">รวมทั้งหมด</div>
              </div>
            </div>

            {/* Tier Stats Grid */}
            <div className="grid flex-1 grid-cols-2 gap-3 w-full">
              {Object.entries(TIERS).map(([key, item]) => (
                <div key={key} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                      {item.name}
                    </span>
                    <span className="text-xs font-black text-slate-900 dark:text-white">{item.count.toLocaleString()} คน</span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {item.percentage}% · แต้มเฉลี่ย {item.avgPoints.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top Active Users Leaderboard (5 cols) */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm lg:col-span-5 dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">สมาชิกที่ใช้งานมากที่สุด</h3>
              <p className="text-xs text-slate-400">เรียงตามจำนวนข้อความและแต้มสะสม</p>
            </div>
            <span className="text-[10px] text-slate-400">7 วัน</span>
          </div>

          <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {TOP_ACTIVE_USERS.map((user, idx) => (
              <div key={user.id} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-black text-slate-400 w-3">{idx + 1}</span>
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white ${user.color}`}>
                    {user.avatar}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                      {user.name}
                      <span className="rounded bg-purple-100 px-1 text-[9px] font-semibold text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                        {user.tier}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right text-xs">
                  <span className="font-bold text-slate-700 dark:text-slate-200">{user.messages}</span>
                  <span className="text-slate-400 mx-1">·</span>
                  <span className="font-bold text-amber-600">{user.points.toLocaleString()}</span>
                  <span className="text-[10px] text-slate-400 ml-0.5">แต้ม</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
