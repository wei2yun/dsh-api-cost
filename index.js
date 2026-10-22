/**
 * API cost meter — Host half.
 *
 * Registers the client-visible `apiCost` session projection: it folds the
 * provider-reported token usage of every settled model call into per-route
 * buckets and prices them with DeepSeek's list prices (or the operator's
 * overrides). The Session log stays the only source of truth — nothing is
 * written, and replay, resume, and fork re-derive the same value.
 *
 * All pricing logic lives in `./lib/pricing.js`, which has no Harness imports.
 * This module only adapts it to Cordis: the Config schema and the projection
 * registration.
 *
 * @module dsh-api-cost
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { createLedger } from './lib/ledger.js'
import { createUnit, resolveBook } from './lib/pricing.js'

/** Session projection key read by the browser half. */
const PROJECTION_KEY = 'apiCost'

/** Same-origin route that answers time-window totals for the browser half. */
const WINDOW_ROUTE = '/plugins/api-cost/window'

/** One day in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000

/** Cached per-session call lists, so a restart does not rescan a large history. */
const CACHE_FILE = join(
  process.env.DSH_HOME ?? join(homedir(), '.dsh'),
  'storages',
  'dsh-api-cost',
  'ledger.json',
)

/** Bump whenever the folded state or its meaning changes. */
const STATE_VERSION = 4

/**
 * The projection registry validates through `parse` only; this plugin owns its
 * plain-JSON state, so the identity schema is the whole contract.
 */
const plainJson = { parse: (value) => value }

/** Prices for one model, per 1M tokens in the configured currency. */
const ModelPrice = Schema.object({
  input: Schema.number().min(0).default(0)
    .description('Cache-miss input tokens, per 1M tokens.'),
  cacheRead: Schema.number().min(0).default(0)
    .description('Cache-hit input tokens, per 1M tokens.'),
  cacheWrite: Schema.number().min(0).default(0)
    .description('Cache-write tokens, per 1M tokens. 0 on DeepSeek.'),
  output: Schema.number().min(0).default(0)
    .description('Output tokens, per 1M tokens.'),
  peak: Schema.object({
    input: Schema.number().min(0),
    cacheRead: Schema.number().min(0),
    cacheWrite: Schema.number().min(0),
    output: Schema.number().min(0),
  }).description('Peak-period prices. Omitted fields reuse the base price, so a model without a surge pattern needs no peak block.'),
})

/**
 * Plugin configuration.
 *
 * `prices` entries replace a model's whole price set and may name a model the
 * built-in DeepSeek book does not know. Keys are a bare `model` for any
 * provider route or `provider/model` for one exact route.
 */
export const Config = Schema.object({
  currency: Schema.union(['CNY', 'USD']).default('CNY')
    .description('Price book and symbol: CNY (¥, mainland platform) or USD ($, international platform).'),
  peakPricing: Schema.union(['auto', 'peak', 'offPeak']).default('auto')
    .description('auto applies DeepSeek’s Beijing-time peak and off-peak windows; peak/offPeak bill every call at one rate.'),
  offPeakDates: Schema.array(Schema.string()).default([])
    .description('Extra off-peak calendar dates (YYYY-MM-DD, Beijing time) for statutory holidays the built-in table does not cover. 2026 is built in.'),
  prices: Schema.dict(ModelPrice).default({})
    .description('Per-model overrides in the configured currency, per 1M tokens. Example: { "deepseek-flash": { "input": 1, "cacheRead": 0.02, "output": 4, "peak": { "input": 2, "cacheRead": 0.04, "output": 8 } } }'),
})

/** Requires the projection registry; inactive in compositions without it. */
export const inject = ['sessionProjections']

/**
 * Register the `apiCost` projection unit.
 * @param ctx - Host plugin context.
 * @param config - Validated plugin configuration.
 */
export function apply(ctx, config) {
  const book = resolveBook(config)
  const unit = createUnit(book)
  ctx.sessionProjections.register({
    key: PROJECTION_KEY,
    stateVersion: STATE_VERSION,
    stateSchema: plainJson,
    init: unit.init,
    apply: unit.apply,
    wire: {
      viewSchema: plainJson,
      view: unit.view,
    },
  })
  ctx.inject(['webServer', 'sessionPersistence'], (scope) => {
    const ledger = createLedger({ persistence: scope.sessionPersistence, book, cacheFile: CACHE_FILE })
    scope.effect(() => {
      scope.webServer.register({
        kind: 'exact',
        path: WINDOW_ROUTE,
        handler: (req, res) => answerWindow(ledger, req, res),
      })
      return () => ledger.dispose()
    }, 'api-cost: window route')
  })
}

/**
 * Resolve a named range to its half-open epoch window.
 * @param {string} range - `today`, `24h`, `7d`, or `30d`.
 * @param {number} now - epoch ms.
 */
function windowOf(range, now) {
  if (range === 'today') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return { from: start.getTime(), to: now }
  }
  if (range === '7d') return { from: now - 7 * DAY_MS, to: now }
  if (range === '30d') return { from: now - 30 * DAY_MS, to: now }
  return { from: now - DAY_MS, to: now }
}

/** Answer one `GET /plugins/api-cost/window?range=…` request with aggregates only. */
async function answerWindow(ledger, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    res.end()
    return
  }
  const url = new URL(typeof req.url === 'string' ? req.url : '/', 'http://localhost')
  const range = url.searchParams.get('range') ?? '24h'
  const to = Date.now()
  const { from } = windowOf(range, to)
  // Stop folding when the browser goes away (panel closed, range switched).
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })
  try {
    const summary = await ledger.summary(from, to, controller.signal)
    if (controller.signal.aborted) return
    sendJson(res, 200, { range, from, to, ...summary })
  } catch {
    if (controller.signal.aborted) return
    sendJson(res, 500, { error: 'window-unavailable' })
  }
}

/** Write one JSON response; window totals are live data, never cached. */
function sendJson(res, status, body) {
  if (res.writableEnded || res.destroyed) return
  const text = JSON.stringify(body)
  try {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(text),
      'cache-control': 'no-store',
    })
    res.end(text)
  } catch {
    // The peer went away between the check and the write.
  }
}
