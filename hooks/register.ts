import type { Register } from 'claude-code'
import { add, bucketTimes, cells, COLORS, emptyTotals, fmt, receipt, receiptModel, split, toolLabel, turnLine, turnSegments } from './ledger'
import type { Span, Totals, TurnReport } from './ledger'

const MIN_LINE_MS = 3000
const PANE = 'time-blame'
const LINE_CELLS = 10

// Tools whose whole call is a person deciding, so their time is yours.
const USER_TOOLS: Record<string, string> = { AskUserQuestion: 'questions', ExitPlanMode: 'plan approval' }

type Open = { start: number; first: number; kind: 'step' } | { start: number; label: string; tool: string; kind: 'call' }

type Turn = {
  id: string
  start: number
  spans: Span[]
  open: Set<Open>
}

let turn: Turn | null = null
let totals: Totals = emptyTotals()
let paneOpened = false
// Reports by the turn's durationMs: the TurnDuration site carries the same
// number, which is how its redraw finds the turn it closes.
// A report waits here by duration until its closing line first draws, then
// moves to that line's message id, so it draws at one place only. A duration
// already waiting maps to null and the newer turn gets a log line instead.
const recent = new Map<number, TurnReport | null>()
const byMessage = new Map<string, TurnReport>()
const KEEP = 1000

function remember<K, V>(map: Map<K, V>, key: K, value: V) {
  map.set(key, value)
  if (map.size > KEEP) map.delete(map.keys().next().value as K)
}
const execs = new Map<string, { start: number; end: number }>()
const asks: Array<{ at: number; tool: string; claimed: boolean }> = []

