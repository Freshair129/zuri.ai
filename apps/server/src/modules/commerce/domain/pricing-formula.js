// @req FR-252 — bounded, typed pricing expressions with exact decimal arithmetic.
// @spec ADR-097
// @tested tests/unit/pricing-engine.test.js

export function pricingError(message, field = 'rules', code = 'INVALID_PRICING_RULES') {
  return Object.assign(new Error(message), { status: 422, code, field })
}

const gcd = (a, b) => { a = a < 0n ? -a : a; while (b) [a, b] = [b, a % b]; return a || 1n }

/** Rational arithmetic; no binary float participates in a pricing decision. */
export class Decimal {
  constructor(n, d = 1n) {
    if (!d) throw pricingError('Division by zero', 'formulas', 'DIVISION_BY_ZERO')
    if (d < 0n) { n = -n; d = -d }
    if (n.toString().length > 160 || d.toString().length > 160) throw pricingError('Arithmetic limit exceeded', 'formulas')
    const g = gcd(n, d)
    this.n = n / g; this.d = d / g
  }
  static from(value) {
    if (value instanceof Decimal) return value
    if (typeof value !== 'string' && typeof value !== 'number') throw pricingError('Expected a decimal', 'decimal')
    const s = String(value)
    if (s.length > 36 || !/^-?(?:\d+(?:\.\d{1,12})?|\.\d{1,12})$/.test(s)) throw pricingError('Expected a finite decimal with at most 12 decimal places', 'decimal')
    const neg = s.startsWith('-'), [whole, fraction = ''] = s.replace('-', '').split('.')
    return new Decimal(BigInt((whole || '0') + fraction) * (neg ? -1n : 1n), 10n ** BigInt(fraction.length))
  }
  add(v) { v = Decimal.from(v); return new Decimal(this.n * v.d + v.n * this.d, this.d * v.d) }
  sub(v) { v = Decimal.from(v); return new Decimal(this.n * v.d - v.n * this.d, this.d * v.d) }
  mul(v) { v = Decimal.from(v); return new Decimal(this.n * v.n, this.d * v.d) }
  div(v) { v = Decimal.from(v); return new Decimal(this.n * v.d, this.d * v.n) }
  cmp(v) { v = Decimal.from(v); const n = this.n * v.d - v.n * this.d; return n < 0n ? -1 : n > 0n ? 1 : 0 }
  round(dp) {
    const scale = 10n ** BigInt(dp), a = this.n < 0n ? -this.n : this.n
    const q = (a * scale * 2n + this.d) / (this.d * 2n)
    return new Decimal(this.n < 0n ? -q : q, scale)
  }
  ceilStep(step) {
    step = Decimal.from(step)
    if (step.cmp(0) <= 0) throw pricingError('Rounding step must be positive', 'rounding.priceStepThb')
    const q = this.div(step), n = q.n / q.d + (q.n > 0n && q.n % q.d ? 1n : 0n)
    return step.mul(new Decimal(n))
  }
  satang() {
    const v = this.round(2).mul(100), n = Number(v.n / v.d)
    if (!Number.isSafeInteger(n)) throw pricingError('Money exceeds safe integer satang range', 'input', 'PRICE_OVERFLOW')
    return n
  }
  text(dp = 4) {
    const v = this.round(dp), scaled = v.n * 10n ** BigInt(dp) / v.d
    const sign = scaled < 0n ? '-' : '', digits = (scaled < 0n ? -scaled : scaled).toString().padStart(dp + 1, '0')
    return dp ? `${sign}${digits.slice(0, -dp)}.${digits.slice(-dp)}` : `${sign}${digits}`
  }
}

export const PRICING_VARIABLES = Object.freeze({
  quantity: 'unit', landedCost: 'THB/unit', factoryCost: 'THB/unit',
  anchorPrice: 'THB/unit', factor: 'ratio', anchorFactor: 'ratio', markup: 'ratio',
  orderCost: 'THB', profitFloor: 'THB', priceStep: 'THB/unit',
  fxCny: 'THB/CNY', fxUsd: 'THB/USD',
})
const UNITS = {
  ratio: {}, unit: { unit: 1 }, THB: { THB: 1 }, CNY: { CNY: 1 }, USD: { USD: 1 },
  'THB/unit': { THB: 1, unit: -1 }, 'CNY/unit': { CNY: 1, unit: -1 },
  'USD/unit': { USD: 1, unit: -1 }, 'THB/CNY': { THB: 1, CNY: -1 }, 'THB/USD': { THB: 1, USD: -1 },
}
const unitKey = (u) => JSON.stringify(Object.entries(u).filter(([, v]) => v).sort(([a], [b]) => a.localeCompare(b)))
const sameUnit = (a, b) => unitKey(a) === unitKey(b)
function combineUnit(a, b, sign) {
  const out = { ...a }; for (const [key, value] of Object.entries(b)) out[key] = (out[key] || 0) + value * sign
  return out
}

