'use client'

// @req FR-213 — 3D WebGL Stage Matrix for Data Pipeline Map
// @spec ADR-010, ADR-085 — 360-degree 3D Orbit Canvas showing 5 pipeline stages with animated particle flows

import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { ZoomIn, ZoomOut, RotateCcw, Play, Pause, Maximize2 } from 'lucide-react'
import { COLUMNS, COLUMN_LABELS } from './pipeline-map-layout'

const STAGE_X = {
  SOURCE: -360,
  ENTRY: -180,
  PROCESS: 0,
  STORE: 180,
  RECIPIENT: 360,
}

const STATUS_COLOR_HEX = {
  PRODUCTION: 0x10b981,
  CODE_TESTS: 0x38bdf8,
  PARTIAL: 0xf59e0b,
  DECLARED: 0x64748b,
  BLOCKED: 0xef4444,
  EXTERNAL: 0x475569,
}

// Create a high-res text sprite for 3D node labels
function createTextSprite(text, meta, isSelected) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // Card background
  ctx.fillStyle = isSelected ? 'rgba(232, 130, 12, 0.92)' : 'rgba(19, 29, 42, 0.88)'
  ctx.strokeStyle = isSelected ? '#FFFFFF' : 'rgba(56, 189, 248, 0.4)'
  ctx.lineWidth = 4

  const x = 16, y = 16, w = 480, h = 96, r = 20
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Label text
  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 32px "IBM Plex Sans Thai", "Manrope", sans-serif'
  ctx.textAlign = 'left'
  const truncatedText = text.length > 24 ? `${text.slice(0, 23)}…` : text
  ctx.fillText(truncatedText, 40, 58)

  // Meta text
  ctx.fillStyle = isSelected ? '#FEF3C7' : '#94A3B8'
  ctx.font = '500 22px "IBM Plex Sans Thai", "Manrope", sans-serif'
  const truncatedMeta = meta.length > 30 ? `${meta.slice(0, 29)}…` : meta
  ctx.fillText(truncatedMeta, 40, 92)

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(70, 18, 1)
  return sprite
}

