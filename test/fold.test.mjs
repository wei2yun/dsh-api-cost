// Pricing and fold checks for dsh-api-cost. No Harness or npm install needed:
// the module under test imports nothing.
//
// Run: node test/fold.test.mjs
import {
  BUILTIN_OFF_PEAK_DATES,
  createUnit,
  isPeakTime,
  resolveBook,
} from '../lib/pricing.js'

const failures = []
let checks = 0

function check(name, actual, expected) {
  checks += 1
  const ok = Object.is(actual, expected)
  if (!ok) failures.push(`${name}: expected ${String(expected)}, got ${String(actual)}`)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${String(actual)}`)
}

function near(name, actual, expected, epsilon = 1e-9) {
  checks += 1
  const ok = Math.abs(actual - expected) < epsilon
  if (!ok) failures.push(`${name}: expected ${expected}, got ${actual}`)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${actual}`)
}

/** Beijing 2026-10-21 (Wednesday) at the given wall-clock time. */
const beijing = (hour, minute = 0, dayOffset = 0) => Date.UTC(2026, 9, 21 + dayOffset, hour - 8, minute)

/** Feed one settled assistant call and return the new state. */
let nextTurn = 0
function settle(unit, state, { time, provider = 'deepseek-official', model = 'deepseek-flash', usage }) {
  return unit.apply(state, {
    type: 'assistant/message',
    time,
    data: {
      turn: nextTurn++,
      step: 1,
      usage,
      message: { source: { kind: 'model', provider, model } },
    },
  })
}

const unit = createUnit(resolveBook())
let state = unit.init()

check('empty total', unit.view(state).total, 0)
check('empty routes', unit.view(state).routes.length, 0)

// Peak window boundaries, Beijing time, Wednesday 2026-10-21.
check('08:59 is off-peak', isPeakTime(beijing(8, 59)), false)
check('09:00 is peak', isPeakTime(beijing(9, 0)), true)
check('11:59 is peak', isPeakTime(beijing(11, 59)), true)
check('12:00 is off-peak', isPeakTime(beijing(12, 0)), false)
check('13:59 is off-peak', isPeakTime(beijing(13, 59)), false)
check('14:00 is peak', isPeakTime(beijing(14, 0)), true)
check('17:59 is peak', isPeakTime(beijing(17, 59)), true)
check('18:00 is off-peak', isPeakTime(beijing(18, 0)), false)
check('Saturday is off-peak', isPeakTime(beijing(10, 0, 3)), false)

// Statutory holidays are off-peak all day (official 2026 calendar), and a
// configured date does the same for years the built-in table does not cover.
const holidays = new Set(BUILTIN_OFF_PEAK_DATES)
check('National Day is off-peak', isPeakTime(Date.UTC(2026, 9, 1, 2), 'auto', holidays), false)
check('the working day after is peak', isPeakTime(Date.UTC(2026, 9, 8, 2), 'auto', holidays), true)
check('a configured date is off-peak', isPeakTime(Date.UTC(2026, 9, 8, 2), 'auto', resolveBook({ offPeakDates: ['2026-10-08'] }).offPeakDates), false)

state = settle(unit, state, {
  time: beijing(10),
  usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000 },
})
let view = unit.view(state)
// peak: 1M cache-miss input (2) + 1M cache-hit input (0.04) + 1M output (8)
near('flash peak total', view.total, 10.04)
near('flash peak side', view.peakCost, 10.04)
near('flash off-peak side', view.offPeakCost, 0)
check('cache hit percent', view.cacheHitPercent, 50)

state = settle(unit, state, {
  time: beijing(20),
  usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000 },
})
view = unit.view(state)
near('flash peak+off-peak total', view.total, 15.06)
near('flash peak+off-peak peak side', view.peakCost, 10.04)
near('flash peak+off-peak off-peak side', view.offPeakCost, 5.02)
check('one route', view.routes.length, 1)
check('uncached input total', view.tokens.input, 2_000_000)
check('cache read total', view.tokens.cacheRead, 2_000_000)
check('output total', view.tokens.output, 2_000_000)
check('price policy', view.peakPricing, 'auto')