function parse(expression, field) {
  if (typeof expression !== 'string' || !expression.trim() || expression.length > 2048) throw pricingError('Formula must contain 1–2048 characters', field)
  const tokens = [], re = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([A-Za-z][A-Za-z0-9_]*)|([()+*/,-]))/y
  let offset = 0
  while (offset < expression.length) {
    if (!expression.slice(offset).trim()) break
    re.lastIndex = offset; const match = re.exec(expression)
    if (!match) throw pricingError(`Invalid formula token at ${offset}`, field, 'INVALID_FORMULA')
    tokens.push({ kind: match[1] ? 'number' : match[2] ? 'name' : 'symbol', value: match[1] || match[2] || match[3] })
    offset = re.lastIndex
    if (tokens.length > 256) throw pricingError('Formula token limit exceeded', field)
  }
  let cursor = 0, nodes = 0
  const peek = () => tokens[cursor]?.value
  const take = (expected) => {
    const t = tokens[cursor++]
    if (!t || (expected && t.value !== expected)) throw pricingError(`Expected ${expected || 'expression'}`, field, 'INVALID_FORMULA')
    return t
  }
  const node = (n) => { if (++nodes > 256) throw pricingError('Formula node limit exceeded', field); return n }
  function expr(min, depth) {
    if (depth > 32) throw pricingError('Formula depth limit exceeded', field)
    let left; const token = take()
    if (token.value === '-' || token.value === '+') left = node({ type: 'unary', op: token.value, child: expr(3, depth + 1) })
    else if (token.kind === 'number') { Decimal.from(token.value); left = node({ type: 'number', value: token.value }) }
    else if (token.value === '(') { left = expr(0, depth + 1); take(')') }
    else if (token.kind === 'name') {
      if (peek() === '(') {
        take('('); const args = []
        if (peek() !== ')') { do { if (args.length) take(','); args.push(expr(0, depth + 1)) } while (peek() === ',') }
        take(')'); left = node({ type: 'call', name: token.value, args })
      } else left = node({ type: 'variable', name: token.value })
    } else throw pricingError('Expected a literal, variable or parenthesized expression', field, 'INVALID_FORMULA')
    while (['+', '-', '*', '/'].includes(peek())) {
      const op = peek(), precedence = op === '+' || op === '-' ? 1 : 2
      if (precedence < min) break
      take(); left = node({ type: 'binary', op, left, right: expr(precedence + 1, depth + 1) })
    }
    return left
  }
  const ast = expr(0, 0)
  if (cursor !== tokens.length) throw pricingError('Unexpected trailing expression', field, 'INVALID_FORMULA')
  return ast
}

function infer(ast, variables, field, refs, depth = 0) {
  if (depth > 32) throw pricingError('Formula depth limit exceeded', field)
  const child = (n) => infer(n, variables, field, refs, depth + 1)
  if (ast.type === 'number') return UNITS.ratio
  if (ast.type === 'variable') {
    if (!Object.hasOwn(variables, ast.name)) throw pricingError(`Unknown variable ${ast.name}`, field, 'UNKNOWN_VARIABLE')
    refs.add(ast.name); return UNITS[variables[ast.name]]
  }
  if (ast.type === 'unary') return child(ast.child)
  if (ast.type === 'binary') {
    const a = child(ast.left), b = child(ast.right)
    if (ast.op === '*' || ast.op === '/') return combineUnit(a, b, ast.op === '*' ? 1 : -1)
    if (!sameUnit(a, b)) throw pricingError('Currency or unit mismatch', field, 'UNIT_MISMATCH')
    return a
  }
  if (!['min', 'max', 'ceilToStep', 'quantityBand'].includes(ast.name)) throw pricingError(`Function ${ast.name} is not allowed`, field, 'INVALID_FORMULA')
  const units = ast.args.map(child)
  if (ast.name === 'quantityBand') {
    if (units.length !== 1 || !sameUnit(units[0], UNITS.unit)) throw pricingError('quantityBand requires one quantity', field, 'UNIT_MISMATCH')
    return UNITS.ratio
  }
  if (units.length < 2 || units.length > 8 || (ast.name === 'ceilToStep' && units.length !== 2)) throw pricingError('Invalid function argument count', field)
  if (units.some((u) => !sameUnit(u, units[0]))) throw pricingError('Currency or unit mismatch', field, 'UNIT_MISMATCH')
  return units[0]
}

