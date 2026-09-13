'use client'

// @req FR-105 — presentation only: a card that tilts a few degrees toward the
// pointer and carries a radial glow that follows it (owner request 2026-09-13,
// matching the html board). Pure hover chrome; it renders the same children and
// adds nothing to the plan data.
// @spec NFR-008 — off under prefers-reduced-motion and for coarse pointers; the
// glow overlay is pointer-events: none so nothing underneath loses a click.
// @tested tests/unit/platform-control-route-contract.test.js

import { useRef } from 'react'
import styles from './program-roadmap-board.module.css'

const TILT_MAX = 4 // degrees

function tiltAllowed() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  if (window.matchMedia('(hover: none)').matches) return false
  return true
}

export default function TiltCard({ as: Tag = 'div', className = '', maxHeight = 420, children, ...rest }) {
  const ref = useRef(null)

  const onPointerMove = (event) => {
    const node = ref.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    const px = (event.clientX - rect.left) / rect.width
    const py = (event.clientY - rect.top) / rect.height
    node.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`)
    node.style.setProperty('--my', `${(py * 100).toFixed(1)}%`)
    if (!tiltAllowed() || rect.height > maxHeight) return
    const rx = ((0.5 - py) * TILT_MAX * 2).toFixed(2)
    const ry = ((px - 0.5) * TILT_MAX * 2).toFixed(2)
    node.classList.add(styles.tilting)
    node.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-2px)`
  }

  const onPointerLeave = () => {
    const node = ref.current
    if (!node) return
    node.classList.remove(styles.tilting)
    node.style.transform = ''
  }

  return (
    <Tag ref={ref} className={`${styles.tilt} ${className}`} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} {...rest}>
      {children}
    </Tag>
  )
}
