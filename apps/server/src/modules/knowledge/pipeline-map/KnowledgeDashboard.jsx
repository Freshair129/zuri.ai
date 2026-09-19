'use client'

// @req FR-214 — the Knowledge (GKS) slot's Dashboard: what the slot holds today
//   (the Data Pipeline Map, with its summary figures) and what is planned for it.
// @spec ADR-085 D1
// @tested tests/unit/knowledge-data-pipeline-map-ui.test.js
// @req FR-254 — link to the authorized knowledge console from its domain dashboard.
// @tested tests/e2e/fr254-knowledge-console.spec.js

import Link from 'next/link'
import { UploadCloud, Search, FileText } from 'lucide-react'
import { Card, Kpi, PageHeader, SectionTitle } from '@/components/ui'

export default function KnowledgeDashboard({ map }) {
  const s = map.summary
  return (
    <div className="space-y-5" data-testid="knowledge-dashboard">
      <PageHeader
        eyebrow="KNOWLEDGE (GKS)"
        title="Knowledge"
        subtitle="เลนความรู้ของ zuri-ai — ใช้ Genesis Knowledge System เป็น authority ผ่าน MSP ไม่ได้เป็น GKS เอง (ADR-063, ADR-085)"
      />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="สรุป data pipeline">
        <Kpi label="Chains" value={s.chains} meta={`production ${s.chainsByStatus.PRODUCTION} · code+tests ${s.chainsByStatus.CODE_TESTS} · ประกาศไว้ ${s.chainsByStatus.DECLARED}`} />
        <Kpi label="ต้นทาง" value={s.byKind.SOURCE} meta="ระบบและคนภายนอกที่ส่งข้อมูลเข้า" />
        <Kpi label="จุดรับเข้า" value={s.byKind.ENTRY} meta="endpoint · UI · MCP · worker" />
        <Kpi label="ผู้รับ" value={s.byKind.RECIPIENT} meta="ระบบและคนที่รับข้อมูลจากเรา" />
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle caption="ข้อมูลเข้าจากไหน รวมที่ไหน ส่งให้ใคร — พร้อมโดเมน FEAT และระดับ surface ทุก hop">Data Pipeline Map</SectionTitle>
          <Link href="/knowledge/data-pipeline" className="btn btn-primary inline-flex">เปิดแผนที่</Link>
        </Card>
        <Card warm>
          <SectionTitle caption="ต้นทางและประวัติรุ่น งานประมวลผล รุ่นที่เผยแพร่ และการค้นพร้อมหลักฐาน">Knowledge base console</SectionTitle>
          <div className="flex flex-wrap gap-2 mt-2">
            <Link href="/knowledge/console" className="btn btn-primary inline-flex">เปิดคลังความรู้</Link>
            <Link href="/knowledge/documents" className="btn inline-flex items-center gap-1.5 text-xs">
              <UploadCloud size={13} /> อัพโหลดเอกสาร
            </Link>
          </div>
          <div className="mt-4">
            <SectionTitle caption="ต้นทางและประวัติรุ่น งานประมวลผล รุ่นที่เผยแพร่ และการค้นพร้อมหลักฐาน">Knowledge base console</SectionTitle>
            <Link href="/knowledge/console" className="btn btn-primary inline-flex">เปิดคลังความรู้</Link>
          </div>
        </Card>
      </div>
    </div>
  )
}