// Reject statically provable arithmetic failures during save/approval too.
// Variable-dependent denominators are checked against the actual input at run.
function checkConstants(ast, field) {
  if (ast.type === 'number') return Decimal.from(ast.value)
  if (ast.type === 'variable') return null
  if (ast.type === 'unary') {
    const value = checkConstants(ast.child, field)
    return value === null ? null : ast.op === '-' ? value.mul(-1) : value
  }
  if (ast.type === 'binary') {
    const a = checkConstants(ast.left, field), b = checkConstants(ast.right, field)
    if (ast.op === '/' && b !== null && b.cmp(0) === 0) throw pricingError('Division by constant zero', field, 'DIVISION_BY_ZERO')
    return a === null || b === null ? null : a[{ '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' }[ast.op]](b)
  }
  const args = ast.args.map((node) => checkConstants(node, field))
  if (ast.name === 'ceilToStep' && args[1] !== null && args[1].cmp(0) <= 0) throw pricingError('Rounding step must be positive', field)
  if (args.some((arg) => arg === null) || ast.name === 'quantityBand') return null
  if (ast.name === 'ceilToStep') return args[0].ceilStep(args[1])
  return args.reduce((a, b) => (ast.name === 'min' ? a.cmp(b) <= 0 : a.cmp(b) >= 0) ? a : b)
}

export function validatePricingFormula(steps) {
  if (!Array.isArray(steps) || !steps.length || steps.length > 16) throw pricingError('Expected 1–16 formula steps', 'formulas')
  const variables = { ...PRICING_VARIABLES }, parsed = new Map()
  for (const [i, step] of steps.entries()) {
    const field = `formulas.${i}`
    if (!step || Object.keys(step).some((k) => !['name', 'expression', 'unit'].includes(k)) || !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(step.name) || ['constructor', 'prototype', '__proto__'].includes(step.name) || Object.hasOwn(variables, step.name) || !Object.hasOwn(UNITS, step.unit)) throw pricingError('Invalid or duplicate formula variable/unit', field)
    variables[step.name] = step.unit
    parsed.set(step.name, { ...step, ast: parse(step.expression, `${field}.expression`), field })
  }
  if (variables.candidatePrice !== 'THB/unit') throw pricingError('candidatePrice must return THB/unit', 'formulas')
  for (const step of parsed.values()) {
    step.refs = new Set()
    if (!sameUnit(infer(step.ast, variables, step.field, step.refs), UNITS[step.unit])) throw pricingError('Declared unit does not match expression', step.field, 'UNIT_MISMATCH')
    checkConstants(step.ast, step.field)
  }
  const ordered = [], visiting = new Set(), visited = new Set()
  function visit(name) {
    if (visited.has(name) || !parsed.has(name)) return
    if (visiting.has(name)) throw pricingError('Formula dependency cycle', 'formulas', 'FORMULA_CYCLE')
    visiting.add(name); const step = parsed.get(name)
    for (const ref of step.refs) visit(ref)
    visiting.delete(name); visited.add(name); ordered.push(step)
  }
  for (const name of parsed.keys()) visit(name)
  return ordered
}

export function evaluatePricingFormula(compiled, values, quantityBand) {
  const env = { ...values }
  function run(node) {
    if (node.type === 'number') return Decimal.from(node.value)
    if (node.type === 'variable') return Decimal.from(env[node.name])
    if (node.type === 'unary') return node.op === '-' ? run(node.child).mul(-1) : run(node.child)
    if (node.type === 'binary') return run(node.left)[{ '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' }[node.op]](run(node.right))
    const args = node.args.map(run)
    if (node.name === 'quantityBand') return quantityBand(args[0])
    if (node.name === 'ceilToStep') return args[0].ceilStep(args[1])
    return args.reduce((a, b) => (node.name === 'min' ? a.cmp(b) <= 0 : a.cmp(b) >= 0) ? a : b)
  }
  for (const step of compiled) {
    try { env[step.name] = run(step.ast) } catch (e) { e.field = step.field; throw e }
  }
  return env.candidatePrice
}