function finish(t: Turn, end: number, durationMs: number, aborted: boolean) {
  for (const o of t.open) {
    if (o.kind === 'step') {
      if (o.first) t.spans.push({ kind: 'waiting', start: o.start, end: o.first, label: '' }, { kind: 'writing', start: o.first, end, label: '' })
      else t.spans.push({ kind: 'waiting', start: o.start, end, label: '' })
    } else t.spans.push({ kind: USER_TOOLS[o.tool] ? 'you' : 'tool', start: o.start, end, label: USER_TOOLS[o.tool] || o.label })
  }
  t.open.clear()
  const start = Math.min(t.start, end - durationMs)
  return split(t.spans, start, end, aborted)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    try {
      await $.command.register({ name: 'blame', description: 'Where this session\'s time went: Claude, tools, you' })
    } catch {}
    return r
  })

  on('command.run', { command: 'blame' }, async $ => {
    const surfaces = await $.session.surfaces()
    if (surfaces.length === 0) {
      for (const line of receipt(totals)) $.ui.log(line)
      return {}
    }
    const opened = await $.ui.open({ id: PANE, title: 'time-blame', focus: true, closeOnEscape: true })
    if (opened.isPlaced) paneOpened = true
    else for (const line of receipt(totals)) $.ui.log(line)
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const m = receiptModel(totals)
    if (!m) return Box({ flexDirection: 'column', children: [Text({ children: ['No finished turns yet in this session.'] }), Text({ dimColor: true, children: ['Esc closes this pane.'] })] })
    const width = Math.max(10, Math.min(60, (e.props.bodyColumns || 40) - 2))
    const bar = Text({ children: cells(m.times, width).map(b => Text({ color: COLORS[b], children: ['█'] })) })
    return Box({
      flexDirection: 'column',
      children: [
        Text({ children: [m.header] }),
        Text({ children: [' '] }),
        bar,
        Text({ children: [' '] }),
        ...m.rows.flatMap(r => [
          Text({ children: [Text({ color: COLORS[r.bucket], children: ['██ '] }), r.name.padEnd(8), Text({ weight: 'bold', children: [fmt(r.ms).padStart(7)] }), (r.pct + '%').padStart(6)] }),
          ...(r.note ? [Text({ dimColor: true, children: ['   ' + r.note] })] : []),
        ]),
        Text({ children: [' '] }),
        Text({ dimColor: true, children: ['Summed waits in this session, not server speed. Esc closes.'] }),
      ],
    })
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    let r = byMessage.get(e.requestId)
    if (!r) {
      const match = recent.get(e.props.durationMs)
      if (!match) return next(e)
      r = match
      recent.delete(e.props.durationMs)
      remember(byMessage, e.requestId, r)
    }
    const { Box, Text } = $.ui.resolve(e)
    const line = Text({
      children: [
        ...cells(bucketTimes(r), LINE_CELLS).map(b => Text({ color: COLORS[b], children: ['█'] })),
        ' ',
        Text({ dimColor: true, children: ['time-blame '] }),
        ...turnSegments(r).map(seg =>
          seg.bucket ? Text({ color: COLORS[seg.bucket], children: [seg.text] }) : seg.strong ? Text({ weight: 'bold', children: [seg.text] }) : seg.text,
        ),
      ],
    })
    return Box({ marginTop: 1, children: [line] })
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      totals = emptyTotals()
      turn = null
      recent.clear()
      byMessage.clear()
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      turn = { id: e.turnId, start: Date.now(), spans: [], open: new Set() }
      execs.clear()
      asks.length = 0
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const t = e.agentId === undefined && turn && turn.id === e.turnId ? turn : null
    if (!t) return yield* next(e)
    const o: Open = { kind: 'step', start: Date.now(), first: 0 }
    t.open.add(o)
    const gen = next(e)
    let done = false
    try {
      while (true) {
        const step = await gen.next()
        if (step.done) { done = true; return step.value }
        const kind = step.value.kind
        if (!o.first && (kind === 'text' || kind === 'thinking' || kind === 'tool')) o.first = Date.now()
        yield step.value
      }
    } finally {
      if (!done) await gen.return(undefined as never)
      if (t.open.delete(o)) {
        const end = Date.now()
        if (o.first) t.spans.push({ kind: 'waiting', start: o.start, end: o.first, label: '' }, { kind: 'writing', start: o.first, end, label: '' })
        else t.spans.push({ kind: 'waiting', start: o.start, end, label: '' })
      }
    }
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    const r = await next(e)
    if (turn) asks.push({ at: Date.now(), tool: e.tool_name, claimed: false })
    return r
  })

  on('classic.PostToolUse', async ($, e, next) => {
    const r = await next(e)
    if (typeof e.duration_ms === 'number') { const end = Date.now(); execs.set(e.tool_use_id, { start: end - e.duration_ms, end }) }
    return r
  })

  on('classic.PostToolUseFailure', async ($, e, next) => {
    const r = await next(e)
    if (typeof e.duration_ms === 'number') { const end = Date.now(); execs.set(e.tool_use_id, { start: end - e.duration_ms, end }) }
    return r
  })

  on('tool.call', async ($, e, next) => {
    const t = turn
    if (!t) return next(e)
    const o: Open = { kind: 'call', start: Date.now(), tool: e.tool, label: toolLabel(e.tool, e as { command?: unknown }) }
    const sub = e.agentId !== undefined
    if (!sub) t.open.add(o)
    try {
      return await next(e)
    } finally {
      const end = Date.now()
      const exec = execs.get(e.tool_use_id)
      execs.delete(e.tool_use_id)
      const ask = USER_TOOLS[e.tool] ? undefined : asks.find(a => !a.claimed && a.tool === e.tool && a.at >= o.start && a.at <= end)
      if (ask) {
        ask.claimed = true
        t.spans.push({ kind: 'you', start: ask.at, end: exec ? exec.start : end, label: 'approvals' })
      }
      if (!sub && t.open.delete(o)) {
        if (USER_TOOLS[e.tool]) t.spans.push({ kind: 'you', start: o.start, end, label: USER_TOOLS[e.tool] as string })
        else if (exec) t.spans.push({ kind: 'tool', start: exec.start, end: exec.end, label: o.label })
        else t.spans.push({ kind: 'tool', start: ask ? end : o.start, end, label: o.label })
      }
    }
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && turn && turn.id === e.turnId) {
      const report = finish(turn, Date.now(), e.durationMs, e.isAborted)
      turn = null
      totals = add(totals, report)
      if (paneOpened) $.ui.invalidate('ui.render')
      if (report.wall >= MIN_LINE_MS) {
        // A terminal-only session draws the line in place of "Worked for";
        // anywhere else, and for an interrupted turn, it is a log line.
        const surfaces = await $.session.surfaces()
        const terminalOnly = surfaces.length > 0 && surfaces.every(s => s === 'terminal')
        if (terminalOnly && !report.aborted) {
          if (recent.has(e.durationMs)) {
            recent.set(e.durationMs, null)
            $.ui.log(turnLine(report))
          } else {
            remember(recent, e.durationMs, report)
            $.ui.invalidate('ui.render')
          }
        } else $.ui.log(turnLine(report))
      }
    }
    return r
  })
}
