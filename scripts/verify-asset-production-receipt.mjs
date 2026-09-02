#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateAssetProductionReceipt } from './lib/asset-production-receipt.mjs'

const receiptPath = process.argv[2]
if (!receiptPath) {
  console.error('Usage: node scripts/verify-asset-production-receipt.mjs <receipt.json>')
  process.exitCode = 2
} else {
  try {
    const receipt = JSON.parse(readFileSync(resolve(receiptPath), 'utf8'))
    validateAssetProductionReceipt(receipt)
    console.log('asset-production-receipt: PASS')
  } catch (error) {
    console.error(`asset-production-receipt: FAIL — ${error.message}`)
    process.exitCode = 1
  }
}
