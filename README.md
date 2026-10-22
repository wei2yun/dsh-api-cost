# dsh-api-cost

A [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) plugin bundle that shows **what the current session's API usage costs**, right beside the token counter under the composer — and why.

English | [简体中文](README.zh.md)

---

## What it is

This repository is a **Harness plugin bundle**: one package that contributes a **Host plugin** and a **Web Client plugin** to a Harness profile.

- The Host plugin registers a session projection (`apiCost`) that folds the provider-reported usage of every settled model call into per-route billing buckets and prices them.
- The Client plugin registers one control in the composer's ambient dock (`conversation.composer.dock`) and renders the value the Host already computed.

It is **not** a skill (skills are model-facing instructions the Agent loads), **not** an agent preset (presets compose plugins for a session), and **not** a standalone app. A bundle is the unit the Harness Plugin Manager installs, enables, and removes.

## What you see

Under the composer, after the built-in statistics:

```
   3 turns 12 steps · 41.2 tok/s     612k tokens · Cache hit 99%     ¥0.83
   └──────────── existing controls ────────────────────────────┘  └ this plugin ┘
```

Clicking the cost opens a small panel:

```
API cost                                              ¥0.83
────────────────────────────────────────────────────────────
DeepSeek-V4.1-Flash                                   ¥0.83
Input 214k · Cache hit 32.0M · Output 127k
Cache hit rate 99.3%
Peak ¥0 · Off-peak ¥0.83
Estimated from DeepSeek list prices; the invoice is authoritative.
```

The total covers the whole conversation: this Session **plus every subagent session it delegated to**, with their share listed separately. The control reads each descendant's cost itself, so you never have to open that conversation first; while a descendant is unread or still running, the total carries a `+` to mark it as a floor or a provisional figure. Every completed turn also shows its own cost in the turn footer, next to the chat's token-usage entry (`本轮 ¥0.0123`).

The panel also switches to a **time range**: `Today`, `Last 24h`, `Last 7 days`, or `Last 30 days`, totalling every stored session on the machine.

The control disappears while there is no billable usage, and an unrecognized `provider/model` is shown as *No price configured* instead of being silently guessed.

## Install

Requirements: DeepSeek Harness `0.2.1-rc.2` or another `0.2.x` release (`engines.dsh` is declared), and the Web UI.

**From the Web UI:** open **Plugins** in the sidebar, choose **Install**, and paste this repository's address:

```
https://github.com/wei2yun/dsh-api-cost
```

**From the CLI:**

```sh
dsh plugin --profile web add github:wei2yun/dsh-api-cost
```

**From an agent:** call `plugin_manager` with `action: install_bundle` and the same address (or a local checkout path while developing).

A Git install follows the branch head; pin a commit (`github:wei2yun/dsh-api-cost#<sha>`) when you need a reproducible install. The package ships plain ESM, so a Git install runs no build script.

### Distribution

This repository is the bundle itself: no build step, no runtime dependency to install, and every file the Host and the browser load is committed. It installs from a Git dependency, a local checkout, or npm if it is ever published there. Discovery follows the ecosystem's `dsh-plugin` GitHub topic; a plugin-market index entry is optional and not required to install.

Then send a message. A page that was already open before the install has no baseline for the new projection yet, so refresh once if the control does not appear immediately.

The plugin stores nothing and changes no Harness setting beyond its own profile entry. Remove it from the Plugins page at any time.

## Time ranges

The range tabs add up **every session this Harness home has stored, across all workspaces** — the whole machine's consumption under the configured API key, not just the conversation you are reading:

1. The Host reads the durable session store through `ctx.sessionPersistence` — no filesystem parsing, no private paths.
2. Each session is folded into a compact per-call list (time, route, token buckets), skipping a forked session's inherited prefix and keeping the last 35 days.
3. That list is cached against the store's own `revision`, so a repeated query rereads only sessions that changed.
4. Calls are summed exactly inside the half-open window and priced per call with the same book: `Today` starts at local midnight, the others are rolling windows ending now.

The browser reads the result from the plugin's own same-origin route (`/plugins/api-cost/window`), which answers aggregates only — no session ids, no content. The route is part of the Host half, so it exists after the next Harness restart.

## Per-turn cost

Each `assistant/message` also folds into a table keyed by its turn number, so the completed-turn footer can show what that turn cost. The turn chip reads the same projection value the panel does and disappears when the turn has no billable call (a compaction, for example, is billed to the session but belongs to no turn).

## How the number is produced

1. Every settled model call appends an `assistant/message` event carrying the provider's `usage` and the concrete `provider`/`model` route. The summarizer call behind a compaction appends the same facts on `compaction/summary` and is billed like any other call. A streaming attempt is billed from its streamed usage sample and then replaced by the settled message of the same turn and step; `llm/retry-started` closes that replacement slot, so a retried attempt is billed on its own — an aborted call that never settles is still counted once the provider reported usage for it.
2. The projection folds those events into four disjoint buckets per route — uncached input, cache-hit input, cache-write input, output — split by price period.
3. The Client-visible view prices the buckets with the list prices below and publishes the total, the per-route breakdown, and the peak/off-peak split.
4. The control adds the `apiCost` of every descendant session (`origin: subagent`). When the session list does not carry that value yet — a freshly spawned child, or a checkpoint written before this plugin existed — the control asks the session controller to fold the descendant's projections on demand, without opening that conversation. A forked child inherits the parent's log, so its `inherited` share is subtracted and only what the fork itself spent is counted. A child that is still running is read again once it settles, so a mid-run snapshot never becomes the final number.

Because the Session log stays the only source of truth, replay, resume, and fork derive the same number, and the plugin never writes to the log.

