/**
 * Window totals over every stored Session.
 *
 * The projection answers "what did this conversation cost"; this ledger
 * answers "what did everything cost in a time range". It reads the durable
 * session store through `ctx.sessionPersistence` (never the filesystem), folds
 * each session's provider-reported usage into a compact per-call list, and
 * caches that list against the store's own revision token, so a repeated query
 * rereads only sessions that changed.
 *
 * A forked session inherits its parent's log; the inherited prefix
 * (`seq < inheritedEventCount`) belongs to the parent and is skipped here.
 *
 * @module dsh-api-cost/lib/ledger
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { collectUsageCalls, priceUsage } from './pricing.js'

/** How far back cached calls are kept. Older sessions are still readable. */
export const RETENTION_MS = 35 * 24 * 60 * 60 * 1000

/** Sessions opened concurrently on one query. */
const CONCURRENCY = 8

/** On-disk cache shape version. */
const CACHE_VERSION = 1

/** Delay before a scan is persisted, so a burst of queries writes once. */
const SAVE_DELAY_MS = 2000

/** Skip persistence beyond this many cached calls (a pathological history). */
const MAX_CACHED_CALLS = 200_000

function round(value) {
  return Math.round(value * 1e6) / 1e6
}

/**
 * Create the window ledger.
 *
 * @param {object} options
 * @param {{ list: Function, open: Function }} options.persistence - session store.
 * @param {ReturnType<import('./pricing.js').resolveBook>} options.book - prices.
 * @param {() => number} [options.now] - clock, injectable for tests.
 * @param {number} [options.retentionMs] - how far back calls are cached.
 */
export function createLedger({
  persistence,
  book,
  now = () => Date.now(),
  retentionMs = RETENTION_MS,
  cacheFile,
}) {
  /** sessionId -> { revision, calls, seen } */
  const cache = new Map()
  let saveTimer
  /** sessionId -> in-flight fold, so concurrent queries read a session once. */
  const loading = new Map()

  /** Fold one stored session into its compact call list, once per revision. */
  async function load(snapshot) {
    const id = snapshot.header.id
    const revision = String(snapshot.revision)
    const cached = cache.get(id)
    if (cached !== undefined && cached.revision === revision) return cached.calls
    const pending = loading.get(id)
    if (pending !== undefined) return pending
    const task = (async () => {
      const handle = await persistence.open(id, 'read')
      try {
        const { events } = await handle.read()
        const inherited = Number(handle.inheritedEventCount ?? 0)
        const floor = now() - retentionMs
        const calls = collectUsageCalls(events, inherited, floor)
        cache.set(id, { revision, calls, seen: now() })
        return calls
      } finally {
        await handle.close()
      }
    })()
    loading.set(id, task)
    try {
      return await task
    } finally {
      loading.delete(id)
    }
  }

  /** Drop cached sessions that disappeared from the store. */
  function prune(current) {
    for (const id of cache.keys()) if (!current.has(id)) cache.delete(id)
  }

  /** Load the previous process's call lists, ignoring anything stale or broken. */
  function loadCache() {
    if (cacheFile === undefined) return
    try {
      const text = readFileSync(cacheFile, 'utf8')
      const parsed = JSON.parse(text)
      if (parsed?.version !== CACHE_VERSION || typeof parsed.sessions !== 'object') return
      const floor = now() - retentionMs
      for (const [id, entry] of Object.entries(parsed.sessions)) {
        if (typeof entry?.revision !== 'string' || !Array.isArray(entry.calls)) continue
        const calls = []
        for (const row of entry.calls) {
          if (!Array.isArray(row) || typeof row[0] !== 'number' || row[0] < floor) continue
          calls.push({
            t: row[0],
            provider: typeof row[1] === 'string' ? row[1] : 'unknown',
            model: typeof row[2] === 'string' ? row[2] : 'unknown',
            usage: {
              input: typeof row[3] === 'number' ? row[3] : 0,
              cacheRead: typeof row[4] === 'number' ? row[4] : 0,
              cacheWrite: typeof row[5] === 'number' ? row[5] : 0,
              output: typeof row[6] === 'number' ? row[6] : 0,
            },
          })
        }
        cache.set(id, { revision: entry.revision, calls, seen: now() })
      }
    } catch {
      // A missing, unreadable, or foreign file just means a cold scan.
    }
  }

  /** Persist the current call lists atomically; any failure degrades to memory. */
  function saveCache() {
    if (cacheFile === undefined) return
    const sessions = {}
    let total = 0
    for (const [id, entry] of cache) {
      total += entry.calls.length
      if (total > MAX_CACHED_CALLS) return
      sessions[id] = {
        revision: entry.revision,
        calls: entry.calls.map((call) => [
          call.t, call.provider, call.model,
          call.usage.input, call.usage.cacheRead, call.usage.cacheWrite, call.usage.output,
        ]),
      }
    }
    try {
      mkdirSync(dirname(cacheFile), { recursive: true })
      const temporary = `${cacheFile}.${process.pid}.tmp`
      writeFileSync(temporary, JSON.stringify({ version: CACHE_VERSION, savedAt: now(), sessions }))
      renameSync(temporary, cacheFile)
    } catch {
      // Read-only home or a full disk: keep working from memory.
    }
  }

  function scheduleSave() {
    if (cacheFile === undefined || saveTimer !== undefined) return
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      saveCache()
    }, SAVE_DELAY_MS)
    saveTimer.unref?.()
  }

  loadCache()

  /**
   * Sum every stored session's calls in `[from, to)`.
   * @param {number} from - inclusive epoch ms.
   * @param {number} to - exclusive epoch ms.
   */
  async function summary(from, to, signal) {
    signal?.throwIfAborted()
    const snapshots = await persistence.list(signal === undefined ? undefined : { signal })
    const ids = new Set(snapshots.map((snapshot) => snapshot.header.id))
    prune(ids)
    const calls = []
    let failed = 0
    for (let index = 0; index < snapshots.length; index += CONCURRENCY) {
      signal?.throwIfAborted()
      const chunk = snapshots.slice(index, index + CONCURRENCY)
      const loaded = await Promise.all(chunk.map(async (snapshot) => {
        try {
          return await load(snapshot)
        } catch {
          failed += 1
          return []
        }
      }))
      for (const list of loaded) calls.push(...list)
    }
    const tokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
    let total = 0
    let unpriced = false
    for (const call of calls) {
      if (call.t < from || call.t >= to) continue
      tokens.input += call.usage.input
      tokens.cacheRead += call.usage.cacheRead
      tokens.cacheWrite += call.usage.cacheWrite
      tokens.output += call.usage.output
      const cost = priceUsage(book, call.provider, call.model, call.usage, call.t)
      if (cost === null) unpriced = true
      else total += cost
    }
    const promptTokens = tokens.input + tokens.cacheRead + tokens.cacheWrite
    scheduleSave()
    return {
      total: round(total),
      unpriced,
      tokens,
      totalTokens: promptTokens + tokens.output,
      promptTokens,
      cacheHitPercent: promptTokens === 0 ? null : Math.round((tokens.cacheRead / promptTokens) * 1000) / 10,
      sessions: snapshots.length,
      failed,
    }
  }

  return {
    summary,
    clear: () => cache.clear(),
    /** Persist now and release the timer; safe to call twice. */
    dispose() {
      if (saveTimer !== undefined) {
        clearTimeout(saveTimer)
        saveTimer = undefined
      }
      saveCache()
    },
  }
}
