// @req FR-024 — SmartGift Domain RAG Pipeline: business-scoped knowledge graph ingestion and agent turns.
// @spec ADR-007 §P5, SDD-027 — Dedicated multi-collection SmartGift knowledge substrate.
// @tested tests/unit/smartgift-rag-pipeline.test.js

import { assertNoLiveFacts } from './live-facts.js'
import {
  SMARTGIFT_CATEGORIES,
  SMARTGIFT_PRODUCTS,
  SMARTGIFT_POLICIES,
} from './smartgift-knowledge-catalog.js'

export const SMARTGIFT_COLLECTION = 'smartgift'

/**
 * Seeds SmartGift catalog, categories, and policies into GenesisBlockDB under the 'smartgift' collection.
 */
export async function seedSmartGiftKnowledge({ db, embeddingProvider, vectorDim = 4 }) {
  if (!db || typeof db.addNode !== 'function' || typeof db.addEdge !== 'function') {
    throw new Error('seedSmartGiftKnowledge requires a valid GenesisDatabase instance')
  }

  // Ensure collection exists
  if (typeof db.listCollections === 'function' && typeof db.createCollection === 'function') {
    try {
      const collections = await db.listCollections()
      if (!collections.includes(SMARTGIFT_COLLECTION)) {
        await db.createCollection(SMARTGIFT_COLLECTION, 'smartgift-embed', vectorDim, 'cosine')
      }
    } catch (e) {
      // If collection already exists or not supported, ignore
    }
  }

  // 1. Ingest Categories
  for (const cat of SMARTGIFT_CATEGORIES) {
    assertNoLiveFacts({ id: cat.id, type: cat.type, title: cat.title })
    let vector = null
    if (typeof embeddingProvider === 'function') {
      vector = await embeddingProvider(`${cat.title} ${cat.description}`)
    }
    await db.addNode({
      id: cat.id,
      labels: ['Category', 'SmartGift'],
      props: { title: cat.title, description: cat.description },
      embedding: vector || undefined,
      collection: SMARTGIFT_COLLECTION,
    })
  }

  // 2. Ingest Products
  for (const prod of SMARTGIFT_PRODUCTS) {
    assertNoLiveFacts({ id: prod.id, type: prod.type, title: prod.title, code: prod.code })
    let vector = null
    if (typeof embeddingProvider === 'function') {
      vector = await embeddingProvider(`${prod.title} ${prod.text} MOQ:${prod.moq}`)
    }
    await db.addNode({
      id: prod.id,
      labels: ['Product', 'SmartGift'],
      props: {
        title: prod.title,
        text: prod.text,
        code: prod.code,
        moq: prod.moq,
        leadTimeDays: prod.leadTimeDays,
        printingMethods: (prod.printingMethods || []).join(', '),
      },
      embedding: vector || undefined,
      collection: SMARTGIFT_COLLECTION,
    })

    // Link product to category
    if (prod.categoryId) {
      await db.addEdge({
        from: prod.id,
        to: prod.categoryId,
        rel: 'BELONGS_TO',
      })
    }
  }

  // 3. Ingest Policies
  for (const pol of SMARTGIFT_POLICIES) {
    assertNoLiveFacts({ id: pol.id, type: pol.type, title: pol.title })
    let vector = null
    if (typeof embeddingProvider === 'function') {
      vector = await embeddingProvider(`${pol.title} ${pol.text}`)
    }
    await db.addNode({
      id: pol.id,
      labels: ['Policy', 'SmartGift'],
      props: { title: pol.title, text: pol.text },
      embedding: vector || undefined,
      collection: SMARTGIFT_COLLECTION,
    })
  }

  // Link related products (e.g., Drinkware + Eco Bamboo Set)
  await db.addEdge({
    from: 'prod:sg-tumbler-500',
    to: 'prod:sg-bamboo-notebook-set',
    rel: 'FREQUENTLY_PAIRED_WITH',
  })

  await db.flushIndex()
  return {
    status: 'ok',
    categoryCount: SMARTGIFT_CATEGORIES.length,
    productCount: SMARTGIFT_PRODUCTS.length,
    policyCount: SMARTGIFT_POLICIES.length,
  }
}

/**
 * Searches SmartGift knowledge base with Vector + Graph Hybrid Search.
 */
