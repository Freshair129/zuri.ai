import fs from 'node:fs';
import path from 'node:path';

// @req FR-189 — the local evidence ADR-075 Phase 5 is decided on: every shadow comparison, every
//   primary answer, every v4 fallback and every refused fallback, as bounded count-only records.
// @spec ADR-075 D8 Phase 4/5, ADR-075 owner question 3 (zero shadow mismatches across the Christmas
//   2026 and New Year 2027 windows before sunset)
// @tested tests/unit/genesisrag17-edge.test.ts
//
// A record holds ids, counts, a generation, latencies and flags. It never holds the customer's
// question, a passage's text, a product name or an error message — MSP's error text can echo
// anything, so only a fixed error *code* is kept.

export type RecordOperation = 'search' | 'search_constraints' | 'price';

export type GenesisRag17Record =
  | {
    kind: 'shadow'; at: string; operation: RecordOperation; outcome: 'compared';
    snapshotId: string; generation: string;
    v4Count: number; publishedCount: number; overlapCount: number;
    top1Match: boolean; v4Empty: boolean; publishedEmpty: boolean; v4Unavailable: boolean; mismatch: boolean;
    v4LatencyMs: number; publishedLatencyMs: number;
  }
  | { kind: 'shadow'; at: string; operation: RecordOperation; outcome: 'error'; errorCode: string; publishedLatencyMs: number }
  | { kind: 'primary'; at: string; operation: RecordOperation; snapshotId: string; generation: string; resultCount: number; latencyMs: number }
  | { kind: 'fallback'; at: string; operation: RecordOperation; reason: string; fallbackUntil: string }
  | { kind: 'primary_unavailable'; at: string; operation: RecordOperation; reason: string; fallbackUntil: string };

export interface RecordStore {
  /** Never throws: recording is evidence, and evidence must never change an answer. */
  append(record: GenesisRag17Record): boolean;
}

const FILE_RX = /^genesisrag17-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Days are Bangkok calendar days (fixed UTC+7, no DST) — the owner's campaign windows are local. */
export function bangkokDay(at: string | Date): string {
  const ms = (typeof at === 'string' ? Date.parse(at) : at.getTime()) + BANGKOK_OFFSET_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

function dayMinus(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
}

export function createRecordStore(options: {
  root: string; retentionDays: number; maxRecordsPerDay: number;
}): RecordStore {
  const counts = new Map<string, number>();
  const pruned = new Set<string>();

  const fileFor = (day: string) => path.join(options.root, `genesisrag17-${day}.jsonl`);
  const countFor = (day: string): number => {
    const known = counts.get(day);
    if (known !== undefined) return known;
    let lines = 0;
    try { lines = fs.readFileSync(fileFor(day), 'utf8').split('\n').filter(Boolean).length; } catch { lines = 0; }
    counts.set(day, lines);
    return lines;
  };
  const prune = (today: string) => {
    if (pruned.has(today)) return;
    pruned.add(today);
    const oldest = dayMinus(today, options.retentionDays);
    let entries: string[] = [];
    try { entries = fs.readdirSync(options.root); } catch { return; }
    for (const name of entries) {
      const match = FILE_RX.exec(name);
      if (match && match[1] < oldest) {
        try { fs.rmSync(path.join(options.root, name), { force: true }); } catch { /* best effort */ }
      }
    }
  };

  return {
    append(record) {
      try {
        const day = bangkokDay(record.at);
        fs.mkdirSync(options.root, { recursive: true });
        prune(day);
        const count = countFor(day);
        if (count >= options.maxRecordsPerDay) return false;
        fs.appendFileSync(fileFor(day), `${JSON.stringify(record)}\n`, 'utf8');
        counts.set(day, count + 1);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function readRecords(root: string, range: { since?: string; until?: string } = {}): GenesisRag17Record[] {
  let entries: string[] = [];
  try { entries = fs.readdirSync(root); } catch { return []; }
  const out: GenesisRag17Record[] = [];
  for (const name of entries.sort()) {
    const match = FILE_RX.exec(name);
    if (!match) continue;
    const day = match[1];
    if ((range.since && day < range.since) || (range.until && day > range.until)) continue;
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line) as GenesisRag17Record); } catch { /* a torn last line is not evidence */ }
    }
  }
  return out;
}

export interface DaySummary {
  day: string;
  compared: number;
  mismatches: number;
  shadowErrors: number;
  served: number;
  fallbacks: number;
  unavailable: number;
}

export interface GenesisRag17Report {
  records: number;
  firstDay: string | null;
  lastDay: string | null;
  shadow: { compared: number; mismatches: number; emptinessDisagreements: number; zeroOverlap: number; top1Agreements: number; errors: number };
  primary: { served: number; fallbacks: number; unavailable: number };
  generations: string[];
  byDay: DaySummary[];
}

/**
 * The Phase 5 exit evidence: how many comparisons, how many disagreed, and on which days. A shadow
 * error is counted apart from a mismatch — a comparison that never happened is not evidence of
 * agreement, and it is not evidence of disagreement either.
 */
export function summarizeRecords(records: GenesisRag17Record[]): GenesisRag17Report {
  const days = new Map<string, DaySummary>();
  const generations = new Set<string>();
  const report: GenesisRag17Report = {
    records: records.length, firstDay: null, lastDay: null,
    shadow: { compared: 0, mismatches: 0, emptinessDisagreements: 0, zeroOverlap: 0, top1Agreements: 0, errors: 0 },
    primary: { served: 0, fallbacks: 0, unavailable: 0 },
    generations: [], byDay: [],
  };
  for (const record of records) {
    const day = bangkokDay(record.at);
    let bucket = days.get(day);
    if (!bucket) { bucket = { day, compared: 0, mismatches: 0, shadowErrors: 0, served: 0, fallbacks: 0, unavailable: 0 }; days.set(day, bucket); }
    if (record.kind === 'shadow' && record.outcome === 'compared') {
      report.shadow.compared++; bucket.compared++;
      generations.add(record.generation);
      if (record.mismatch) { report.shadow.mismatches++; bucket.mismatches++; }
      if (record.v4Empty !== record.publishedEmpty) report.shadow.emptinessDisagreements++;
      if (!record.v4Empty && !record.publishedEmpty && record.overlapCount === 0) report.shadow.zeroOverlap++;
      if (record.top1Match) report.shadow.top1Agreements++;
    } else if (record.kind === 'shadow') {
      report.shadow.errors++; bucket.shadowErrors++;
    } else if (record.kind === 'primary') {
      report.primary.served++; bucket.served++;
      generations.add(record.generation);
    } else if (record.kind === 'fallback') {
      report.primary.fallbacks++; bucket.fallbacks++;
    } else if (record.kind === 'primary_unavailable') {
      report.primary.unavailable++; bucket.unavailable++;
    }
  }
  report.byDay = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  report.firstDay = report.byDay[0]?.day ?? null;
  report.lastDay = report.byDay[report.byDay.length - 1]?.day ?? null;
  report.generations = [...generations].sort();
  return report;
}
