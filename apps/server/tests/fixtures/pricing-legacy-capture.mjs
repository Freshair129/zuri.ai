// @req FR-253 — reproducible read-only legacy oracle capture, never a runtime dependency.
// @spec ADR-098
// Usage: node tests/fixtures/pricing-legacy-capture.mjs <SmartGift root> <Python executable>
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const [sourceRoot, python] = process.argv.slice(2)
if (!sourceRoot || !python) throw new Error('SmartGift source root and Python executable required')
const read = (p) => fs.readFileSync(path.join(sourceRoot, p), 'utf8')
const html = read('price-boss/pricing.html')
const start = html.indexOf('(() => {', html.indexOf('<script>'))
const end = html.lastIndexOf('  /*', html.indexOf('PART 2 — Reading a catalog'))
if (start < 0 || end < start) throw new Error('Legacy engine boundaries changed; inspect source')
const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } })
const api = new vm.Script(html.slice(start, end) + '\nreturn {quote,landedFor,applyPricingConfig}; })()').runInContext(context, { timeout: 1000 })
api.applyPricingConfig(JSON.parse(read('price-boss/pricing-config.json')))
const cases = [
  ['volume_truck', 'none', 'standard', 0.1, null, 11],
  ['volume_sea', 'none', 'corporate', 0.2, null, 4],
  ['weight', 'flat', 'standard', 0.1, 50, 4],
  ['hotstamp', 'hotstamp', 'standard', 0.1, null, 4],
  ['hotstamp_text', 'hotstamp_text', 'standard', 0.1, null, 4],
  ['engrave', 'engrave', 'standard', 0.1, null, 4],
  ['silk', 'silk', 'standard', 0.1, null, 4],
  ['uv', 'uv', 'standard', 0.1, null, 4],
].map(([name, method, profile, cbm, kg, month]) => ({ name, method, profile, cbm, kg, month }))
// Python on the capture host need not have PyYAML: explicitly pass the parsed
// source document to its real config adapter, never allow silent default fallback.
const pythonCode = `import sys,json,runpy\nfrom pathlib import Path\nroot=Path(sys.argv[1])\nmodule=runpy.run_path(str(root/'src/cascade_engine/pricing_calculator.py'))\ndef decode(v):\n if isinstance(v,dict): return {k:decode(x) for k,x in v.items()}\n if isinstance(v,list): return [decode(x) for x in v]\n return float('inf') if v=='__unbounded__' else v\npayload=decode(json.loads(sys.stdin.read()))\ncalc=module['SmartGiftPricingCalculator'](fx=5,usd_to_thb=34)\napplied=calc._apply_config(payload['rules'])\nassert calc.usd_to_thb==34 and calc.fx==5 and 'shipping_rate_matrix' in applied\noutput=[]\nfor c in payload['cases']:\n q=calc.generate_quote(rmb=32,upc=20,cbm=c['cbm'],kg=c['kg'],profile_key=c['profile'],warehouse='guangzhou_shenzhen',mode='auto',month=c['month'],goods_type='general',tier='gold',logo_method=c['method'],logo_positions=1,logo_colors=1,logo_rate=10,logo_uv_rate=0.1)\n output.append(q['ladder_quotes'])\nprint(json.dumps(output))\n`
const processResult = spawnSync(python, ['-B', '-c', pythonCode, sourceRoot], { input: JSON.stringify({ cases, rules: parse(read('config/pricing_rules_formula.yaml')) }, (_, v) => v === Infinity ? '__unbounded__' : v), encoding: 'utf8', maxBuffer: 1024 * 1024 })
if (processResult.status !== 0) throw new Error(processResult.stderr)
const pythonRows = JSON.parse(processResult.stdout)
const rows = cases.map((c, index) => {
  const i = { profile: c.profile, rmb: 32, fx: 5, upc: 20, cbm: c.cbm, kg: c.kg, wh: 'guangzhou_shenzhen', tier: 'gold', mode: 'auto', month: c.month, goods: 'general', inlandRmb: 2, ucost: 0, ocost: 0, usdRate: 34, logo: { method: c.method, positions: 1, colors: 1, rate: 10, uvRate: 0.1 } }
  // The browser's automatic USD=CNY*6.5 defect is deliberately excluded from
  // parity inputs: both oracles here receive the same independently pinned FX.
  const browser = api.quote(i).breaks
  return { ...c, quantityRows: pythonRows[index].map((row) => ({ quantity: row.quantity, pythonPriceSatang: Math.round(row.unit_selling_price * 100), pythonLandedThb: row.unit_landed_cost.toFixed(4), browserPriceSatang: Math.round(browser.find((b) => b.qty === row.quantity).price * 100) })) }
})
const sourceFiles = ['src/cascade_engine/pricing_calculator.py', 'price-boss/pricing.html', 'price-boss/pricing-config.json', 'config/pricing_rules_formula.yaml'].map((p) => ({ path: p, sha256: createHash('sha256').update(read(p)).digest('hex') }))
const output = { evidence: 'Captured actual legacy Python generate_quote with YAML parsed by Node and passed to its _apply_config (avoids missing PyYAML fallback), and browser pure quote with generated config; identical FX=5 CNY/34 USD asserted. No database/pipeline/network execution.', sourceFiles, roundingPolicyDifference: 'Approved 20260913 S(x)=CEIL to satang and shared cost division CEIL replace legacy 4dp float rounding; kind=set floor omission and browser automatic USD inference are intentional changes tested separately.', cases: rows }
fs.writeFileSync(fileURLToPath(new URL('./pricing-legacy-vectors.json', import.meta.url)), JSON.stringify(output, null, 2) + '\n')
console.log(JSON.stringify({ cases: rows.length, quantityRows: rows.reduce((n, c) => n + c.quantityRows.length, 0), sourceFiles }))
