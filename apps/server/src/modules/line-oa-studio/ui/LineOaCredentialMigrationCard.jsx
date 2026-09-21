// @req FR-225 — the mount-to-vault migration card (design §4.9 step 4): an
//   account whose credential still lives in the deployment mount shows
//   "ย้ายข้อมูลรับรองเข้า Vault" and re-enters Channel ID + secret through the
//   same rotate route the wizard's credential-rotation card uses; an
//   already-migrated account shows the truthful credential status line instead
//   (metadata only — SEC-030, no material ever rendered).
// @spec ADR-089 D2, D5, §4.9; design §5.3 "Migrate" / "Credential status" rows
// @tested tests/unit/line-oa-connect-wizard-render.test.js
"use client";

import React, { useState } from "react";
import { ShieldCheck, ArrowUpFromLine } from "lucide-react";
import { describeLineOaConnectError } from "@/modules/line-oa-studio/domain/line-oa-connect-wizard-copy";
import { SECRET_INPUT_PROPS, identifierInputProps } from "./credential-input-props";

const fieldClass = "w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 text-[11px] focus:ring-2 focus:ring-brand-amber/30 focus:outline-none";

const STORE_LABEL = Object.freeze({
  SUPABASE_VAULT: "Vault",
  ENVELOPE: "ที่เก็บเข้ารหัสของเซิร์ฟเวอร์",
  DEPLOYMENT_MOUNT: "ไฟล์ของผู้ดูแลระบบ",
});

function formatTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("th-TH");
  } catch {
    return "—";
  }
}

export default function LineOaCredentialMigrationCard({ account, onMigrated }) {
  const connection = account?.health?.connection;
  const [open, setOpen] = useState(false);
  const [channelId, setChannelId] = useState("");
  const [channelSecret, setChannelSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!connection?.secretStore) return null;

  if (connection.secretStore !== "DEPLOYMENT_MOUNT") {
    return (
      <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
        ข้อมูลรับรอง: ใช้งานได้ · เวอร์ชัน {connection.credentialVersion ?? "—"} · ตรวจสอบล่าสุด {formatTime(connection.lastValidatedAt)} · เก็บใน {STORE_LABEL[connection.secretStore] ?? connection.secretStore}
      </p>
    );
  }

  async function migrate(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const body = { channelId: channelId.trim(), channelSecret: channelSecret.trim() };
    setChannelSecret(""); // FR-225: never held past the request that carries it
    try {
      const response = await fetch(`/api/line-oa/connections/${account.integrationConnectionId}/credential`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(describeLineOaConnectError(json.error, { details: json.details, retryAfterSeconds: json.retryAfterSeconds }));
        return;
      }
      setChannelId("");
      setOpen(false);
      onMigrated?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-semibold">
          <ArrowUpFromLine className="w-3.5 h-3.5" /> ข้อมูลรับรองเก็บอยู่ที่ไฟล์ของผู้ดูแลระบบ
        </span>
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-[10px] font-bold underline">
          {open ? "ยกเลิก" : "ย้ายข้อมูลรับรองเข้า Vault"}
        </button>
      </div>
      {open && (
        <form onSubmit={migrate} className="space-y-2">
          <input {...identifierInputProps("line-channel-id")} value={channelId} onChange={(e) => setChannelId(e.target.value)} className={fieldClass} placeholder="Channel ID" pattern="[0-9]{6,20}" required disabled={busy} />
          <input {...SECRET_INPUT_PROPS} name="line-channel-secret" value={channelSecret} onChange={(e) => setChannelSecret(e.target.value)} className={fieldClass} placeholder="Channel secret" pattern="[0-9a-f]{32}" required disabled={busy} />
          {error && <p className="text-rose-600">{error.message}</p>}
          <button type="submit" disabled={busy} className="w-full py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold disabled:opacity-50">
            {busy ? "กำลังย้าย…" : "ยืนยันและย้ายเข้า Vault"}
          </button>
        </form>
      )}
    </div>
  );
}