export default function DataPipelineMap3D({
  map,
  selectedId = null,
  onSelectNode = () => {},
  className = '',
}) {
  const mountRef = useRef(null)
  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const rendererRef = useRef(null)
  const animationFrameRef = useRef(null)
  const nodeMeshesRef = useRef(new Map())
  const particlesRef = useRef([])

  const [isRotating, setIsRotating] = useState(true)
  const [zoomLevel, setZoomLevel] = useState(100)

  // Drag orbit camera state
  const isDraggingRef = useRef(false)
  const previousMousePositionRef = useRef({ x: 0, y: 0 })
  const sphericalRef = useRef({ radius: 780, theta: 0.15, phi: Math.PI / 2.3 })

  const updateCameraPosition = useCallback(() => {
    if (!cameraRef.current) return
    const { radius, theta, phi } = sphericalRef.current
    const target = new THREE.Vector3(0, 0, 0)
    cameraRef.current.position.x = radius * Math.sin(phi) * Math.sin(theta)
    cameraRef.current.position.y = radius * Math.cos(phi)
    cameraRef.current.position.z = radius * Math.sin(phi) * Math.cos(theta)
    cameraRef.current.lookAt(target)
  }, [])

  useEffect(() => {
    const container = mountRef.current
    if (!container) return

    const width = container.clientWidth || 800
    const height = container.clientHeight || 560

    // 1. Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0b111a)
    scene.fog = new THREE.FogExp2(0x0b111a, 0.00075)
    sceneRef.current = scene

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 1, 3000)
    cameraRef.current = camera
    updateCameraPosition()

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = false
    container.innerHTML = ''
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // 4. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2)
    scene.add(ambientLight)
    const dirLight1 = new THREE.DirectionalLight(0xe8820c, 1.5)
    dirLight1.position.set(400, 500, 300)
    scene.add(dirLight1)
    const dirLight2 = new THREE.DirectionalLight(0x38bdf8, 1.0)
    dirLight2.position.set(-400, -300, -300)
    scene.add(dirLight2)

    // 5. Grid Helper floor
    const grid = new THREE.GridHelper(1200, 30, 0x1e293b, 0x131d2a)
    grid.position.y = -220
    scene.add(grid)

    // 6. Build 3D Stage Columns and Nodes
    const byKind = new Map(COLUMNS.map((k) => [k, []]))
    map.nodes.forEach((n) => byKind.get(n.kind)?.push(n))

    const nodePositions = new Map()
    const nodeMeshes = new Map()

    COLUMNS.forEach((kind) => {
      const x = STAGE_X[kind]
      const nodes = byKind.get(kind) || []
      const count = nodes.length
      const rowGap = 28
      const startY = ((count - 1) * rowGap) / 2

      nodes.forEach((node, idx) => {
        const y = startY - idx * rowGap
        const z = 0
        nodePositions.set(node.id, new THREE.Vector3(x, y, z))

        // Node 3D Box Mesh
        const isInternal = node.kind !== 'SOURCE' && node.kind !== 'RECIPIENT'
        const status = isInternal ? node.buildStatus : 'EXTERNAL'
        const hexColor = STATUS_COLOR_HEX[status] || 0x475569

        const geom = new THREE.BoxGeometry(22, 10, 8)
        const mat = new THREE.MeshStandardMaterial({
          color: hexColor,
          metalness: 0.2,
          roughness: 0.3,
          emissive: hexColor,
          emissiveIntensity: selectedId === node.id ? 0.6 : 0.2,
        })
        const mesh = new THREE.Mesh(geom, mat)
        mesh.position.set(x, y, z)
        mesh.userData = { id: node.id, node }
        scene.add(mesh)
        nodeMeshes.set(node.id, mesh)

        // Label sprite beside mesh
        const meta = isInternal
          ? `${node.buildStatus} · ${node.surfaceLevel || 'none'}`
          : 'ภายนอก'
        const sprite = createTextSprite(node.label, meta, selectedId === node.id)
        sprite.position.set(x + 46, y, z + 6)
        scene.add(sprite)
      })
    })

    nodeMeshesRef.current = nodeMeshes

    // 7. 3D Flow Splines and Particle Packets
    const particles = []
    const particleGeom = new THREE.SphereGeometry(2.5, 12, 12)

    map.edges.forEach((edge) => {
      const posA = nodePositions.get(edge.from)
      const posB = nodePositions.get(edge.to)
      if (!posA || !posB) return

      // Curve between A and B
      const midX = (posA.x + posB.x) / 2
      const midY = (posA.y + posB.y) / 2 + 15
      const midZ = (posA.z + posB.z) / 2 + 25
      const curve = new THREE.QuadraticBezierCurve3(posA, new THREE.Vector3(midX, midY, midZ), posB)

      // Spline line
      const points = curve.getPoints(24)
      const lineGeom = new THREE.BufferGeometry().setFromPoints(points)
      const hexColor = STATUS_COLOR_HEX[edge.status] || 0x38bdf8
      const lineMat = new THREE.LineBasicMaterial({
        color: hexColor,
        transparent: true,
        opacity: 0.35,
      })
      const spline = new THREE.Line(lineGeom, lineMat)
      scene.add(spline)

      // Particle Packet
      const particleMat = new THREE.MeshBasicMaterial({
        color: edge.wired ? hexColor : 0x94a3b8,
      })
      const particleMesh = new THREE.Mesh(particleGeom, particleMat)
      scene.add(particleMesh)
      particles.push({
        mesh: particleMesh,
        curve,
        progress: Math.random(),
        speed: 0.0035 + Math.random() * 0.002,
      })
    })

    particlesRef.current = particles

    // 8. Animation Loop
    let animId
    const animate = () => {
      animId = requestAnimationFrame(animate)

      // Auto rotation when idle
      if (isRotating && !isDraggingRef.current) {
        sphericalRef.current.theta += 0.0012
        updateCameraPosition()
      }

      // Move particle packets along splines
      particlesRef.current.forEach((p) => {
        p.progress = (p.progress + p.speed) % 1
        const point = p.curve.getPointAt(p.progress)
        p.mesh.position.copy(point)
      })

      renderer.render(scene, camera)
    }
    animate()
    animationFrameRef.current = animId

    // 9. Resize handler
    const handleResize = () => {
      if (!container || !renderer || !camera) return
      const w = container.clientWidth
      const h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(animId)
      renderer.dispose()
      if (container) container.innerHTML = ''
    }
  }, [map, selectedId, isRotating, updateCameraPosition])

  // Mouse drag to orbit
  const handleMouseDown = (e) => {
    isDraggingRef.current = true
    previousMousePositionRef.current = { x: e.clientX, y: e.clientY }
  }

  const handleMouseMove = (e) => {
    if (!isDraggingRef.current) return
    const deltaX = e.clientX - previousMousePositionRef.current.x
    const deltaY = e.clientY - previousMousePositionRef.current.y
    previousMousePositionRef.current = { x: e.clientX, y: e.clientY }

    sphericalRef.current.theta -= deltaX * 0.005
    sphericalRef.current.phi = Math.max(0.1, Math.min(Math.PI - 0.1, sphericalRef.current.phi - deltaY * 0.005))
    updateCameraPosition()
  }

  const handleMouseUp = () => {
    isDraggingRef.current = false
  }

  // Mouse wheel to zoom
  const handleWheel = (e) => {
    e.preventDefault()
    const zoomFactor = e.deltaY > 0 ? 1.08 : 0.92
    sphericalRef.current.radius = Math.max(300, Math.min(1800, sphericalRef.current.radius * zoomFactor))
    setZoomLevel(Math.round((780 / sphericalRef.current.radius) * 100))
    updateCameraPosition()
  }

  // Click raycasting to select node
  const handleClick = (e) => {
    if (!mountRef.current || !cameraRef.current || !sceneRef.current) return
    const rect = mountRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1

    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(x, y), cameraRef.current)

    const meshes = Array.from(nodeMeshesRef.current.values())
    const intersects = raycaster.intersectObjects(meshes)
    if (intersects.length > 0) {
      const hit = intersects[0].object
      if (hit.userData?.id) {
        onSelectNode(hit.userData.id)
      }
    }
  }

  const handleZoom = (delta) => {
    sphericalRef.current.radius = Math.max(300, Math.min(1800, sphericalRef.current.radius * delta))
    setZoomLevel(Math.round((780 / sphericalRef.current.radius) * 100))
    updateCameraPosition()
  }

  const handleReset = () => {
    sphericalRef.current = { radius: 780, theta: 0.15, phi: Math.PI / 2.3 }
    setZoomLevel(100)
    updateCameraPosition()
  }

  return (
    <div className={`relative w-full h-[72vh] min-h-[540px] rounded-xl overflow-hidden border border-[#1E293B] bg-[#0B111A] ${className}`}>
      <div
        ref={mountRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onClick={handleClick}
      />

      {/* Floating HUD Controls */}
      <div className="absolute bottom-4 right-4 flex items-center gap-1.5 p-1.5 rounded-lg bg-slate-900/80 backdrop-blur border border-slate-700/60 shadow-lg text-white text-xs z-10">
        <button
          type="button"
          onClick={() => handleZoom(0.85)}
          className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
          title="Zoom In"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => handleZoom(1.18)}
          className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
          title="Zoom Out"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <span className="px-2 font-mono text-[11px] text-slate-300">{zoomLevel}%</span>
        <button
          type="button"
          onClick={handleReset}
          className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-400 font-semibold"
          title="Reset View"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setIsRotating((prev) => !prev)}
          className={`p-1.5 rounded ${isRotating ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-300'}`}
          title={isRotating ? 'Pause Rotation' : 'Auto Rotate'}
        >
          {isRotating ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Stage Guide Badges */}
      <div className="absolute top-4 left-4 flex items-center gap-2 pointer-events-none">
        {COLUMNS.map((col) => (
          <span
            key={col}
            className="px-2.5 py-1 rounded-md bg-slate-900/80 backdrop-blur border border-slate-700/60 text-[11px] font-semibold text-slate-300"
          >
            {COLUMN_LABELS[col]}
          </span>
        ))}
      </div>
    </div>
  )
}
