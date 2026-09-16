// @req FR-149 — a third of real customer conversations ended in silence: of
//   12 `LineConversationJob` rows this install has ever produced, 4 ended
//   FAILED and nothing on any screen said so. This card is the surface —
//   a truthful, red count of terminal FAILED jobs for the active Business,
//   read from the same database rows the worker already writes. It shows
//   "none" quietly when there truly are none; it never hides itself, because
//   silence is the exact bug this exists to fix.
// @spec ADR-061 — no invented telemetry: only what `/api/line-oa/jobs/failures`
//   reports, which is only what the database holds.
// @tested tests/unit/line-studio-job-failures.test.js
"use client";

import React, { useEffect, useState } from "react";
import { useScope } from "@/context/ScopeContext";

// Copied verbatim from LineStudioEdgeConnection.jsx — the module's one fetch
// convention, so this card fails the same way the rest of the Studio does.
async function api(url, method = "GET", body) {
  const response = await fetch(url, {
    method,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.issues?.join(" · ") || result.error || "Request failed");
  return result;
}

/** First 8 chars of a job id — enough to spot in a short table, never the full id. */
export function shortJobId(id) {
  return typeof id === "string" ? id.slice(0, 8) : "";
}

/** A null errorCode is a real, honest value — labelled for display, never invented as UNKNOWN. */
export function formatErrorCodeLabel(errorCode) {
  return errorCode || "ไม่ระบุรหัสข้อผิดพลาด";
}

/** Thai locale timestamp for the recent-failures table; empty string on a bad/missing value. */
export function formatJobTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("th-TH");
}

/** "N ข้อความไม่ได้รับการตอบกลับ" — the count sentence the red badge carries. */
export function formatFailureHeadline(total) {
  return `${total} ข้อความไม่ได้รับการตอบกลับ`;
}

/**
 * Pure presentational card: a function of {summary, loading, error} only — no
 * useScope, no state, no effect, no fetch. This is what proves the red count
 * and its errorCode breakdown actually render (renderToStaticMarkup never
 * runs an effect, so the fetching wrapper below cannot be exercised that way).
 */
export function LineStudioJobFailuresCard({ summary, loading = false, error = "" }) {
  if (loading && !summary) {
    return (
      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 text-xs text-slate-500 font-thai">
        กำลังตรวจสอบข้อความที่ส่งไม่สำเร็จ...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2 font-thai">
        <span>{error}</span>
      </div>
    );
  }

  if (!summary) return null;

  const { total, byErrorCode, failures } = summary;

  if (total === 0) {
    return (
      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 text-xs text-slate-500 font-thai">
        ยังไม่มีข้อความที่ส่งไม่สำเร็จสำหรับ Business นี้
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="p-5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 space-y-3 font-thai"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-sm text-rose-800 dark:text-rose-200">
          ข้อความที่ส่งไม่สำเร็จ
        </h3>
        <span
          role="status"
          className="px-2.5 py-1 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 text-xs font-bold font-mono"
        >
          {formatFailureHeadline(total)}
        </span>
      </div>

      {Array.isArray(byErrorCode) && byErrorCode.length > 0 && (
        <ul className="space-y-1 text-[11px] text-rose-700 dark:text-rose-300">
          {byErrorCode.map((row) => (
            <li key={String(row.errorCode)} className="flex justify-between gap-2">
              <span className="font-mono">{formatErrorCodeLabel(row.errorCode)}</span>
              <span className="font-bold">{row.count}</span>
            </li>
          ))}
        </ul>
      )}

      {Array.isArray(failures) && failures.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-900 p-3">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-rose-100 dark:border-rose-900 text-slate-500">
                <th className="p-1.5">เวลา</th>
                <th className="p-1.5">งาน</th>
                <th className="p-1.5">รหัสข้อผิดพลาด</th>
                <th className="p-1.5">การประมวลผล</th>
              </tr>
            </thead>
            <tbody>
              {failures.map((job) => (
                <tr key={job.id} className="border-b border-rose-50 dark:border-rose-950/40 font-mono text-[11px]">
                  <td className="p-1.5">{formatJobTime(job.updatedAt)}</td>
                  <td className="p-1.5">{shortJobId(job.id)}</td>
                  <td className="p-1.5 font-bold">{formatErrorCodeLabel(job.errorCode)}</td>
                  <td className="p-1.5">{job.executionMode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function LineStudioJobFailures() {
  const scope = useScope();
  const business = scope?.shell?.activeBusiness;

  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    if (!business?.id) {
      setSummary(null);
      setError("");
      return () => { ignore = true; };
    }
    setLoading(true);
    setError("");
    api(`/api/line-oa/jobs/failures?businessId=${encodeURIComponent(business.id)}`)
      .then((result) => {
        if (ignore) return;
        setSummary(result);
      })
      .catch((err) => {
        if (ignore) return;
        setError(err.message);
      })
      .finally(() => {
        if (ignore) return;
        setLoading(false);
      });
    return () => { ignore = true; };
  }, [business?.id]);

  if (!business?.id) return null;

  return <LineStudioJobFailuresCard summary={summary} loading={loading} error={error} />;
}