// A retired model id is served and billed as Flash.
let aliasState = settle(unit, unit.init(), {
  time: beijing(10),
  model: 'deepseek-v4-flash',
  usage: { inputTokens: 1_000_000, outputTokens: 0 },
})
near('retired alias bills as flash', unit.view(aliasState).total, 2)

// The premium route.
let proState = settle(unit, unit.init(), {
  time: beijing(10),
  model: 'deepseek-v4-pro',
  usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
})
near('v4-pro peak total', unit.view(proState).total, 9 + 27)
check('v4-pro display label', unit.view(proState).routes[0].label, 'DeepSeek-V4-Pro')

// Unknown routes keep their tokens and are reported as unpriced.
const unknownState = settle(unit, unit.init(), {
  time: beijing(10),
  provider: 'other',
  model: 'mystery',
  usage: { inputTokens: 500, outputTokens: 200 },
})
const unknownView = unit.view(unknownState)
check('unknown route unpriced', unknownView.unpriced, true)
check('unknown route cost is null', unknownView.routes[0].cost, null)
check('unknown route keeps tokens', unknownView.totalTokens, 700)
near('unknown route adds no money', unknownView.total, 0)

// Forced price periods bill every token at one rate.
const peakOnly = createUnit(resolveBook({ peakPricing: 'peak' }))
const offPeakOnly = createUnit(resolveBook({ peakPricing: 'offPeak' }))
const eveningUsage = { inputTokens: 1_000_000, outputTokens: 0 }
near(
  'forced peak bills evening at peak',
  peakOnly.view(settle(peakOnly, peakOnly.init(), { time: beijing(20), usage: eveningUsage })).total,
  2,
)
near(
  'forced off-peak bills evening at off-peak',
  offPeakOnly.view(settle(offPeakOnly, offPeakOnly.init(), { time: beijing(20), usage: eveningUsage })).total,
  1,
)
near(
  'forced off-peak bills morning at off-peak',
  offPeakOnly.view(settle(offPeakOnly, offPeakOnly.init(), { time: beijing(10), usage: eveningUsage })).total,
  1,
)

// USD book and per-model overrides.
const usd = createUnit(resolveBook({ currency: 'USD' }))
const usdView = usd.view(settle(usd, usd.init(), {
  time: beijing(10),
  usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
}))
check('usd symbol', usdView.symbol, '$')
near('usd flash peak total', usdView.total, 0.3 + 1.2)

const custom = createUnit(resolveBook({
  prices: {
    'acme/my-model': { input: 100, cacheRead: 1, output: 200 },
    'deepseek-flash': { input: 1, cacheRead: 0, output: 4, peak: { input: 3 } },
  },
}))
const customView = custom.view(settle(custom, custom.init(), {
  time: beijing(10),
  provider: 'acme',
  model: 'my-model',
  usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000 },
}))
near('custom model total', customView.total, 100 + 1 + 200)
const flashOverride = custom.view(settle(custom, custom.init(), {
  time: beijing(10),
  usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
}))
// `peak.input` overrides only that field; the rest falls back to this entry's
// own base price (output 4), not to the built-in book it replaced.
near('partial peak override keeps the entry base', flashOverride.total, 3 + 4)

// A bare model key prices official DeepSeek routes only; a relay needs its
// exact `provider/model` key, otherwise it stays unpriced.
const relayState = settle(custom, custom.init(), {
  time: beijing(10),
  provider: 'acme',
  model: 'deepseek-flash',
  usage: { inputTokens: 1_000_000, outputTokens: 0 },
})
check('relay route without an exact key stays unpriced', custom.view(relayState).unpriced, true)

// The summarizer call behind a compaction carries its own provider-reported
// usage and is billed like any other model call.
const compactionState = unit.apply(unit.init(), {
  type: 'compaction/summary',
  time: beijing(10),
  data: {
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    usage: { inputTokens: 1_000_000, outputTokens: 0 },
  },
})
near('compaction summary usage is billed', unit.view(compactionState).total, 2)

