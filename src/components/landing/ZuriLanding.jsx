'use client'

// @req FR-051 — the root entry communicates Zuri's product identity with one path to Login.
// @spec ADR-018, SDD-026 — code-native signal motion stays inert and preserves the entry boundary.
// @tested tests/unit/fr051-landing.test.js

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Network } from 'lucide-react'
import styles from './zuri-landing.module.css'

const NODES = [
  ['portfolio', 'PORTFOLIO'],
  ['tenant', 'TENANT'],
  ['business', 'BUSINESS'],
  ['workspace', 'WORKSPACE'],
  ['project', 'PROJECT'],
]

function SignalTopology({ active = false }) {
  return (
    <div className={active ? styles.activeTopology : styles.topology} aria-hidden="true">
      <span className={`${styles.route} ${styles.routeOne}`} />
      <span className={`${styles.route} ${styles.routeTwo}`} />
      <span className={`${styles.route} ${styles.routeThree}`} />
      <span className={`${styles.route} ${styles.routeFour}`} />
      {NODES.map(([key, label], index) => (
        <span key={key} className={`${styles.node} ${styles[`node${index + 1}`]}`}>
          <span className={styles.nodeDot} />
          <span className={styles.nodeLabel}>{label}</span>
        </span>
      ))}
    </div>
  )
}

function SignalField() {
  return (
    <div className={styles.signalStage} aria-hidden="true">
      <div className={styles.baseGrid} />
      <SignalTopology />
      <div className={styles.signalReveal}>
        <div className={styles.activeGrid} />
        <SignalTopology active />
      </div>
      <div className={styles.scanLabel}>OPERATIONAL SIGNAL / LIVE</div>
    </div>
  )
}

export default function ZuriLanding() {
  const landingRef = useRef(null)

  useEffect(() => {
    const root = landingRef.current
    if (!root) return undefined

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const finePointer = window.matchMedia('(pointer: fine)')
    if (reducedMotion.matches || !finePointer.matches) {
      root.dataset.signal = 'static'
      return undefined
    }

    const raw = { x: window.innerWidth * 0.76, y: window.innerHeight * 0.42 }
    const smooth = { ...raw }
    let frame

    const move = (event) => {
      raw.x = event.clientX
      raw.y = event.clientY
    }

    const draw = () => {
      smooth.x += (raw.x - smooth.x) * 0.1
      smooth.y += (raw.y - smooth.y) * 0.1
      root.style.setProperty('--signal-x', `${smooth.x}px`)
      root.style.setProperty('--signal-y', `${smooth.y}px`)
      root.style.setProperty('--drift-x', `${(smooth.x / window.innerWidth - 0.5) * 16}px`)
      root.style.setProperty('--drift-y', `${(smooth.y / window.innerHeight - 0.5) * 16}px`)
      frame = window.requestAnimationFrame(draw)
    }

    window.addEventListener('pointermove', move, { passive: true })
    frame = window.requestAnimationFrame(draw)

    return () => {
      window.removeEventListener('pointermove', move)
      window.cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div ref={landingRef} className={styles.landing} data-entry-landing>
      <SignalField />

      <header className={styles.header}>
        <div className={styles.wordmark} aria-label="Zuri">
          ZURI<span className={styles.brandSignal} aria-hidden="true" />
        </div>
        <div className={styles.headerMeta} aria-label="Zuri product characteristics">
          <span>BUSINESS OS</span>
          <span className={styles.metaDivider} aria-hidden="true" />
          <span>LOCAL / AI</span>
        </div>
      </header>

      <main className={styles.hero}>
        <section className={styles.heroCopy} aria-labelledby="zuri-hero-title">
          <div className={`${styles.corner} ${styles.cornerTop}`} aria-hidden="true" />
          <p className={styles.kicker}>AI-NATIVE BUSINESS OPERATING SYSTEM</p>
          <h1 id="zuri-hero-title" className={styles.headline}>
            <span>SEE THE</span>
            <span>WHOLE BUSINESS.</span>
            <span className={styles.lastLine}>
              MOVE WITH <strong>CLARITY.</strong>
              <span className={styles.dataMark} aria-hidden="true" />
            </span>
          </h1>
          <p className={styles.support}>รวมธุรกิจ งาน ทีม และหลักฐานการตัดสินใจไว้ในพื้นที่เดียว</p>
          <div className={`${styles.corner} ${styles.cornerBottom}`} aria-hidden="true" />
          <Link href="/login" className={styles.cta} aria-label="Sign in">
            <span>เข้าสู่ Zuri</span>
            <ArrowUpRight size={18} strokeWidth={1.6} aria-hidden="true" />
          </Link>
        </section>

        <aside className={styles.principles} aria-label="Zuri operating principles">
          <span className={styles.frameCornerTop} aria-hidden="true" />
          <Network size={32} strokeWidth={1.25} aria-hidden="true" />
          <p>
            LOCAL-FIRST.<br />
            AI-READY.<br />
            HUMAN-CONTROLLED.
          </p>
          <span className={styles.frameCornerBottom} aria-hidden="true" />
        </aside>
      </main>

      <footer className={styles.footer}>
        <span>ZURI / 2026</span>
        <span className={styles.scopeFlow}>PORTFOLIO → BUSINESS → WORKSPACE → PROJECT</span>
        <span>BUSINESS, IN CLEAR MOTION.</span>
      </footer>
    </div>
  )
}
