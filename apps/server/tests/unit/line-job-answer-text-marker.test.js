import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runtimeOutOfHoursReply } from '@/modules/line-oa-studio/application/line-conversation-jobs'

// @req FR-244 — a runtime-cohort job's `answerText` before READY is the admission-time
//   out-of-hours decision (ADR-094 D6, ADR-106). That reading is sound only while
//   admission is the one writer of a non-null `answerText` before READY. This suite
//   pins every write of the column in the Server source, so a new writer fails here
//   and has to be reviewed against `runtimeOutOfHoursReply`, rather than silently
//   turning an ordinary turn into a fixed reply.
// @spec ADR-106 D3, SDD-110
// @tested tests/unit/line-job-answer-text-marker.test.js
const srcRoot = fileURLToPath(new URL('../../src/', import.meta.url))

function sourceFiles(directory) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(?:js|jsx|mjs|ts|tsx)$/.test(name) ? [path] : []
  })
}

/** Every `answerText:` property write (not a Prisma `select`, not a `job.answerText` read). */
function answerTextWrites() {
  const writes = []
  for (const file of sourceFiles(srcRoot)) {
    const content = readFileSync(file, 'utf8')
    // Any writer of the column goes through the Prisma model (or its table name in SQL).
    if (!/lineConversationJob|"LineConversationJob"/.test(content)) continue
    const lines = content.split(/\r?\n/)
    lines.forEach((line, index) => {
      for (const match of line.matchAll(/(?<![.\w])answerText\s*:\s*([^,}\n]+)/g)) {
        if (match[1].trim() === 'true') continue
        writes.push({ file: relative(srcRoot, file).split(sep).join('/'), line: index + 1, value: match[1].trim(), text: line.trim() })
      }
    })
    // A shorthand property or a raw SQL column write would slip past the scan above.
    for (const line of lines) {
      expect(line, `${file}: shorthand answerText write`).not.toMatch(/[{,]\s*answerText\s*[,}]/)
      expect(line, `${file}: raw SQL answerText write`).not.toMatch(/"answerText"\s*=/)
    }
  }
  return writes
}

describe('LineConversationJob.answerText writers (FR-244 marker invariant)', () => {
  it('has exactly the reviewed writers: admission, READY settlement and clearing', () => {
    const writes = answerTextWrites().map(({ file, value }) => `${file} :: ${value}`)
    expect(writes.sort()).toEqual([
      // Admission, runtime cohort: QUEUED with the out-of-hours snapshot (the marker).
      'modules/line-oa-studio/application/line-conversation-jobs.js :: current.outOfHoursReplyText',
      // Admission, Server cohort: straight to READY.
      'modules/line-oa-studio/application/line-conversation-jobs.js :: current.outOfHoursReplyText',
      // Runtime send refused on revoked authority: CANCELLED, cleared.
      'modules/line-oa-studio/application/line-conversation-jobs.js :: null',
      // settleExecution: text only with READY (see the next case).
      "modules/line-oa-studio/application/line-conversation-jobs.js :: finalStatus === 'UNKNOWN' ? null : text ?? null",
      // PDPA erasure: cleared.
      'modules/line-oa-studio/application/line-job-erasure.js :: null',
    ].sort())
  })

  it('writes text at admission only on the two out-of-hours branches, and settles text only with READY', () => {
    const source = readFileSync(join(srcRoot, 'modules/line-oa-studio/application/line-conversation-jobs.js'), 'utf8')
    expect(source).toContain(`runtimeOwner === 'CONVERSATION_RUNTIME' ? { answerText: current.outOfHoursReplyText }`)
    expect(source).toContain(`: { status: 'READY', answerText: current.outOfHoursReplyText }`)
    expect(source).toContain(`const outOfHoursAdmission = !outOfHours ? {}`)
    // settleExecution: FAILED always carries a code and no text; UNKNOWN clears; only
    // READY (no code) keeps the text.
    expect(source).toContain(`const finalStatus = outcome === 'UNKNOWN' ? 'UNKNOWN' : code ? 'FAILED' : 'READY'`)
    expect(source).toMatch(/code = 'REPLY_DEADLINE_MISSED'\r?\n\s*text = undefined/)
  })

  it('reads the marker only for a runtime-cohort job that is still QUEUED or CLAIMED', () => {
    const job = { runtimeOwner: 'CONVERSATION_RUNTIME', status: 'CLAIMED', answerText: 'ปิดทำการ' }
    expect(runtimeOutOfHoursReply(job)).toBe('ปิดทำการ')
    expect(runtimeOutOfHoursReply({ ...job, status: 'QUEUED' })).toBe('ปิดทำการ')
    for (const status of ['READY', 'SENDING', 'ACCEPTED', 'RECORDED', 'FAILED', 'UNKNOWN', 'CANCELLED']) {
      expect(runtimeOutOfHoursReply({ ...job, status })).toBeNull()
    }
    expect(runtimeOutOfHoursReply({ ...job, runtimeOwner: 'SERVER' })).toBeNull()
    expect(runtimeOutOfHoursReply({ ...job, answerText: null })).toBeNull()
    expect(runtimeOutOfHoursReply({ ...job, answerText: '   ' })).toBeNull()
    expect(runtimeOutOfHoursReply(null)).toBeNull()
  })
})
