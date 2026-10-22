# Changelog

Notable changes to `dsh-api-cost`. This project follows
[Semantic Versioning](https://semver.org/) and the Harness `engines.dsh` range.

## 1.0.1 — 2026-10-21

- Counts subagents without opening them first. A descendant whose `apiCost` the
  session list had not served yet — a freshly spawned child, or a checkpoint
  written before the plugin existed — left the total short until you clicked into
  that conversation. The control now asks the session controller to fold the
  descendant's projections on demand.
- Marks a provisional total. While a descendant is unread or still running, the
  control shows `¥0.83+` and the panel says why, instead of presenting a partial
  sum as the final bill. A running child is read again when it settles, so a
  mid-run snapshot never sticks.
- Adds `test/family.test.mjs`, which loads the shipped Web bundle through a
  loader stub and covers nested descendants, forked shares, and the state key
  that drives re-reads.

## 1.0.0 — 2026-10-21

First release.

- Adds the `apiCost` session projection: per-route billing buckets (uncached
  input, cache-hit input, cache-write, output) folded from every settled
  `assistant/message` usage, priced per 1M tokens.
- Prices DeepSeek-V4.1-Flash and DeepSeek-V4-Pro in CNY and USD, including the
  Beijing-time peak / off-peak windows and the retired `deepseek-v4-flash`
  aliases.
- Adds a composer-dock control with the session total and a panel showing the
  per-model breakdown, cache-hit rate, and peak / off-peak split.
- Configuration through the plugin Config schema: `currency`, `peakPricing`,
  and per-model `prices` overrides.
- Bills the summarizer call behind a compaction (`compaction/summary`), so
  automatic compaction is no longer free in the total.
- Prices only official DeepSeek routes from the built-in book; relays and
  aggregators need an explicit `provider/model` entry.
- Counts every subagent session a conversation delegated to: the control adds
  each descendant session's cost from the session list, and subtracts a forked
  child's inherited share so the parent's own spend is not counted twice.
- Bills streaming attempts: a settled message replaces its attempt in the same
  turn/step, and `llm/retry-started` makes a retried attempt a separate call.
- Prices statutory holidays at the off-peak rate: the 2026 calendar is built
  in, and `offPeakDates` adds later years.
- Persists the window ledger under `$DSH_HOME/storages/dsh-api-cost/` so a
  restart reuses per-session call lists instead of rescanning every log.
- Shows each completed turn's cost in the turn footer, folded per `turn` from
  the same projection.
- Keeps the range panel compact (one scope line) and caps the panel height, so
  a popover never grows past the viewport.
- Range queries share one per-session fold, stop folding when the browser
  navigates away, reject non-GET methods, and report sessions that could not
  be read.
- Turn chips subscribe through a selector, so a projection update re-renders
  only turns whose cost changed.
- Adds machine-wide time-range totals (`Today`, `Last 24h`, `Last 7 days`,
  `Last 30 days`) over every session this Harness home stored, across all
  workspaces: the Host folds the durable session store through
  `ctx.sessionPersistence`, caches per store revision, and serves aggregates
  from a same-origin route.
- Pricing logic is a dependency-free module under `lib/`, covered by
  `test/fold.test.mjs` and `test/ledger.test.mjs`.
