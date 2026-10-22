/**
 * API cost meter — browser half.
 *
 * Adds one ambient control below the composer that shows what this session's
 * settled model calls cost, priced by the Host from the exact provider-reported
 * token usage. Opening the control shows the per-model breakdown and the price
 * periods behind it.
 *
 * The value arrives already computed as the `apiCost` session projection, so
 * this module never folds Session events, reads another plugin's DOM, or
 * imports a Harness Client package.
 *
 * @module dsh-api-cost/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-api-cost',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'api-cost'

    /** Stylesheet tag identity, so a reload replaces rather than duplicates it. */
    const CSS_TAG = 'dsh-api-cost/api-cost.css'

    const ZH = {
      'pill.aria': 'API 花费 {cost}，查看明细',
      'pill.title': '本会话 API 花费',
      'pill.titlePending': '本会话 API 花费（{count} 个子会话的费用尚未载入）',
      'pill.unpriced': '未配置价目',
      'dialog.title': 'API 花费',
      'dialog.tokens': '输入 {input} · 缓存命中 {cache} · 输出 {output}',
      'dialog.cacheHit': '缓存命中率 {percent}%',
      'dialog.subagents': '子智能体 ×{count}',
      'dialog.subagentsRunning': '子智能体仍在运行，费用为暂估值',
      'dialog.subagentsMissing': '{count} 个子会话的费用尚未载入',
      'dialog.subagentsUnpriced': '部分子会话未配置价目',
      'dialog.split': '高峰 {peak} · 空闲 {offPeak}',
      'dialog.peakFixed': '全部调用按高峰价计价',
      'dialog.offPeakFixed': '全部调用按空闲价计价',
      'dialog.unpriced': '未配置价目：{route}',
      'dialog.note': '按 DeepSeek 官方价目估算，实际扣费以账单为准。',
      'dialog.empty': '本会话尚未产生计费用量。',
      'range.session': '本会话',
      'range.today': '今天',
      'range.24h': '近24小时',
      'range.7d': '近7天',
      'range.30d': '近30天',
      'range.loading': '统计中…',
      'range.error': '无法读取时间范围统计',
      'range.scope': '整机 · {count} 个会话（含子智能体）',
      'range.failed': '{count} 个会话读取失败',
      'turn.label': '本轮 {cost}',
      'turn.title': '本轮的 API 花费 {cost}',
    }

    const EN = {
      'pill.aria': 'API cost {cost}, show details',
      'pill.title': 'Estimated API cost of this session',
      'pill.titlePending': 'Estimated API cost of this session ({count} subagent session(s) still loading)',
      'pill.unpriced': 'No price configured',
      'dialog.title': 'API cost',
      'dialog.tokens': 'Input {input} · Cache hit {cache} · Output {output}',
      'dialog.cacheHit': 'Cache hit rate {percent}%',
      'dialog.subagents': 'Subagents ×{count}',
      'dialog.subagentsRunning': 'A subagent is still running; its share is provisional',
      'dialog.subagentsMissing': 'Cost of {count} subagent session(s) not loaded yet',
      'dialog.subagentsUnpriced': 'Some subagent sessions have no configured price',
      'dialog.split': 'Peak {peak} · Off-peak {offPeak}',
      'dialog.peakFixed': 'Every call billed at the peak rate',
      'dialog.offPeakFixed': 'Every call billed at the off-peak rate',
      'dialog.unpriced': 'No price configured: {route}',
      'dialog.note': 'Estimated from DeepSeek list prices; the invoice is authoritative.',
      'dialog.empty': 'This session has no billable usage yet.',
      'range.session': 'This chat',
      'range.today': 'Today',
      'range.24h': 'Last 24h',
      'range.7d': 'Last 7 days',
      'range.30d': 'Last 30 days',
      'range.loading': 'Calculating…',
      'range.error': 'Could not read the range total',
      'range.scope': 'Whole machine · {count} sessions (subagents included)',
      'range.failed': '{count} session(s) could not be read',
      'turn.label': '{cost} this turn',
      'turn.title': 'API cost of this turn: {cost}',
    }

    const CSS = [
      '.apicost-anchor{min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);',
      'line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));display:inline-flex}',
      '.apicost-pill{box-sizing:border-box;border-radius:var(--dsw-radius-sm);max-width:100%;',
      'color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;',
      'line-height:inherit;white-space:nowrap;background:0 0;border:none;align-items:center;gap:6px;',
      'padding:1px 8px;display:inline-flex;cursor:pointer}',
      '.apicost-pill svg{flex:none;width:14px;height:14px}',
      '.apicost-pill:hover,.apicost-pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);',
      'color:var(--dsw-alias-label-secondary)}',
      '.apicost-label{text-overflow:ellipsis;min-width:0;overflow:hidden}',
      '.apicost-panel{max-height:min(70vh,460px);overflow-y:auto;overscroll-behavior:contain;z-index:1100;box-sizing:border-box;border-radius:var(--dsw-radius-lg);',
      'background:var(--dsw-specific-menu);width:max-content;min-width:min(300px,100vw - 24px);',
      'max-width:min(420px,100vw - 24px);backdrop-filter:var(--dsw-menu-backdrop-filter);',
      '--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);',
      'color:var(--dsw-alias-label-secondary);cursor:default;border:0;padding:16px;font-size:12px;',
      'line-height:18px;position:fixed;text-align:left}',
      '.apicost-title{color:var(--dsw-alias-label-primary);justify-content:space-between;gap:16px;',
      'margin-bottom:8px;font-weight:500;display:flex}',
      '.apicost-title-label{align-items:center;gap:6px;min-width:0;display:inline-flex}',
      '.apicost-title-label svg{flex:none;width:14px;height:14px}',
      '.apicost-title-value{font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.apicost-rule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}',
      '.apicost-route{display:flex;flex-direction:column;gap:2px}',
      '.apicost-route+.apicost-route{margin-top:10px}',
      '.apicost-route-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px}',
      '.apicost-route-name{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.apicost-route-cost{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;',
      'white-space:nowrap}',
      '.apicost-route-meta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;',
      'font-variant-numeric:tabular-nums}',
      '.apicost-note{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin-top:10px}',
      '.apicost-note+.apicost-note{margin-top:4px}',
      '.apicost-empty{color:var(--dsw-alias-label-tertiary)}',
      '.apicost-ranges{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}',
      '.apicost-turn{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-tertiary);',
      'font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.apicost-turn svg{flex:none;width:14px;height:14px}',
      '.apicost-range{box-sizing:border-box;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);',
      'font:inherit;font-size:11px;line-height:16px;padding:2px 8px;background:0 0;border:none;cursor:pointer}',
      '.apicost-range:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.apicost-range[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
    ].join('')

    /** Selectable windows: this conversation or a time range over every session. */
    const RANGES = ['session', 'today', '24h', '7d', '30d']

    /** Unplaced portal panel: laid out but invisible while it measures itself. */
    const MEASURE_STYLE = { visibility: 'hidden', left: 0, top: 0 }

    /** Distance kept from the viewport edge. */
    const PANEL_MARGIN = 12

    /** Distance between the trigger and the panel. */
    const PANEL_GAP = 8

    /** Resolve the active dictionary without the slot's locale binding. */
    function fallbackT() {
      const language = typeof navigator === 'object' && navigator !== null
        ? String(navigator.language ?? 'en').toLowerCase()
        : 'en'
      const dictionary = language.startsWith('zh') ? ZH : EN
      return (key, params) => {
        const template = dictionary[key] ?? EN[key] ?? key
        if (params === undefined) return template
        return template.replace(/\{(\w+)\}/g, (match, name) => (
          params[name] === undefined ? match : String(params[name])
        ))
      }
    }

    /** Format a token count compactly: 987, 12.3k, 1.24M. */
    function formatCount(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '0'
      if (value < 1000) return String(Math.round(value))
      if (value < 1000000) {
        const thousands = value / 1000
        return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k`
      }
      return `${(value / 1000000).toFixed(2)}M`
    }

    /** Format money with a precision that keeps small sessions readable. */
    function formatMoney(symbol, value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${symbol}—`
      if (value <= 0) return `${symbol}0`
      const magnitude = Math.abs(value)
      if (magnitude < 0.0001) return `${symbol}<0.0001`
      if (magnitude < 0.01) return `${symbol}${value.toFixed(4)}`
      if (magnitude < 1) return `${symbol}${value.toFixed(3)}`
      return `${symbol}${value.toFixed(2)}`
    }

    /** A small receipt glyph matching the host's 14px control icons. */
    function ReceiptIcon() {
      return h('svg', {
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
      },
        h('path', { d: 'M4 2.25h8v11.5l-2-1.15-2 1.15-2-1.15-2 1.15z' }),
        h('path', { d: 'M6.1 5.4h3.8M6.1 8.4h3.8' })
      )
    }

    /**
     * Place the portaled panel above the trigger, clamped to the viewport.
     * @returns `{ left, top }`, or null until the first measurement.
     */
    function usePanelPosition(open, anchorRef, panelRef) {
      const [position, setPosition] = React.useState(null)
      const place = React.useCallback(() => {
        const anchor = anchorRef.current
        const panel = panelRef.current
        if (anchor === null || panel === null) return
        const rect = anchor.getBoundingClientRect()
        const width = panel.offsetWidth
        const height = panel.offsetHeight
        const maxLeft = Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN)
        const left = Math.min(Math.max(PANEL_MARGIN, rect.left), maxLeft)
        let top = rect.top - height - PANEL_GAP
        if (top < PANEL_MARGIN) {
          top = Math.min(
            rect.bottom + PANEL_GAP,
            Math.max(PANEL_MARGIN, window.innerHeight - height - PANEL_MARGIN)
          )
        }
        setPosition({ left: Math.round(left), top: Math.round(top) })
      }, [anchorRef, panelRef])
      React.useLayoutEffect(() => {
        if (!open) {
          setPosition(null)
          return
        }
        place()
      }, [open, place])
      React.useEffect(() => {
        if (!open) return undefined
        const reposition = () => place()
        window.addEventListener('resize', reposition)
        window.addEventListener('scroll', reposition, true)
        return () => {
          window.removeEventListener('resize', reposition)
          window.removeEventListener('scroll', reposition, true)
        }
      }, [open, place])
      return position
    }

    /** Close the panel on Escape or on a pointer press outside trigger and panel. */
    function useDismiss(open, setOpen, anchorRef, panelRef) {
      React.useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        const onPointerDown = (event) => {
          const target = event.target
          if (!(target instanceof Node)) return
          if (anchorRef.current?.contains(target) === true) return
          if (panelRef.current?.contains(target) === true) return
          setOpen(false)
        }
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown)
          document.removeEventListener('pointerdown', onPointerDown, true)
        }
      }, [open, setOpen, anchorRef, panelRef])
    }

    /** No descendants: a frozen constant so the selector can bail out by identity. */
    const EMPTY_FAMILY = Object.freeze({
      count: 0,
      missing: 0,
      running: 0,
      cost: 0,
      peakCost: 0,
      offPeakCost: 0,
      unpriced: false,
      tokens: Object.freeze({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }),
      states: Object.freeze([]),
      stateKey: '',
    })

    /**
     * Sum every subagent descendant of one Session from the session-list
     * projections. The list carries each Session's already-computed `apiCost`,
     * so the family total follows child frames live without re-folding logs.
     * A forked child inherits its parent's log; subtracting its `inherited`
     * share counts only what the fork itself spent.
     *
     * A descendant whose `apiCost` the list never served is reported through
     * `missing` and `states`; the control reads those on demand instead of
     * pretending the conversation cost less than it did.
     *
     * @param snapshot - session-list snapshot (`byId` rows with `projectionValues`).
     * @param sessionId - the viewed Session.
     * @returns summed descendants, with `missing` counting rows without a value.
     */
    function collectFamily(snapshot, sessionId) {
      const family = {
        count: 0,
        missing: 0,
        running: 0,
        cost: 0,
        peakCost: 0,
        offPeakCost: 0,
        unpriced: false,
        tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
        states: [],
        stateKey: '',
      }
      if (sessionId === undefined || snapshot === null || typeof snapshot !== 'object') return family
      const byId = snapshot.byId
      if (byId === null || typeof byId !== 'object') return family
      const childrenOf = new Map()
      for (const id of Object.keys(byId)) {
        const row = byId[id]
        if (row === null || typeof row !== 'object') continue
        if (row.origin !== 'subagent' || row.parentId === undefined) continue
        const group = childrenOf.get(row.parentId)
        if (group === undefined) childrenOf.set(row.parentId, [id])
        else group.push(id)
      }
      if (childrenOf.size === 0) return family
      const seen = new Set([sessionId])
      const queue = [sessionId]
      while (queue.length > 0) {
        const parent = queue.pop()
        for (const childId of childrenOf.get(parent) ?? []) {
          if (seen.has(childId)) continue
          seen.add(childId)
          queue.push(childId)
          family.count += 1
          const row = byId[childId] ?? {}
          const view = row.projectionValues?.apiCost
          const running = row.running === true
          if (running) family.running += 1
          if (view === null || typeof view !== 'object') {
            family.missing += 1
            family.states.push({ id: childId, running, loaded: false })
            continue
          }
          family.states.push({ id: childId, running, loaded: true })
          const inherited = view.inherited ?? {}
          const childTokens = view.tokens ?? {}
          const inheritedTokens = inherited.tokens ?? {}
          family.tokens.input += Math.max(0, (childTokens.input ?? 0) - (inheritedTokens.input ?? 0))
          family.tokens.cacheRead += Math.max(0, (childTokens.cacheRead ?? 0) - (inheritedTokens.cacheRead ?? 0))
          family.tokens.cacheWrite += Math.max(0, (childTokens.cacheWrite ?? 0) - (inheritedTokens.cacheWrite ?? 0))
          family.tokens.output += Math.max(0, (childTokens.output ?? 0) - (inheritedTokens.output ?? 0))
          family.cost += Math.max(0, (view.total ?? 0) - (inherited.total ?? 0))
          family.peakCost += Math.max(0, (view.peakCost ?? 0) - (inherited.peakCost ?? 0))
          family.offPeakCost += Math.max(0, (view.offPeakCost ?? 0) - (inherited.offPeakCost ?? 0))
          if (view.unpriced === true) family.unpriced = true
        }
      }
      family.stateKey = family.states
        .map((state) => `${state.id}:${state.running ? 1 : 0}:${state.loaded ? 1 : 0}`)
        .sort()
        .join(',')
      return family
    }

    /** Value equality so the list selector does not re-render on unrelated sessions. */
    function equalFamily(left, right) {
      return left.count === right.count
        && left.missing === right.missing
        && left.running === right.running
        && left.cost === right.cost
        && left.peakCost === right.peakCost
        && left.offPeakCost === right.offPeakCost
        && left.unpriced === right.unpriced
        && left.stateKey === right.stateKey
        && left.tokens.input === right.tokens.input
        && left.tokens.cacheRead === right.tokens.cacheRead
        && left.tokens.cacheWrite === right.tokens.cacheWrite
        && left.tokens.output === right.tokens.output
    }

    /** Subscribe to the family total; absent list hooks degrade to no descendants. */
    function useFamily(useSessions, sessionId) {
      if (typeof useSessions !== 'function') return EMPTY_FAMILY
      return useSessions((snapshot) => collectFamily(snapshot, sessionId), equalFamily)
    }

    /**
     * Read each descendant's cost once per state instead of waiting for the
     * user to open that conversation.
     *
     * The session list only carries a descendant's `apiCost` once some read has
     * produced it — a cold listing is as complete as its checkpoint, and a
     * freshly spawned child has no checkpoint yet. A child that is still
     * running is read again when it settles, because its mid-run value is a
     * snapshot the list never advances on its own.
     *
     * @param load - host-provided reader, absent in compositions without it.
     * @param family - descendant states from {@link collectFamily}.
     * @param sessionId - the viewed Session; changing it resets the record.
     */
    function useDescendantCosts(load, family, sessionId) {
      const reads = React.useMemo(() => new Map(), [sessionId])
      React.useEffect(() => {
        if (typeof load !== 'function') return
        for (const child of family.states) {
          const target = child.running ? 'running' : 'idle'
          const previous = reads.get(child.id)
          if (previous === target) continue
          // A value the list already served for an idle child is final.
          if (previous === undefined && child.loaded && target === 'idle') {
            reads.set(child.id, target)
            continue
          }
          reads.set(child.id, target)
          load(child.id, { force: previous === 'running' })
        }
      }, [family.stateKey, load, reads])
    }

    /**
     * One ambient cost control: this Session plus every subagent it delegated.
     * @param props - Slot standard props plus the bound `t` seat.
     */
    function ApiCostPill(props) {
      const useProjection = props.useProjection
      const t = typeof props.t === 'function' ? props.t : fallbackT()
      const own = typeof useProjection === 'function' ? useProjection('apiCost') : undefined
      const family = useFamily(props.useSessions, props.sessionId)
      const [open, setOpen] = React.useState(false)
      const [range, setRange] = React.useState('session')
      const [remote, setRemote] = React.useState({ state: 'idle' })
      const anchorRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const position = usePanelPosition(open, anchorRef, panelRef)
      useDismiss(open, setOpen, anchorRef, panelRef)
      useDescendantCosts(props.loadProjections, family, props.sessionId)

      React.useEffect(() => {
        if (!open || range === 'session') return undefined
        const controller = new AbortController()
        let alive = true
        setRemote({ state: 'loading' })
        fetch(`/plugins/api-cost/window?range=${encodeURIComponent(range)}`, { signal: controller.signal })
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
          .then((value) => {
            if (alive) setRemote({ state: 'ready', value })
          })
          .catch((error) => {
            if (alive && error?.name !== 'AbortError') setRemote({ state: 'error' })
          })
        return () => {
          alive = false
          controller.abort()
        }
      }, [open, range])

      const ownView = own !== null && typeof own === 'object' ? own : undefined
      const ownTokens = ownView?.tokens ?? { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
      const tokens = {
        input: (ownTokens.input ?? 0) + family.tokens.input,
        cacheRead: (ownTokens.cacheRead ?? 0) + family.tokens.cacheRead,
        cacheWrite: (ownTokens.cacheWrite ?? 0) + family.tokens.cacheWrite,
        output: (ownTokens.output ?? 0) + family.tokens.output,
      }
      const promptTokens = tokens.input + tokens.cacheRead + tokens.cacheWrite
      if (promptTokens + tokens.output <= 0) return null

      const symbol = typeof ownView?.symbol === 'string' ? ownView.symbol : '¥'
      const total = (typeof ownView?.total === 'number' ? ownView.total : 0) + family.cost
      const peakCost = (typeof ownView?.peakCost === 'number' ? ownView.peakCost : 0) + family.peakCost
      const offPeakCost = (typeof ownView?.offPeakCost === 'number' ? ownView.offPeakCost : 0) + family.offPeakCost
      const pricedTotal = peakCost + offPeakCost
      const routes = Array.isArray(ownView?.routes) ? ownView.routes : []
      const unpricedOwn = routes.filter((route) => route.priced === false)
      const cacheHitPercent = promptTokens === 0
        ? null
        : Math.round((tokens.cacheRead / promptTokens) * 1000) / 10
      // A '+' means the total is a floor: a descendant is still unread or running.
      const provisional = family.missing > 0 || family.running > 0
      const money = formatMoney(symbol, total)
      const label = total > 0
        ? (provisional ? `${money}+` : money)
        : t('pill.unpriced')
      const title = family.missing > 0
        ? t('pill.titlePending', { count: family.missing })
        : t('pill.title')

      const routesView = routes.map((route) => {
        const bucket = route.tokens ?? {}
        const cost = route.priced ? formatMoney(symbol, route.cost) : t('pill.unpriced')
        return h('div', { className: 'apicost-route', key: route.key ?? `${route.provider}/${route.model}` },
          h('div', { className: 'apicost-route-head' },
            h('span', { className: 'apicost-route-name' }, route.label ?? route.model ?? ''),
            h('span', { className: 'apicost-route-cost' }, cost)
          ),
          h('div', { className: 'apicost-route-meta' }, t('dialog.tokens', {
            input: formatCount(bucket.input),
            cache: formatCount((bucket.cacheRead ?? 0) + (bucket.cacheWrite ?? 0)),
            output: formatCount(bucket.output),
          }))
        )
      })

      const familyRow = family.count === 0 ? null : h('div', { className: 'apicost-route', key: 'subagents' },
        h('div', { className: 'apicost-route-head' },
          h('span', { className: 'apicost-route-name' }, t('dialog.subagents', { count: family.count })),
          h('span', { className: 'apicost-route-cost' }, family.cost > 0 ? formatMoney(symbol, family.cost) : '—')
        ),
        h('div', { className: 'apicost-route-meta' }, t('dialog.tokens', {
          input: formatCount(family.tokens.input),
          cache: formatCount(family.tokens.cacheRead + family.tokens.cacheWrite),
          output: formatCount(family.tokens.output),
        }))
      )

      const periodNote = ownView?.peakPricing === 'auto'
        ? (pricedTotal > 0
            ? t('dialog.split', {
                peak: formatMoney(symbol, peakCost),
                offPeak: formatMoney(symbol, offPeakCost),
              })
            : null)
        : (ownView?.peakPricing === 'peak' || ownView?.peakPricing === 'offPeak'
            ? t(ownView.peakPricing === 'peak' ? 'dialog.peakFixed' : 'dialog.offPeakFixed')
            : null)

      const sessionNotes = [
        routesView.length > 0
          ? h('div', { className: 'apicost-routes', key: 'routes' }, routesView)
          : (family.count === 0
              ? h('div', { className: 'apicost-empty', key: 'empty' }, t('dialog.empty'))
              : null),
        familyRow,
        cacheHitPercent === null
          ? null
          : h('div', { className: 'apicost-note', key: 'hit' }, t('dialog.cacheHit', { percent: cacheHitPercent })),
        unpricedOwn.length === 0
          ? null
          : h('div', { className: 'apicost-note', key: 'unpriced' },
              t('dialog.unpriced', { route: unpricedOwn.map((route) => route.key).join(', ') })),
        family.unpriced
          ? h('div', { className: 'apicost-note', key: 'unpriced-family' }, t('dialog.subagentsUnpriced'))
          : null,
        family.missing === 0
          ? null
          : h('div', { className: 'apicost-note', key: 'missing' },
              t('dialog.subagentsMissing', { count: family.missing })),
        family.running === 0
          ? null
          : h('div', { className: 'apicost-note', key: 'running' }, t('dialog.subagentsRunning')),
        periodNote === null ? null : h('div', { className: 'apicost-note', key: 'period' }, periodNote),
        h('div', { className: 'apicost-note', key: 'note' }, t('dialog.note')),
      ]

      const rangeValue = remote.state === 'ready' ? remote.value : undefined
      const rangeNotes = rangeValue === undefined
        ? [h('div', { className: 'apicost-empty', key: 'state' },
            remote.state === 'error' ? t('range.error') : t('range.loading'))]
        : [
            h('div', { className: 'apicost-route', key: 'tokens' },
              h('div', { className: 'apicost-route-meta' }, t('dialog.tokens', {
                input: formatCount(rangeValue.tokens?.input),
                cache: formatCount((rangeValue.tokens?.cacheRead ?? 0) + (rangeValue.tokens?.cacheWrite ?? 0)),
                output: formatCount(rangeValue.tokens?.output),
              }))),
            rangeValue.cacheHitPercent === null || rangeValue.cacheHitPercent === undefined
              ? null
              : h('div', { className: 'apicost-note', key: 'hit' },
                  t('dialog.cacheHit', { percent: rangeValue.cacheHitPercent })),
            rangeValue.unpriced === true
              ? h('div', { className: 'apicost-note', key: 'unpriced' }, t('dialog.subagentsUnpriced'))
              : null,
            h('div', { className: 'apicost-note', key: 'scope' },
              t('range.scope', { count: rangeValue.sessions })),
            rangeValue.failed > 0
              ? h('div', { className: 'apicost-note', key: 'failed' },
                  t('range.failed', { count: rangeValue.failed }))
              : null,
          ]

      const titleValue = range === 'session'
        ? (total > 0 ? money : t('pill.unpriced'))
        : (rangeValue === undefined
            ? (remote.state === 'error' ? '—' : '…')
            : formatMoney(symbol, rangeValue.total))

      const panel = h('div', {
        ref: panelRef,
        className: 'apicost-panel',
        role: 'dialog',
        'aria-label': t('dialog.title'),
        style: position ?? MEASURE_STYLE,
      },
        h('div', { className: 'apicost-title' },
          h('span', { className: 'apicost-title-label' }, ReceiptIcon(), t('dialog.title')),
          h('span', { className: 'apicost-title-value' }, titleValue)
        ),
        h('div', { className: 'apicost-rule', 'aria-hidden': true }),
        h('div', { className: 'apicost-ranges', role: 'group' },
          RANGES.map((id) => h('button', {
            key: id,
            type: 'button',
            className: 'apicost-range',
            'aria-pressed': range === id,
            onClick: () => setRange(id),
          }, t('range.' + id)))),
        range === 'session' ? sessionNotes : rangeNotes
      )

      return h('span', {
        ref: anchorRef,
        className: 'apicost-anchor',
        'data-composer-stat': 'api-cost',
      },
        h('button', {
          type: 'button',
          className: 'apicost-pill',
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-label': t('pill.aria', { cost: label }),
          title,
          onClick: () => setOpen(!open),
        },
          ReceiptIcon(),
          h('span', { className: 'apicost-label' }, label)
        ),
        open ? ReactDOM.createPortal(panel, document.body) : null
      )
    }

    /**
     * Ask the Session controller to fold one descendant's projections without
     * opening it. A `force` read re-seeds a child whose stored value is only a
     * mid-run snapshot, which the controller's own one-shot load tracking would
     * otherwise skip.
     *
     * The controller owns the read, its retry policy, and its failures; this
     * only asks, so a composition without that service keeps the panel's
     * "not loaded yet" note instead of breaking the control.
     */
    function requestDescendantProjections(ctx, sessionId, options = {}) {
      const manager = ctx.get('sessions')?.manager
      if (manager === undefined || typeof manager.refreshProjections !== 'function') return
      try {
        if (options.force === true && manager.projectionLoads instanceof Map) {
          manager.projectionLoads.delete(sessionId)
        }
        void manager.refreshProjections(sessionId)
      } catch {
        // Best effort: the panel keeps reporting the unloaded share.
      }
    }

    /**
     * One completed turn's cost, rendered in the turn footer beside the chat's
     * own token-usage entry. The value comes from the session projection's
     * per-turn table, so it follows the same prices as the panel.
     */
    function TurnCost(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT()
      const useProjection = props.useProjection
      const turn = props.turn?.turn
      // Select only the formatted cost: a primitive keeps every other turn row
      // from re-rendering whenever the projection advances.
      const cost = typeof useProjection === 'function'
        ? useProjection('apiCost', (value) => {
            if (value === null || typeof value !== 'object') return undefined
            if (typeof turn !== 'number' || !Array.isArray(value.turns)) return undefined
            const entry = value.turns.find((row) => row.turn === turn)
            if (entry === undefined || !(entry.cost > 0)) return undefined
            return formatMoney(typeof value.symbol === 'string' ? value.symbol : '¥', entry.cost)
          })
        : undefined
      if (cost === undefined) return null
      return h('span', {
        className: 'apicost-turn',
        title: t('turn.title', { cost }),
      }, ReceiptIcon(), h('span', null, t('turn.label', { cost })))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'api-cost: dictionaries')
        ctx.effect(() => {
          if (typeof document === 'undefined') return undefined
          let tag = document.querySelector(`style[data-plugin-css="${CSS_TAG}"]`)
          if (tag === null) {
            tag = document.createElement('style')
            tag.dataset.plugin = 'dsh-api-cost'
            tag.dataset.pluginCss = CSS_TAG
            tag.textContent = CSS
            document.head.appendChild(tag)
          }
          return () => {
            tag?.remove()
          }
        }, 'api-cost: styles')
        ctx.slots.inject('conversation.composer.dock', function* () {
          yield ctx.slots.register({
            name: 'conversation.composer.dock',
            id: 'api-cost',
            order: 2,
            locale: NS,
            inject: () => ({
              loadProjections: (sessionId, options) => requestDescendantProjections(ctx, sessionId, options),
            }),
          }, ApiCostPill)
        })
        ctx.slots.inject('conversation.chat.turnTail', function* () {
          yield ctx.slots.register({
            name: 'conversation.chat.turnTail',
            id: 'api-cost',
            order: 10,
            locale: NS,
          }, TurnCost)
        })
      },
      /** Pure helpers exposed for the offline test file; not part of the plugin contract. */
      __internals: { collectFamily, equalFamily },
    }
  },
})
