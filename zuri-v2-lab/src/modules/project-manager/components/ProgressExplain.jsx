'use client'

import { useState } from 'react'
import { Info } from 'lucide-react'
import { Card, ProgressBar } from '@/components/ui'

/**
 * Displays a progress percentage with an expandable explanation of where the
 * number came from: strategy, formula, evidence values, and warnings.
 */
export default function ProgressExplain({ result, compact }) {
  const [open, setOpen] = useState(false)
  if (!result) return null
  const { percent, evidence = {}, warnings = [], progressStrategy } = result

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <ProgressBar percent={percent} label={`${evidence.strategy || progressStrategy || 'progress'} ${percent}%`} />
        </div>
        <span className="w-14 text-right text-sm font-bold">{percent}%</span>
        <button
          type="button"
          className="btn flex items-center gap-1 px-2 py-1 text-[10px]"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <Info size={11} aria-hidden /> {open ? 'Hide' : 'Explain'}
        </button>
      </div>
      {open && (
        <Card className="mt-2 bg-surface text-[11px]">
          <p className="font-bold">
            Strategy: <span className="font-mono">{evidence.strategy || progressStrategy}</span>
          </p>
          {evidence.formula && (
            <p className="mt-1 text-muted">
              Formula: <span className="font-mono">{evidence.formula}</span>
            </p>
          )}
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 max-md:grid-cols-1">
            {Object.entries(evidence)
              .filter(([k, v]) => !['strategy', 'formula'].includes(k) && (typeof v === 'number' || typeof v === 'string'))
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 border-b border-[var(--border)] py-0.5">
                  <dt className="text-muted">{k}</dt>
                  <dd className="font-semibold">{String(v)}</dd>
                </div>
              ))}
          </dl>
          {Array.isArray(evidence.kpis) && evidence.kpis.length > 0 && (
            <table className="mt-2 w-full text-[10px]">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1">KPI</th>
                  <th>Actual</th>
                  <th>Target</th>
                  <th>Weight</th>
                  <th>Attainment</th>
                </tr>
              </thead>
              <tbody>
                {evidence.kpis.map((k) => (
                  <tr key={k.key} className="border-t border-[var(--border)]">
                    <td className="py-1 font-semibold">{k.label}</td>
                    <td>{k.actual}</td>
                    <td>{k.target}</td>
                    <td>{k.weight}</td>
                    <td>{Math.round(k.attainment * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {Array.isArray(evidence.dimensions) && evidence.dimensions.length > 0 && (
            <div className="mt-2 space-y-1">
              {evidence.dimensions.map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <span className="w-24 text-[10px] font-semibold capitalize">{d.name}</span>
                  <div className="flex-1">
                    <ProgressBar percent={d.percent} tone="blue" label={`${d.name} ${d.percent}%`} />
                  </div>
                  <span className="w-10 text-right text-[10px]">{d.percent}%</span>
                </div>
              ))}
            </div>
          )}
          {warnings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {warnings.map((w, i) => (
                <li key={i} className="rounded-lg px-2 py-1 text-[10px]" style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}>
                  ⚠ {w}
                </li>
              ))}
            </ul>
          )}
          {!compact && result.calculatedAt && (
            <p className="mt-2 text-[9px] text-muted">Calculated {new Date(result.calculatedAt).toLocaleString()}</p>
          )}
        </Card>
      )}
    </div>
  )
}
