/**
 * Pure pricing model for the api-cost plugin.
 *
 * Holds the DeepSeek list prices, the Beijing-time peak windows, the durable
 * usage fold, and the browser-facing view. Nothing here imports Cordis or a
 * Harness package, so the whole module runs under plain Node in tests and the
 * Host plugin stays a thin adapter over it.
 *
 * Billing buckets kept per (provider, model) and per price period:
 *   input      — prompt tokens billed at the cache-miss price
 *   cacheRead  — prompt tokens billed at the cache-hit price
 *   cacheWrite — prompt tokens billed at the cache-write price (0 on DeepSeek)
 *   output     — completion tokens (reasoning tokens are billed as output)
 *
 * @module dsh-api-cost/lib/pricing
 */

/** List prices are quoted per this many tokens. */
export const TOKENS_PER_PRICE = 1_000_000

/** Beijing is UTC+8 all year. */
export const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * Beijing-time peak windows of the official list price: Monday through Friday,
 * 09:00–12:00 and 14:00–18:00, as minutes after local midnight. Chinese public
 * holidays are billed off-peak; this plugin ships no holiday calendar, so a
 * holiday weekday counts as peak.
 */
export const PEAK_WINDOWS_MINUTES = [
  [9 * 60, 12 * 60],
  [14 * 60, 18 * 60],
]

/**
 * DeepSeek list prices per 1M tokens, from the official pricing page
 * (api-docs.deepseek.com, "Models & Pricing"). `deepseek-flash` is
 * DeepSeek-V4.1-Flash-1017 and `deepseek-v4-pro` is DeepSeek-V4-Pro-0813.
 * Off-peak is half of peak; DeepSeek bills no separate cache-write fee.
 */
export const PRICE_BOOKS = {
  CNY: {
    symbol: '¥',
    models: {
      'deepseek-flash': {
        peak: { input: 2, cacheRead: 0.04, cacheWrite: 0, output: 8 },
        offPeak: { input: 1, cacheRead: 0.02, cacheWrite: 0, output: 4 },
      },
      'deepseek-v4-pro': {
        peak: { input: 9, cacheRead: 0.3, cacheWrite: 0, output: 27 },
        offPeak: { input: 4.5, cacheRead: 0.15, cacheWrite: 0, output: 13.5 },
      },
    },
  },
  USD: {
    symbol: '$',
    models: {
      'deepseek-flash': {
        peak: { input: 0.3, cacheRead: 0.006, cacheWrite: 0, output: 1.2 },
        offPeak: { input: 0.15, cacheRead: 0.003, cacheWrite: 0, output: 0.6 },
      },
      'deepseek-v4-pro': {
        peak: { input: 1.32, cacheRead: 0.044, cacheWrite: 0, output: 3.96 },
        offPeak: { input: 0.66, cacheRead: 0.022, cacheWrite: 0, output: 1.98 },
      },
    },
  },
}

/** Retired model ids still served and billed at the Flash price. */
export const MODEL_ALIASES = {
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
}

/** Display names for the routes the book knows; anything else shows its id. */
export const MODEL_NAMES = {
  'deepseek-flash': 'DeepSeek-V4.1-Flash',
  'deepseek-v4-pro': 'DeepSeek-V4-Pro',
}

const ZERO = Object.freeze({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })

/** Read one non-negative token count. */
function tokens(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** Read one non-negative price. */
function price(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** A fresh billing bucket. */
export function zeroBuckets() {
  return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
}

/** Sum two billing buckets. */
export function addBuckets(left, right) {
  return {
    input: left.input + right.input,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    output: left.output + right.output,
  }
}

/** Tokens across every bucket of one entry. */
export function totalTokens(bucket) {
  return bucket.input + bucket.cacheRead + bucket.cacheWrite + bucket.output
}

/** Statutory holiday dates the official list bills at the off-peak rate. */
function datesBetween(from, to) {
  const out = []
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  for (let time = start; time <= end; time += 24 * 60 * 60 * 1000) {
    out.push(new Date(time).toISOString().slice(0, 10))
  }
  return out
}

/**
 * 2026 statutory holidays (国务院办公厅国办发明电〔2025〕7号). DeepSeek bills
 * these days at the off-peak rate all day; make-up working weekends stay
 * off-peak too because they are weekends. Later years are added through the
 * `offPeakDates` config — the built-in table does not guess future schedules.
 */
export const BUILTIN_OFF_PEAK_DATES = Object.freeze([
  ...datesBetween('2026-01-01', '2026-01-03'),
  ...datesBetween('2026-02-15', '2026-02-23'),
  ...datesBetween('2026-04-04', '2026-04-06'),
  ...datesBetween('2026-05-01', '2026-05-05'),
  ...datesBetween('2026-06-19', '2026-06-21'),
  ...datesBetween('2026-09-25', '2026-09-27'),
  ...datesBetween('2026-10-01', '2026-10-07'),
])

/** Beijing calendar date of one epoch millisecond, as `YYYY-MM-DD`. */
export function beijingDay(time) {
  return new Date(time + BEIJING_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * Whether a settlement time falls in a Beijing-time peak window.
 *
 * Peak is Monday–Friday 09:00–12:00 and 14:00–18:00 Beijing time, excluding
 * statutory holidays (off-peak all day) and weekends.
 */
export function isPeakTime(time, mode = 'auto', offPeakDates) {
  if (mode === 'peak') return true
  if (mode === 'offPeak') return false
  if (typeof time !== 'number' || !Number.isFinite(time)) return false
  if (offPeakDates !== undefined && offPeakDates.has(beijingDay(time))) return false
  const beijing = new Date(time + BEIJING_OFFSET_MS)
  const weekday = beijing.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes()
  return PEAK_WINDOWS_MINUTES.some(([from, to]) => minutes >= from && minutes < to)
}

/**
 * Build the effective price book for one plugin configuration.
 *
 * `config.prices` replaces a model's whole price set (per 1M tokens in the
 * configured currency) and may name a model the built-in book does not know.
 * A `peak` block overrides only the fields it sets; anything else reuses the
 * base price, so a model without a surge pattern needs no `peak` block.
 *
 * @param {{ currency?: string, peakPricing?: string, prices?: Record<string, any> }} [config]
 * @returns {{ currency: string, symbol: string, peakPricing: string, models: Record<string, { peak: object, offPeak: object }> }}
 */
export function resolveBook(config = {}) {
  const currency = config.currency === 'USD' ? 'USD' : 'CNY'
  const base = PRICE_BOOKS[currency]
  const models = { ...base.models }
  for (const [key, entry] of Object.entries(config.prices ?? {})) {
    if (entry === undefined || entry === null || typeof entry !== 'object') continue
    const offPeak = {
      input: price(entry.input),
      cacheRead: price(entry.cacheRead),
      cacheWrite: price(entry.cacheWrite),
      output: price(entry.output),
    }
    const surge = entry.peak ?? {}
    models[key] = {
      peak: {
        input: surge.input === undefined ? offPeak.input : price(surge.input),
        cacheRead: surge.cacheRead === undefined ? offPeak.cacheRead : price(surge.cacheRead),
        cacheWrite: surge.cacheWrite === undefined ? offPeak.cacheWrite : price(surge.cacheWrite),
        output: surge.output === undefined ? offPeak.output : price(surge.output),
      },
      offPeak,
    }
  }
  const offPeakDates = new Set(BUILTIN_OFF_PEAK_DATES)
  for (const date of config.offPeakDates ?? []) {
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) offPeakDates.add(date)
  }
  return {
    currency,
    symbol: base.symbol,
    peakPricing: config.peakPricing === 'peak' || config.peakPricing === 'offPeak'
      ? config.peakPricing
      : 'auto',
    offPeakDates,
    models,
  }
}

/** Look up one route's price, accepting `provider/model`, bare `model`, and aliases. */
export function priceOf(book, provider, model) {
  const id = MODEL_ALIASES[model] ?? model
  const exact = book.models[`${provider}/${id}`]
  if (exact !== undefined) return exact
  // Only official DeepSeek routes inherit the official list prices. A relay or
  // aggregator may charge differently for the same model id, so it needs an
  // explicit `provider/model` entry instead of a silently wrong estimate.
  const official = provider === 'deepseek-official'
    || provider === 'deepseek-account'
    || provider.startsWith('deepseek')
  return official ? book.models[id] : undefined
}

/** The billed amount of one bucket under one period price. */
function bucketCost(bucket, rates) {
  return (
    bucket.input * rates.input +
    bucket.cacheRead * rates.cacheRead +
    bucket.cacheWrite * rates.cacheWrite +
    bucket.output * rates.output
  ) / TOKENS_PER_PRICE
}

/** Round to sub-cent precision so the wire value carries no float noise. */
function round(value) {
  return Math.round(value * 1e6) / 1e6
}

/** Price one usage sample at the period its time falls in, or null when unpriced. */
export function priceUsage(book, provider, model, usage, time) {
  const rates = priceOf(book, provider, model)
  if (rates === undefined) return null
  const peak = isPeakTime(time, book.peakPricing, book.offPeakDates)
  return bucketCost(usage, peak ? rates.peak : rates.offPeak)
}

/** Price one route's buckets under the book's period policy. */
function routeCost(book, entry, rates) {
  const peak = entry.peak ?? ZERO
  const offPeak = entry.offPeak ?? ZERO
  if (book.peakPricing === 'peak') {
    const all = bucketCost(addBuckets(peak, offPeak), rates.peak)
    return { cost: all, peakCost: all, offPeakCost: 0 }
  }
  if (book.peakPricing === 'offPeak') {
    const all = bucketCost(addBuckets(peak, offPeak), rates.offPeak)
    return { cost: all, peakCost: 0, offPeakCost: all }
  }
  const peakCost = bucketCost(peak, rates.peak)
  const offPeakCost = bucketCost(offPeak, rates.offPeak)
  return { cost: peakCost + offPeakCost, peakCost, offPeakCost }
}

/** Browser-facing value of one route. */
function routeView(book, entry) {
  const peak = entry.peak ?? ZERO
  const offPeak = entry.offPeak ?? ZERO
  const bucket = addBuckets(peak, offPeak)
  const rates = priceOf(book, entry.provider, entry.model)
  if (rates === undefined) {
    return {
      key: `${entry.provider}/${entry.model}`,
      provider: entry.provider,
      model: entry.model,
      label: MODEL_NAMES[entry.model] ?? entry.model,
      priced: false,
      tokens: bucket,
      totalTokens: totalTokens(bucket),
      cost: null,
      peakCost: null,
      offPeakCost: null,
    }
  }
  const priced = routeCost(book, entry, rates)
  return {
    key: `${entry.provider}/${entry.model}`,
    provider: entry.provider,
    model: entry.model,
    label: MODEL_NAMES[entry.model] ?? entry.model,
    priced: true,
    tokens: bucket,
    totalTokens: totalTokens(bucket),
    cost: round(priced.cost),
    peakCost: round(priced.peakCost),
    offPeakCost: round(priced.offPeakCost),
  }
}

/**
 * Build the Host projection unit for one price book.
 *
 * `init`/`apply` keep only per-route token buckets, so a price or currency
 * change re-prices existing history without rewriting it, and the log stays
 * the only source of truth.
 *
 * @param {ReturnType<typeof resolveBook>} book - resolved prices.
 * @returns {{ init: Function, apply: Function, view: Function }}
 */
/** Price and aggregate one route table. */
export function summarize(book, table) {
  const routes = Object.values(table ?? {})
    .map((entry) => routeView(book, entry))
    .sort((left, right) => right.totalTokens - left.totalTokens)
  const totals = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  let cost = 0
  let peakCost = 0
  let offPeakCost = 0
  let unpriced = false
  for (const route of routes) {
    totals.input += route.tokens.input
    totals.cacheRead += route.tokens.cacheRead
    totals.cacheWrite += route.tokens.cacheWrite
    totals.output += route.tokens.output
    if (route.cost === null) {
      unpriced = true
      continue
    }
    cost += route.cost
    peakCost += route.peakCost
    offPeakCost += route.offPeakCost
  }
  const promptTokens = totals.input + totals.cacheRead + totals.cacheWrite
  return {
    routes,
    tokens: totals,
    total: round(cost),
    peakCost: round(peakCost),
    offPeakCost: round(offPeakCost),
    unpriced,
    totalTokens: promptTokens + totals.output,
    promptTokens,
    cacheHitPercent: promptTokens === 0 ? null : Math.round((totals.cacheRead / promptTokens) * 1000) / 10,
  }
}

/** Last provider usage sample embedded in one attempt stream. */
export function streamUsage(stream) {
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (record?.type === 'chunk' && record.chunk?.type === 'usage') return record.chunk.usage
  }
  return undefined
}

/** The usage a settled message or a streaming attempt reports, if any. */
export function usageOfEvent(event) {
  if (event.type === 'assistant/message') {
    if (event.data?.usage !== undefined) return event.data.usage
    return streamUsage(event.data?.stream)
  }
  if (event.type === 'assistant/attempt') return streamUsage(event.data?.stream)
  return undefined
}

function bucketsOf(usage) {
  return {
    input: tokens(usage.inputTokens),
    cacheRead: tokens(usage.cacheReadTokens),
    cacheWrite: tokens(usage.cacheWriteTokens),
    output: tokens(usage.outputTokens),
  }
}

function bucketsEqual(left, right) {
  return left.input === right.input
    && left.cacheRead === right.cacheRead
    && left.cacheWrite === right.cacheWrite
    && left.output === right.output
}

function routeOf(source) {
  const provider = typeof source?.provider === 'string' && source.provider !== '' ? source.provider : undefined
  const model = typeof source?.model === 'string' && source.model !== '' ? source.model : undefined
  return provider === undefined || model === undefined ? undefined : { provider, model }
}

function negate(bucket) {
  return { input: -bucket.input, cacheRead: -bucket.cacheRead, cacheWrite: -bucket.cacheWrite, output: -bucket.output }
}

/** Add (or subtract) one bucket in a route table. */
function addToTable(table, route, bucket, period, sign) {
  const key = `${route.provider}/${route.model}`
  const previous = table[key] ?? { provider: route.provider, model: route.model, peak: zeroBuckets(), offPeak: zeroBuckets() }
  return {
    ...table,
    [key]: { ...previous, [period]: addBuckets(previous[period], sign > 0 ? bucket : negate(bucket)) },
  }
}

/** Apply one signed sample to routes, the inherited share, and its turn. */
function addUsage(state, sample, sign) {
  const { turn, route, period, bucket, inherited } = sample
  const next = { ...state, routes: addToTable(state.routes ?? {}, route, bucket, period, sign) }
  if (inherited) next.inherited = addToTable(state.inherited ?? {}, route, bucket, period, sign)
  if (typeof turn === 'number') {
    const turns = state.turns ?? {}
    next.turns = { ...turns, [turn]: addToTable(turns[turn] ?? {}, route, bucket, period, sign) }
  }
  return next
}

/**
 * Collect every billed call of one session log for window queries.
 *
 * Mirrors the projection's attempt semantics: a streamed attempt sample is
 * replaced by its settled message in the same turn/step, and
 * `llm/retry-started` closes that replacement slot so a retried attempt is
 * billed as its own call.
 *
 * @param {readonly object[]} events - the session log in order.
 * @param {number} [inheritedCount] - inherited prefix length to skip.
 * @param {number} [floor] - drop calls settled before this epoch ms.
 * @returns {Array<{ t: number, provider: string, model: string, usage: object }>}
 */
export function collectUsageCalls(events, inheritedCount = 0, floor = Number.NEGATIVE_INFINITY) {
  const calls = []
  let route
  let last = null
  for (const event of events) {
    if (event.type === 'request/header') {
      route = routeOf(event.data?.header?.config) ?? route
      continue
    }
    if (event.type === 'llm/retry-started') {
      const data = event.data ?? {}
      if (last !== null && last.turn === data.turn && last.step === data.step) last = null
      continue
    }
    let usage
    let source
    let turn
    let step
    if (event.type === 'compaction/summary') {
      usage = event.data?.usage
      source = event.data
    } else if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
      usage = usageOfEvent(event)
      source = event.type === 'assistant/message' ? event.data?.message?.source : undefined
      turn = typeof event.data?.turn === 'number' ? event.data.turn : undefined
      step = typeof event.data?.step === 'number' ? event.data.step : undefined
    } else {
      continue
    }
    if (usage === undefined) continue
    const bucket = bucketsOf(usage)
    if (totalTokens(bucket) === 0) continue
    const resolved = routeOf(source) ?? route ?? { provider: 'unknown', model: 'unknown' }
    const call = { t: event.time, provider: resolved.provider, model: resolved.model, usage: bucket }
    const keep = typeof event.time === 'number'
      && event.time >= floor
      && !(typeof event.seq === 'number' && event.seq < inheritedCount)
    const same = typeof turn === 'number' && last !== null && last.turn === turn && last.step === step
    if (same) {
      if (last.index >= 0) {
        if (keep) {
          calls[last.index] = call
        } else {
          calls.splice(last.index, 1)
          last = { turn, step, index: -1 }
        }
      } else if (keep) {
        calls.push(call)
        last = { turn, step, index: calls.length - 1 }
      }
    } else if (keep) {
      calls.push(call)
      if (typeof turn === 'number') last = { turn, step, index: calls.length - 1 }
    } else if (typeof turn === 'number') {
      last = { turn, step, index: -1 }
    }
  }
  return calls
}

export function createUnit(book) {
  return {
    /** Empty state; the registry folds the session log over it. */
    init(_header, inheritedEventCount = 0) {
      return {
        routes: {},
        turns: {},
        inheritedCount: typeof inheritedEventCount === 'number' && inheritedEventCount > 0 ? inheritedEventCount : 0,
        inherited: {},
        route: null,
        last: null,
      }
    },
    /**
     * Fold one committed event. Two event types carry provider-reported usage:
     * a settled model call (`assistant/message`) and the summarizer call behind
     * a compaction (`compaction/summary`). A retry/streaming sample
     * (`assistant/attempt`) is superseded by its final message, and every other
     * event returns the same reference so unchanged state costs nothing.
     */
    apply(state, event) {
      if (event.type === 'request/header') {
        const route = routeOf(event.data?.header?.config)
        if (route === undefined) return state
        if (state.route?.provider === route.provider && state.route?.model === route.model) return state
        return { ...state, route }
      }
      if (event.type === 'llm/retry-started') {
        const data = event.data ?? {}
        return state.last !== null && state.last.turn === data.turn && state.last.step === data.step
          ? { ...state, last: null }
          : state
      }
      if (event.type === 'compaction/summary') {
        const data = event.data ?? {}
        if (data.usage === undefined) return state
        const bucket = bucketsOf(data.usage)
        if (totalTokens(bucket) === 0) return state
        return addUsage(state, {
          turn: undefined,
          route: routeOf(data) ?? { provider: 'unknown', model: 'unknown' },
          period: isPeakTime(event.time, book.peakPricing, book.offPeakDates) ? 'peak' : 'offPeak',
          bucket,
          inherited: state.inheritedCount > 0 && typeof event.seq === 'number' && event.seq < state.inheritedCount,
        }, 1)
      }
      const sample = usageOfEvent(event)
      if (sample === undefined) return state
      const data = event.data ?? {}
      const turn = typeof data.turn === 'number' ? data.turn : undefined
      const step = typeof data.step === 'number' ? data.step : undefined
      const route = routeOf(event.type === 'assistant/message' ? data.message?.source : undefined)
        ?? state.route
        ?? { provider: 'unknown', model: 'unknown' }
      const bucket = bucketsOf(sample)
      if (totalTokens(bucket) === 0) return state
      const period = isPeakTime(event.time, book.peakPricing, book.offPeakDates) ? 'peak' : 'offPeak'
      const inherited = state.inheritedCount > 0 && typeof event.seq === 'number' && event.seq < state.inheritedCount
      const same = state.last !== null && state.last.turn === turn && state.last.step === step
      if (same
        && state.last.period === period
        && state.last.inherited === inherited
        && state.last.route.provider === route.provider
        && state.last.route.model === route.model
        && bucketsEqual(state.last.bucket, bucket)) return state
      const next = same ? addUsage(state, state.last, -1) : state
      const withSample = addUsage(next, { turn, route, period, bucket, inherited }, 1)
      return { ...withSample, last: { turn, step, route, period, bucket, inherited } }
    },
    /** Aggregate and price the current state for the browser. */
    view(state) {
      const main = summarize(book, state.routes)
      const inherited = summarize(book, state.inherited)
      const turns = Object.entries(state.turns ?? {})
        .map(([turn, table]) => {
          const summary = summarize(book, table)
          return {
            turn: Number(turn),
            cost: summary.total,
            totalTokens: summary.totalTokens,
            unpriced: summary.unpriced,
          }
        })
        .filter((entry) => entry.totalTokens > 0)
        .sort((left, right) => left.turn - right.turn)
      return {
        currency: book.currency,
        symbol: book.symbol,
        peakPricing: book.peakPricing,
        total: main.total,
        peakCost: main.peakCost,
        offPeakCost: main.offPeakCost,
        unpriced: main.unpriced,
        tokens: main.tokens,
        totalTokens: main.totalTokens,
        promptTokens: main.promptTokens,
        cacheHitPercent: main.cacheHitPercent,
        routes: main.routes,
        turns,
        inherited: {
          total: inherited.total,
          peakCost: inherited.peakCost,
          offPeakCost: inherited.offPeakCost,
          tokens: inherited.tokens,
          totalTokens: inherited.totalTokens,
        },
      }
    },
  }
}