## Prices

List prices per **1M tokens**, from the official [DeepSeek pricing page](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) (October 2026). Off-peak is half of peak.

| Model | Period | Cache-hit input | Cache-miss input | Output |
|---|---|---|---|---|
| `deepseek-flash` (DeepSeek-V4.1-Flash-1017) | Peak | ¥0.04 | ¥2 | ¥8 |
| | Off-peak | ¥0.02 | ¥1 | ¥4 |
| `deepseek-v4-pro` (DeepSeek-V4-Pro-0813) | Peak | ¥0.30 | ¥9 | ¥27 |
| | Off-peak | ¥0.15 | ¥4.50 | ¥13.50 |

USD books for the international platform ship too; switch with `currency: USD`.

- **Billing rules follow DeepSeek's published notes**: peak is Monday–Friday 09:00–12:00 and 14:00–18:00 Beijing time, excluding statutory holidays (off-peak all day); weekends — including make-up working weekends — are off-peak. Each call is classified by the time its usage was reported. The 2026 statutory holiday calendar is built in; add later years with `offPeakDates`.
- Retired model ids `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are billed at the Flash price.
- DeepSeek bills no separate cache-write fee, so that bucket defaults to 0.
- Only official DeepSeek routes (`deepseek-official`, `deepseek-account`, or another `deepseek…` provider id) inherit these prices. A relay or aggregator that serves the same model id needs an explicit `provider/model` entry under `prices`; otherwise it is reported as unpriced instead of being priced at DeepSeek's rates.

## Configuration

Set the row's `config` in your profile's `cordis.patch.yml` (the Web profile reloads it live; other profiles apply it on restart):

```yaml
- id: api-cost
  config:
    currency: CNY          # CNY (¥) | USD ($)
    peakPricing: auto      # auto | peak | offPeak
    prices:
      deepseek-flash:
        input: 1
        cacheRead: 0.02
        cacheWrite: 0
        output: 4
        peak:
          input: 2
          cacheRead: 0.04
          output: 8
```

| Field | Default | Meaning |
|---|---|---|
| `currency` | `CNY` | Selects the built-in price book and the symbol. |
| `peakPricing` | `auto` | `auto` applies the Beijing peak windows; `peak`/`offPeak` bill every call at one rate. |
| `offPeakDates` | `[]` | Extra statutory-holiday dates (`YYYY-MM-DD`, Beijing time) billed at the off-peak rate; 2026 is built in. |
| `prices` | `{}` | Per-model overrides in the configured currency, per 1M tokens. A key is a bare `model` for any provider route, or `provider/model` for one exact route. An entry replaces that model's whole price set; a `peak` block overrides only the fields it sets, and the rest fall back to the entry's base price. |

Overrides are how you track a promotional price, a self-hosted endpoint, or a provider the built-in book does not know. Prices and currency only affect presentation: changing them re-prices existing history, it does not rewrite it.

## Limits

- **Estimates, not invoices.** Promotions, negotiated rates, and the provider's own rounding are not modeled.
- **Future holiday years.** The built-in off-peak calendar covers 2026 only. A later year's statutory holidays must be added through `offPeakDates`, or its holiday weekdays are priced at the peak rate.
- **Subagents** are included. The control reads each descendant's projections on demand, so a child you never opened is no longer missing from the total; one that truly cannot be read (for example a session that was deleted) still appears as *not loaded*, and the total keeps its `+`. While a child is running, its share is the latest read and is refreshed when it settles. External or provider-managed children that never appear as Harness sessions cannot be counted.
- **Forks** inherit the parent's log, so a forked session's counter includes the spend that produced the inherited history — the same semantics as Harness's own token counter.
- **A boundary-straddling request** is billed at the period in which its assistant message settled.
- **Range totals read the store.** A session that never materialized is absent, the first query over a large history takes a moment, and the 35-day cache window bounds memory. The scope is this Harness home — every workspace and subagent session it stored; sessions from another `DSH_HOME` or another machine are not included, and unpriced third-party routes are counted as tokens but not as money.

## Keeping prices and holidays current

The price book and the holiday calendar are **static data in `lib/pricing.js`** — nothing is fetched at runtime, so the number you see never depends on the network.

| Change | What updates it |
|---|---|
| A model's price | A new release edits `PRICE_BOOKS`. Until then, override the model under `prices` — applied on the next composition, no plugin release needed. |
| A new model | Add a `prices` entry (`provider/model` or a bare `model`). |
| Next year's holidays | Add the dates to `offPeakDates`. Without them, a holiday weekday is priced at the peak rate. |
| Peak windows / billing buckets | A release: the windows are code, not configuration. |

The repository is the source of truth for both tables, so a data-only update is a one-file change plus a version bump. If you would rather not wait for a release, `prices` and `offPeakDates` cover every routine change immediately.

## Development

No build step and no runtime dependency is installed: the Host plugin imports `@deepseek-ai/schemastery` as a **peer**, which the Harness launcher resolves from the running installation.

```
index.js          Host plugin: Config schema + projection registration
lib/pricing.js    Pure pricing model, fold, and view (no Harness imports)
client.js         Web Client plugin: the dock control and its panel
locale/*.json     Plugin Manager display metadata
test/             Pricing and fold checks
```

```bash
npm test                     # 97 checks, no install needed
node --check index.js client.js lib/pricing.js
```

To try a checkout in a profile, install the directory itself:

```
plugin_manager  action=install_bundle  target=/absolute/path/to/dsh-api-cost
```

## License

MIT. The bundled prices are facts published by DeepSeek and are not a guarantee of what you will be billed.
