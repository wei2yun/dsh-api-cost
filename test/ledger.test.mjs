// Window-ledger checks with a fake session store. No Harness import needed.
//
// Run: node test/ledger.test.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLedger } from '../lib/ledger.js'
import { resolveBook } from '../lib/pricing.js'

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

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 9, 22, 4, 0, 0) // 12:00 Beijing, Thursday
let nextTurn = 0
const message = (time, provider, model, usage) => ({
  seq: 0,
  time,
  type: 'assistant/message',
  data: { turn: nextTurn++, step: 1, usage, message: { source: { kind: 'model', provider, model } } },
})

const stores = {
  parent: {
    header: { id: 'parent' },
    events: [
      message(NOW - 2 * HOUR, 'deepseek-official', 'deepseek-flash', { inputTokens: 1_000_000, outputTokens: 0 }),
      message(NOW - 30 * HOUR, 'deepseek-official', 'deepseek-flash', { inputTokens: 1_000_000, outputTokens: 0 }),
      { seq: 2, time: NOW - HOUR, type: 'compaction/summary', data: { provider: 'deepseek-official', model: 'deepseek-v4-pro', usage: { inputTokens: 1_000_000, outputTokens: 0 } } },
      { seq: 3, time: NOW - HOUR, type: 'tool/result', data: {} },
    ],
  },
  child: {
    header: { id: 'child' },
    inherited: 2,
    events: [
      // Inherited prefix: belongs to the parent, must not be counted again.
      message(NOW - 3 * HOUR, 'deepseek-official', 'deepseek-flash', { inputTokens: 5_000_000, outputTokens: 0 }),
      message(NOW - 4 * HOUR, 'deepseek-official', 'deepseek-flash', { inputTokens: 5_000_000, outputTokens: 0 }),
      message(NOW - HOUR, 'acme', 'deepseek-flash', { inputTokens: 1_000_000, outputTokens: 0 }),
    ],
  },
}

// Give every event its real sequence: the inherited prefix is identified by seq.
for (const store of Object.values(stores)) {
  store.events = store.events.map((event, seq) => ({ ...event, seq }))
}

let opens = 0
const persistence = {
  async list() {
    return Object.values(stores).map((store) => ({
      header: store.header,
      revision: String(store.events.length),
      eventCount: store.events.length,
    }))
  },
  async open(id) {
    opens += 1
    const store = stores[id]
    return {
      inheritedEventCount: store.inherited ?? 0,
      async read() { return { events: store.events } },
      async close() {},
    }
  },
}

const ledger = createLedger({ persistence, book: resolveBook({}), now: () => NOW })
const day = await ledger.summary(NOW - 24 * HOUR, NOW)
// flash 1M uncached at peak (12:00 Beijing Thursday = peak) = 2
// v4-pro compaction 1M uncached at peak = 9
// relay acme/deepseek-flash is unpriced
near('24h total', day.total, 11)
check('24h unpriced flagged', day.unpriced, true)
check('24h sessions counted', day.sessions, 2)
check('inherited prefix excluded', day.tokens.input, 3_000_000)
check('30h-old call excluded', day.tokens.input === 3_000_000, true)

const all = await ledger.summary(NOW - 48 * HOUR, NOW)
// + the earlier parent call (30h ago, off-peak: 20:00 Beijing Thursday? no,
// NOW-30h = 06:00 Beijing Thursday, off-peak) at 1 per 1M
near('48h total adds the off-peak call', all.total, 12)
check('48h tokens', all.tokens.input, 4_000_000)

const before = opens
await ledger.summary(NOW - 24 * HOUR, NOW)
check('unchanged revisions reuse the cache', opens, before)

stores.parent.events.push(
  message(NOW - 30 * 60_000, 'deepseek-official', 'deepseek-flash', { inputTokens: 1_000_000, outputTokens: 0 }),
)
const afterGrowth = await ledger.summary(NOW - 24 * HOUR, NOW)
check('a changed revision is reread', opens > before, true)
near('the new call is included', afterGrowth.total, 13)

// Persistence: a restarted process reuses the cached call lists instead of
// rereading every stored session.
const dir = mkdtempSync(join(tmpdir(), 'dsh-api-cost-'))
const cacheFile = join(dir, 'ledger.json')
const first = createLedger({ persistence, book: resolveBook({}), now: () => NOW, cacheFile })
const warm = await first.summary(NOW - 24 * HOUR, NOW)
first.dispose()
let blockedOpens = 0
const blocked = {
  async list() { return persistence.list() },
  async open() {
    blockedOpens += 1
    throw new Error('unreadable')
  },
}
const second = createLedger({ persistence: blocked, book: resolveBook({}), now: () => NOW, cacheFile })
const cold = await second.summary(NOW - 24 * HOUR, NOW)
check('cached totals survive a restart', cold.total, warm.total)
check('restart reads no session log', blockedOpens, 0)
second.dispose()
rmSync(dir, { recursive: true, force: true })

console.log(`\n${checks} checks, ${failures.length} failure(s)`)
process.exit(failures.length === 0 ? 0 : 1)
