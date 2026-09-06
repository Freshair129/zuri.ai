import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CONVERSATION_ANALYSIS_CONTACT_TYPES,
  CONVERSATION_ANALYSIS_STATES,
  zConversationAnalysisContactType,
  zConversationAnalysisState,
} from '@/lib/validation/enums'

// @req FR-127 — the canonical analysis vocabulary and additive production DDL
// remain aligned with the CRM feature note.
// @spec ADR-054 D3-D6, BR-001, SEC-005
// @tested tests/unit/conversation-analysis-contract.test.js

const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20260830221729_conversation_analysis.sql')

describe('FR-127 ConversationAnalysis contract', () => {
  it('keeps contact type and state vocabularies closed and canonical', () => {
    expect(CONVERSATION_ANALYSIS_CONTACT_TYPES).toEqual(['NEW_LEAD', 'RETURNING', 'SUPPORT'])
    expect(CONVERSATION_ANALYSIS_STATES).toEqual(['HOT', 'WARM', 'COLD', 'CLOSED_WON', 'CLOSED_LOST'])
    expect(zConversationAnalysisContactType.safeParse('NEW_LEAD').success).toBe(true)
    expect(zConversationAnalysisContactType.safeParse('UNKNOWN').success).toBe(false)
    expect(zConversationAnalysisState.safeParse('CLOSED_LOST').success).toBe(true)
    expect(zConversationAnalysisState.safeParse('OPEN').success).toBe(false)
  })

  it('keeps the Postgres artifact additive and inherited through Conversation', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/create table if not exists "ConversationAnalysis"/i)
    for (const column of ['id', 'conversationId', 'analyzedDate', 'analyzedAt', 'contactType', 'state', 'cta', 'tags', 'summary', 'rawOutputJson']) {
      expect(sql).toContain(`"${column}"`)
    }
    expect(sql).toMatch(/references "Conversation"\s*\("id"\) on delete cascade on update cascade/i)
    expect(sql).not.toMatch(/"tenantId"|"businessId"/)
    expect(sql).not.toMatch(/unique\s*\(/i)
    expect(sql).not.toMatch(/drop\s+(?:table|column|constraint|index)/i)
    expect(sql).toMatch(/alter table "ConversationAnalysis" enable row level security/i)
    expect(sql).toMatch(/alter table "ConversationAnalysis" force row level security/i)
    expect(sql).toMatch(/create policy zuri_app_runtime_all[\s\S]*to zuri_app_runtime, zuri_web_login/i)
    expect(sql).toMatch(/revoke all on table "ConversationAnalysis" from public, anon, authenticated, service_role/i)
  })
})