// Attempt-aware billing: a streamed attempt is billed, its settled message
// replaces it, and a retry after `llm/retry-started` bills another attempt.
const attemptUnit = createUnit(resolveBook())
const attemptStream = (tokens) => [{
  type: 'chunk',
  time: beijing(10),
  chunk: { type: 'usage', usage: { inputTokens: tokens, outputTokens: 0 } },
}]
const attemptSource = { provider: 'deepseek-official', model: 'deepseek-flash' }
let attempt = attemptUnit.apply(attemptUnit.init(), {
  type: 'request/header',
  seq: 0,
  time: beijing(10),
  data: { header: { config: attemptSource }, reason: 'initial' },
})
attempt = attemptUnit.apply(attempt, {
  type: 'assistant/attempt',
  seq: 1,
  time: beijing(10),
  data: { turn: 1, step: 1, stream: attemptStream(1_000_000) },
})
near('an attempt is billed', attemptUnit.view(attempt).total, 2)
attempt = attemptUnit.apply(attempt, {
  type: 'assistant/message',
  seq: 2,
  time: beijing(10),
  data: {
    turn: 1,
    step: 1,
    usage: { inputTokens: 2_000_000, outputTokens: 0 },
    message: { source: { kind: 'model', ...attemptSource } },
  },
})
near('the settled message replaces the attempt', attemptUnit.view(attempt).total, 4)
attempt = attemptUnit.apply(attempt, { type: 'llm/retry-started', seq: 3, time: beijing(10), data: { turn: 1, step: 1 } })
attempt = attemptUnit.apply(attempt, {
  type: 'assistant/attempt',
  seq: 4,
  time: beijing(10),
  data: { turn: 1, step: 1, stream: attemptStream(1_000_000) },
})
near('a retried attempt adds on top', attemptUnit.view(attempt).total, 6)
attempt = attemptUnit.apply(attempt, {
  type: 'assistant/message',
  seq: 5,
  time: beijing(10),
  data: {
    turn: 1,
    step: 1,
    usage: { inputTokens: 1_000_000, outputTokens: 0 },
    message: { source: { kind: 'model', ...attemptSource } },
  },
})
near('the retry settles and replaces only its own attempt', attemptUnit.view(attempt).total, 6)

// Unrelated events keep the same state reference.
check(
  'unrelated event keeps the state reference',
  unit.apply(state, { type: 'tool/result', time: beijing(10), data: {} }) === state,
  true,
)

// A forked session folds its inherited prefix into a separate total, so a
// parent summing that child subtracts the share it already paid for.
const forkUnit = createUnit(resolveBook())
let forkState = forkUnit.init({}, 2)
for (let seq = 0; seq < 5; seq += 1) {
  forkState = forkUnit.apply(forkState, {
    type: 'assistant/message',
    seq,
    time: beijing(10),
    data: {
      turn: seq,
      step: 1,
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
      message: { source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-flash' } },
    },
  })
}
const forkView = forkUnit.view(forkState)
near('fork prices all calls', forkView.total, 5 * 2)
near('fork inherited share', forkView.inherited.total, 2 * 2)
check('fork inherited tokens', forkView.inherited.totalTokens, 2_000_000)
check('normal session has no inherited share', unit.view(state).inherited.total, 0)

// Per-turn tables feed the completed-turn footer; a compaction has no turn.
const turnMessage = (seq, time, turn) => ({
  type: 'assistant/message',
  seq,
  time,
  data: {
    turn,
    usage: { inputTokens: 1_000_000, outputTokens: 0 },
    message: { source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-flash' } },
  },
})
let turnState = unit.apply(unit.init(), turnMessage(0, beijing(10), 1))
turnState = unit.apply(turnState, turnMessage(1, beijing(20), 2))
const turnView = unit.view(turnState)
check('two priced turns', turnView.turns.length, 2)
near('turn 1 peak cost', turnView.turns[0].cost, 2)
near('turn 2 off-peak cost', turnView.turns[1].cost, 1)
const compactionTurn = unit.apply(unit.init(), {
  type: 'compaction/summary',
  time: beijing(10),
  data: { provider: 'deepseek-official', model: 'deepseek-flash', usage: { inputTokens: 1_000_000 } },
})
check('compaction adds no turn entry', unit.view(compactionTurn).turns.length, 0)

// Zero-usage settlements do not create a route.
const zeroState = settle(unit, unit.init(), {
  time: beijing(10),
  usage: { inputTokens: 0, outputTokens: 0 },
})
check('zero usage adds no route', unit.view(zeroState).routes.length, 0)

console.log(`\n${checks} checks, ${failures.length} failure(s)`)
process.exit(failures.length === 0 ? 0 : 1)
