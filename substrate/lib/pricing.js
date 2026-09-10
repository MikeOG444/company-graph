// Cost estimate for a {model: tokens} map using substrate/lib/pricing.json. See the note in that file for the assumption.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const PRICING = JSON.parse(fs.readFileSync(path.join(here, 'pricing.json'), 'utf8'))

// "claude-opus-5[1m]" → "claude-opus-5"; "claude-haiku-4-5-20251001" → "claude-haiku-4-5"; aliases pass through.
export function normalizeModel(id) {
  let m = String(id).replace(/\[.*?\]$/, '').replace(/-\d{8}$/, '')
  if (PRICING.models[m]) return m
  const alias = { opus: 'claude-opus-5', sonnet: 'claude-sonnet-5', haiku: 'claude-haiku-4-5', fable: 'claude-fable-5-1' }[m]
  return alias ?? m
}

export function blendedRate(model) {
  const p = PRICING.models[normalizeModel(model)]
  if (!p) return null
  return PRICING.blend.input * p.input + PRICING.blend.output * p.output   // USD per million tokens
}

/** @returns {{cost_est_usd:number, priced:object, unpriced:string[]}} */
export function estimateCost(tokensByModel) {
  let cost = 0; const priced = {}; const unpriced = []
  for (const [model, tokens] of Object.entries(tokensByModel ?? {})) {
    const rate = blendedRate(model)
    if (rate == null) { unpriced.push(model); continue }
    const usd = (tokens / 1e6) * rate
    priced[normalizeModel(model)] = (priced[normalizeModel(model)] ?? 0) + usd
    cost += usd
  }
  return { cost_est_usd: Math.round(cost * 100) / 100, priced, unpriced }
}

export function normalizeMap(tokensByModel) {
  const out = {}
  for (const [m, t] of Object.entries(tokensByModel ?? {})) out[normalizeModel(m)] = (out[normalizeModel(m)] ?? 0) + t
  return out
}