export async function searchSmartGiftKnowledge({ db, queryText, queryVector, embeddingProvider, topK = 4, alpha = 0.5 } = {}) {
  if (!db || typeof db.hybridSearch !== 'function') {
    throw new Error('searchSmartGiftKnowledge requires a valid GenesisDatabase instance')
  }

  let vector = queryVector
  if (!vector && queryText && typeof embeddingProvider === 'function') {
    vector = await embeddingProvider(queryText)
  }

  if (!vector || !Array.isArray(vector)) {
    throw new Error('searchSmartGiftKnowledge requires a queryVector or queryText with embeddingProvider')
  }

  const hits = await db.hybridSearch({
    queryVector: vector,
    k: topK,
    alpha,
    collection: SMARTGIFT_COLLECTION,
  })

  const formattedHits = (hits || []).map((hit) => {
    const node = hit.node || {}
    const props = node.props || {}
    return {
      id: node.id,
      title: props.title || props.name || node.id,
      text: props.text || props.description || '',
      code: props.code || null,
      moq: props.moq || null,
      printingMethods: props.printingMethods || null,
      score: hit.score ?? null,
    }
  })

  const contextText = formattedHits
    .map((h) => {
      let extra = ''
      if (h.moq) extra += ` | ขั้นต่ำ (MOQ): ${h.moq} ชิ้น`
      if (h.printingMethods) extra += ` | วิธีสกรีนโลโก้: ${h.printingMethods}`
      return `• [${h.title}]${extra}\n  รายละเอียด: ${h.text}`
    })
    .join('\n\n')

  return {
    hits: formattedHits,
    contextText,
  }
}

/**
 * Executes a full Agent Turn for a SmartGift LINE customer inquiry.
 */
export async function handleSmartGiftCustomerTurn({ db, userMessage, embeddingProvider, llmProvider, conversationHistory = [] }) {
  if (typeof llmProvider !== 'function') {
    throw new Error('handleSmartGiftCustomerTurn requires an injected llmProvider function')
  }

  const retrieval = await searchSmartGiftKnowledge({
    db,
    queryText: userMessage,
    embeddingProvider,
    topK: 4,
    alpha: 0.5,
  })

  const systemPrompt = `คุณคือ "น้องกิฟต์" AI Assistant ผู้เชี่ยวชาญด้านของขวัญองค์กรและของพรีเมียมจาก SmartGift (Business-01 ในเครือ EtohGroup)

[บทบาทและบุคลิก]:
- สุภาพ กระตือรือร้น เป็นมืออาชีพ ใช้ภาษาไทยที่ถูกต้อง เป็นกันเองและน่าเชื่อถือ
- ให้ข้อมูลสินค้า, สเปก, ขั้นต่ำการผลิต (MOQ), รูปแบบการพิมพ์/สกรีนโลโก้, ระยะเวลาผลิต, และนโยบายการจัดส่ง ได้อย่างแม่นยำ
- แนะนำสินค้าที่เหมาะสมกับงบประมาณและวัตถุประสงค์ของลูกค้า (เช่น งานประชุม, ของขวัญปีใหม่, ของแจกสัมมนา)

[กฎความปลอดภัย]:
1. อ้างอิงข้อมูลจาก [คลังข้อมูลของ SmartGift] ด้านล่างเป็นหลัก
2. ห้ามแต่งข้อมูลราคาสดหรือนโยบายที่ไม่มีในบริบทเด็ดขาด หากไม่มั่นใจให้เชิญลูกค้าแจ้งรายละเอียดเพื่อให้ฝ่ายขายติดต่อกลับ
3. จัดข้อความให้อ่านง่าย สบายตา เหมาะสำหรับแชตบน LINE (ใช้ Bullet Points หรือ Emoji ได้อย่างพอเหมาะ)`

  const userPrompt = `[คลังข้อมูลของ SmartGift]:
${retrieval.contextText || 'ไม่มีข้อมูลสินค้าที่ตรงกับคำค้นหาโดยตรง'}

[คำถามของลูกค้า]:
${userMessage}`

  const responseText = await llmProvider({
    prompt: userPrompt,
    systemPrompt,
  })

  return {
    responseText,
    contextItems: retrieval.hits,
    fullPrompt: userPrompt,
  }
}
