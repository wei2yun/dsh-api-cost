// Descendant-sum checks for the browser half of dsh-api-cost.
//
// The module under test is the shipped Web bundle: it registers itself on
// `window.__ModuleLoader__` instead of exporting ESM names. This file stands in
// for that loader, so the real `collectFamily`/`equalFamily` run under Node.
//
// Run: node test/family.test.mjs
let spec
globalThis.window = {
  __ModuleLoader__: {
    load(value) {
      spec = value
    },
  },
}

await import(new URL('../client.js', import.meta.url).href)

if (spec === undefined) throw new Error('client.js did not register a module')
const module = spec.factory((id) => (
  id === 'react' || id === 'react-dom' ? { createElement: () => null } : {}
))
const { collectFamily, equalFamily } = module.__internals

const failures = []
let checks = 0

function check(name, actual, expected) {
  checks += 1
  const ok = Object.is(actual, expected)
  if (!ok) failures.push(`${name}: expected ${String(expected)}, got ${String(actual)}`)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${String(actual)}`)
}

function deep(name, actual, expected) {
  checks += 1
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`)
}

const ZERO = { total: 0, tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } }

/** A wire-shaped `apiCost` view for one Session. */
function view({ total = 0, input = 0, cacheRead = 0, cacheWrite = 0, output = 0, inherited = ZERO } = {}) {
  return {
    total,
    peakCost: 0,
    offPeakCost: total,
    unpriced: false,
    tokens: { input, cacheRead, cacheWrite, output },
    inherited,
  }
}

/** One session-list snapshot row. */
function row(extra) {
  return { id: extra.id, blank: false, running: false, updatedAt: 0, ...extra }
}

// No descendants at all.
const empty = collectFamily({ byId: { p: row({ id: 'p' }) } }, 'p')
check('empty count', empty.count, 0)
check('empty missing', empty.missing, 0)
check('empty cost', empty.cost, 0)
check('empty state key', empty.stateKey, '')

// One settled child, one still-running child the list never folded.
const twoChildren = {
  byId: {
    p: row({ id: 'p' }),
    c1: row({
      id: 'c1', origin: 'subagent', parentId: 'p',
      projectionValues: { apiCost: view({ total: 0.5, input: 1000, output: 500 }) },
    }),
    c2: row({ id: 'c2', origin: 'subagent', parentId: 'p', running: true }),
  },
}
const partial = collectFamily(twoChildren, 'p')
check('counts descendants', partial.count, 2)
check('one child unread', partial.missing, 1)
check('one child running', partial.running, 1)
check('sums the read child', partial.cost, 0.5)
check('sums its tokens', partial.tokens.input, 1000)
check('sums its output', partial.tokens.output, 500)
deep('states describe each child', partial.states, [
  { id: 'c1', running: false, loaded: true },
  { id: 'c2', running: true, loaded: false },
])
check('state key covers loaded/running', partial.stateKey, 'c1:0:1,c2:1:0')

// The same child settles: its value arrives and the running flag drops.
const settled = {
  byId: {
    ...twoChildren.byId,
    c2: row({
      id: 'c2', origin: 'subagent', parentId: 'p',
      projectionValues: { apiCost: view({ total: 0.25, input: 200 }) },
    }),
  },
}
const complete = collectFamily(settled, 'p')
check('nothing left unread', complete.missing, 0)
check('nothing running', complete.running, 0)
check('total includes both', complete.cost, 0.75)
check('state key follows the change', complete.stateKey, 'c1:0:1,c2:0:1')

// Nested descendants count too: a grandchild belongs to the conversation.
const nested = collectFamily({
  byId: {
    p: row({ id: 'p' }),
    c1: row({ id: 'c1', origin: 'subagent', parentId: 'p', projectionValues: { apiCost: view({ total: 0.5 }) } }),
    g1: row({ id: 'g1', origin: 'subagent', parentId: 'c1', projectionValues: { apiCost: view({ total: 0.1 }) } }),
  },
}, 'p')
check('nested count', nested.count, 2)
check('nested cost', nested.cost, 0.6)

// A forked child inherits its parent's log; only its own spend is added.
const forked = collectFamily({
  byId: {
    p: row({ id: 'p' }),
    c1: row({
      id: 'c1', origin: 'subagent', parentId: 'p',
      projectionValues: {
        apiCost: view({
          total: 1, input: 1000, output: 100,
          inherited: { total: 0.4, tokens: { input: 400, cacheRead: 0, cacheWrite: 0, output: 40 } },
        }),
      },
    }),
  },
}, 'p')
check('fork adds only its own cost', forked.cost.toFixed(6), '0.600000')
check('fork adds only its own input', forked.tokens.input, 600)
check('fork adds only its own output', forked.tokens.output, 60)

// Other sessions' children are not this conversation's family.
const unrelated = collectFamily({
  byId: {
    p: row({ id: 'p' }),
    x: row({ id: 'x' }),
    cx: row({ id: 'cx', origin: 'subagent', parentId: 'x', projectionValues: { apiCost: view({ total: 9 }) } }),
  },
}, 'p')
check('unrelated subtree ignored', unrelated.count, 0)

// The selector must re-render when a child starts or stops running.
check('equal ignores identical families', equalFamily(partial, collectFamily(twoChildren, 'p')), true)
const stopped = {
  byId: { ...twoChildren.byId, c2: row({ id: 'c2', origin: 'subagent', parentId: 'p' }) },
}
check('running change breaks equality', equalFamily(partial, collectFamily(stopped, 'p')), false)

// Wiring: apply() must hand the control a reader that asks the session
// controller for a descendant's projections, and the reader must forward the
// force flag so a settled child is read again.
const reads = []
const registrations = new Map()
const fakeCtx = {
  effect(fn) {
    fn()
  },
  locale: { register() {} },
  get: (name) => (name === 'sessions'
    ? { manager: { projectionLoads: new Map(), refreshProjections: (id) => reads.push(id) } }
    : undefined),
  slots: {
    inject(name, factory) {
      for (const value of factory()) registrations.set(value.name, value)
    },
    register(definition) {
      return definition
    },
  },
}
module.apply(fakeCtx)
const dock = registrations.get('conversation.composer.dock')
check('registers on the composer dock', dock?.name, 'conversation.composer.dock')
check('sits after the built-in controls', dock?.order, 2)
check('registers a turn-tail entry', registrations.get('conversation.chat.turnTail')?.order, 10)
const injected = dock.inject()
check('reader is injected', typeof injected.loadProjections, 'function')
injected.loadProjections('c1')
injected.loadProjections('c2', { force: true })
deep('reader asks for each descendant', reads, ['c1', 'c2'])

console.log(`\n${checks} checks, ${failures.length} failure(s)`)
process.exit(failures.length === 0 ? 0 : 1)
