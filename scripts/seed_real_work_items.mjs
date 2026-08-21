import { PrismaClient as PostgresPrismaClient } from '@zuri/prisma-postgres'
import { randomUUID } from 'crypto'

const url = 'postgresql://postgres.qcnmhyglarzcpudjorzc:Suanranger1295@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres'
const prisma = new PostgresPrismaClient({ datasources: { db: { url } } })

const TENANT_ID = '77cdbe70-3111-4a04-922a-8059be99a8b0'
const PORTFOLIO_ID = '5c621811-7e7a-42dd-ac39-ea9e8416ba98'

async function main() {
  console.log('=== [1. สร้าง Workspaces สำหรับแต่ละ Business] ===')
  
  // 1. SmartGift Workspace & Project
  const wsSmartGift = await prisma.workspace.upsert({
    where: { code: 'WS-SMARTGIFT' },
    update: {},
    create: {
      id: randomUUID(),
      code: 'WS-SMARTGIFT',
      name: 'SmartGift Workspace',
      scopeType: 'BUSINESS',
      tenantId: TENANT_ID,
      portfolioId: PORTFOLIO_ID,
      businessId: '834fa869-62f3-431c-a287-e9a95e91175b',
    }
  })

  const prjSmartGift = await prisma.project.upsert({
    where: { code: 'PRJ-SMARTGIFT-CORE' },
    update: {},
    create: {
      id: randomUUID(),
      code: 'PRJ-SMARTGIFT-CORE',
      name: 'SmartGift B2B Operating Core',
      description: 'ระบบจัดการสินค้าพรีเมียม แคตตาล็อก RAG และระบบเสนอราคา B2B SmartGift',
      status: 'ACTIVE',
      targetAt: new Date('2026-12-31'),
      workspaceId: wsSmartGift.id,
      businessId: '834fa869-62f3-431c-a287-e9a95e91175b',
    }
  })

  // Workstreams for SmartGift
  const wsRAG = await prisma.workstream.upsert({
    where: { code: 'STR-RAG-CATALOG' },
    update: {},
    create: {
      id: randomUUID(),
      code: 'STR-RAG-CATALOG',
      name: 'SmartGift Catalog & RAG Engine',
      executionMode: 'SOFTWARE_SPRINT',
      progressStrategy: 'WEIGHTED_ITEMS',
      progressWeight: 40,
      projectId: prjSmartGift.id,
    }
  })

  const wsLINE = await prisma.workstream.upsert({
    where: { code: 'STR-LINE-OA' },
    update: {},
    create: {
      id: randomUUID(),
      code: 'STR-LINE-OA',
      name: 'LINE Official Account Integration',
      executionMode: 'B2B_SALES',
      progressStrategy: 'WEIGHTED_ITEMS',
      progressWeight: 35,
      projectId: prjSmartGift.id,
    }
  })

  const wsCloud = await prisma.workstream.upsert({
    where: { code: 'STR-CLOUD-CONSOLE' },
    update: {},
    create: {
      id: randomUUID(),
      code: 'STR-CLOUD-CONSOLE',
      name: 'Zuri Cloud Console & Auth Core',
      executionMode: 'OPERATIONS',
      progressStrategy: 'WEIGHTED_ITEMS',
      progressWeight: 25,
      projectId: prjSmartGift.id,
    }
  })

  console.log('=== [2. สร้าง Work Containers (Sprints / Epics)] ===')
  const cRAG = await prisma.workContainer.upsert({
    where: { code: 'CNT-RAG-01' },
    update: {},
    create: {
      id: randomUUID(),
      code: 'CNT-RAG-01',
      title: 'RAG Knowledge Substrate & Graph Storage',
      subtype: 'SPRINT',
      status: 'ACTIVE',
      workstreamId: wsRAG.id,
    }
  })

  const cLINE = await prisma.workContainer.upsert({
    where: { code: 'CNT-LINE-01' },
    update: {},
    create: {
      id: randomUUID(),
      code: 'CNT-LINE-01',
      title: 'LINE Webhook & Grounded Answering',
      subtype: 'PHASE',
      status: 'ACTIVE',
      workstreamId: wsLINE.id,
    }
  })

  const cCloud = await prisma.workContainer.upsert({
    where: { code: 'CNT-CLOUD-01' },
    update: {},
    create: {
      id: randomUUID(),
      code: 'CNT-CLOUD-01',
      title: 'Cloud Authentication & Business Routing',
      subtype: 'PHASE',
      status: 'ACTIVE',
      workstreamId: wsCloud.id,
    }
  })

  console.log('=== [3. สร้าง Work Items จริงที่เสร็จแล้วและกำลังทำ] ===')
  const items = [
    // RAG Workstream (Done items)
    {
      code: 'WRK-RAG-001',
      title: 'สร้างโครงสร้าง SmartGift Catalog & Policy Substrate',
      status: 'DONE',
      subtype: 'STORY',
      weight: 10,
      workstreamId: wsRAG.id,
      containerId: cRAG.id,
    },
    {
      code: 'WRK-RAG-002',
      title: 'GenesisBlockDB Hybrid Vector + Knowledge Graph Pipeline',
      status: 'DONE',
      subtype: 'STORY',
      weight: 15,
      workstreamId: wsRAG.id,
      containerId: cRAG.id,
    },
    {
      code: 'WRK-RAG-003',
      title: 'Grounded Business Answering & Price Hallucination Guard',
      status: 'DONE',
      subtype: 'TASK',
      weight: 10,
      workstreamId: wsRAG.id,
      containerId: cRAG.id,
    },
    // Cloud Console (Done items)
    {
      code: 'WRK-CLOUD-001',
      title: 'Production Vercel Deployment & Supabase Postgres Pooler',
      status: 'DONE',
      subtype: 'TASK',
      weight: 10,
      workstreamId: wsCloud.id,
      containerId: cCloud.id,
    },
    {
      code: 'WRK-CLOUD-002',
      title: 'ลบ Mock/Demo Data และเชื่อมต่อ EtohGroup Single Real Tenant',
      status: 'DONE',
      subtype: 'STORY',
      weight: 10,
      workstreamId: wsCloud.id,
      containerId: cCloud.id,
    },
    {
      code: 'WRK-CLOUD-003',
      title: 'Business Routing Multi-Tenant Entry View',
      status: 'DONE',
      subtype: 'STORY',
      weight: 5,
      workstreamId: wsCloud.id,
      containerId: cCloud.id,
    },
    // LINE Integration (In Progress / Ready)
    {
      code: 'WRK-LINE-001',
      title: 'LINE Webhook Signature Verification & Event Ingestion (FR-081)',
      status: 'DONE',
      subtype: 'TASK',
      weight: 10,
      workstreamId: wsLINE.id,
      containerId: cLINE.id,
    },
    {
      code: 'WRK-LINE-002',
      title: 'เชื่อมต่อ zuri-edge-llm Runtime กับ Live LINE Official Account',
      status: 'IN_PROGRESS',
      subtype: 'STORY',
      weight: 20,
      workstreamId: wsLINE.id,
      containerId: cLINE.id,
    },
  ]

  for (const item of items) {
    await prisma.workItem.upsert({
      where: { code: item.code },
      update: { status: item.status },
      create: {
        id: randomUUID(),
        code: item.code,
        title: item.title,
        status: item.status,
        subtype: item.subtype,
        weight: item.weight,
        workstreamId: item.workstreamId,
        containerId: item.containerId,
      }
    })
  }

  console.log('✅ บันทึก Projects, Workstreams, Containers, และ Work Items เข้าสู่ Supabase เรียบร้อยแล้ว!');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); })
