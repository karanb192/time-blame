export type Kind = 'you' | 'tool' | 'writing' | 'waiting'

export type Span = { kind: Kind; start: number; end: number; label: string }

export type TurnReport = {
  wall: number
  aborted: boolean
  waiting: number
  writing: number
  you: number
  other: number
  tools: Record<string, number>
  youBy: Record<string, number>
}

// When spans overlap, the earlier kind in this list owns the time. A tool
// started while Claude is still streaming is the tool's time; a dialog open
// while a tool is running is yours.
const PRIORITY: Kind[] = ['you', 'tool', 'writing', 'waiting']

export const PARALLEL = 'parallel tools'

export function split(spans: Span[], start: number, end: number, aborted = false): TurnReport {
  const report: TurnReport = { wall: Math.max(0, end - start), aborted, waiting: 0, writing: 0, you: 0, other: 0, tools: {}, youBy: {} }
  const clipped = spans
    .map(s => ({ ...s, start: Math.max(s.start, start), end: Math.min(s.end, end) }))
    .filter(s => s.end > s.start)
  const cuts = new Set<number>([start, end])
  for (const s of clipped) { cuts.add(s.start); cuts.add(s.end) }
  const points = [...cuts].sort((a, b) => a - b)
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as number, b = points[i + 1] as number, len = b - a
    const over = clipped.filter(s => s.start <= a && s.end >= b)
    const kind = PRIORITY.find(k => over.some(s => s.kind === k))
    if (!kind) { report.other += len; continue }
    if (kind === 'tool') {
      const labels = new Set(over.filter(s => s.kind === 'tool').map(s => s.label))
      const label = labels.size === 1 ? [...labels][0] as string : PARALLEL
      report.tools[label] = (report.tools[label] || 0) + len
    } else if (kind === 'you') {
      const label = over.find(s => s.kind === 'you')!.label
      report.you += len
      report.youBy[label] = (report.youBy[label] || 0) + len
    } else report[kind] += len
  }
  return report
}

export function toolTotal(r: { tools: Record<string, number> }): number {
  return Object.values(r.tools).reduce((a, b) => a + b, 0)
}

export function fmt(ms: number): string {
  if (ms < 10_000) return (Math.round(ms / 100) / 10).toFixed(1) + 's'
  const s = Math.round(ms / 1000)
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0') + 's'
  return Math.floor(s / 3600) + 'h' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + 'm'
}

function ranked(m: Record<string, number>): Array<[string, number]> {
  return Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
}

export function turnLine(r: TurnReport): string {
  const parts = [fmt(r.wall)]
  const claude = r.waiting + r.writing
  if (claude > 0) parts.push('Claude ' + fmt(claude) + (r.waiting > 0 ? ' (' + fmt(r.waiting) + ' before output)' : ''))
  const tools = ranked(r.tools)
  const only = tools.length === 1 ? tools[0] : undefined
  if (only) parts.push(only[0] + ' ' + fmt(only[1]))
  else if (tools.length > 1) {
    const top = tools.slice(0, 2).map(([k, v]) => k + ' ' + fmt(v)).join(', ')
    parts.push('tools ' + fmt(toolTotal(r)) + ' (' + top + (tools.length > 2 ? ', +' + (tools.length - 2) : '') + ')')
  }
  if (r.you > 0) parts.push('you ' + fmt(r.you))
  parts.push('other ' + fmt(r.other))
  return parts.join(' · ') + (r.aborted ? ' · interrupted' : '')
}

export type Totals = TurnReport & { turns: number; interrupted: number; longest: number }

export function emptyTotals(): Totals {
  return { wall: 0, aborted: false, waiting: 0, writing: 0, you: 0, other: 0, tools: {}, youBy: {}, turns: 0, interrupted: 0, longest: 0 }
}

export function add(t: Totals, r: TurnReport): Totals {
  const sum = (a: Record<string, number>, b: Record<string, number>) => {
    const out = { ...a }
    for (const [k, v] of Object.entries(b)) out[k] = (out[k] || 0) + v
    return out
  }
  return {
    ...t,
    wall: t.wall + r.wall,
    waiting: t.waiting + r.waiting,
    writing: t.writing + r.writing,
    you: t.you + r.you,
    other: t.other + r.other,
    tools: sum(t.tools, r.tools),
    youBy: sum(t.youBy, r.youBy),
    turns: t.turns + 1,
    interrupted: t.interrupted + (r.aborted ? 1 : 0),
    longest: Math.max(t.longest, r.wall),
  }
}

export function receipt(t: Totals): string[] {
  if (t.turns === 0) return ['No finished turns yet in this session.']
  const pct = (ms: number) => (t.wall > 0 ? Math.round((ms / t.wall) * 100) : 0) + '%'
  const row = (name: string, ms: number, note: string) =>
    name.padEnd(8) + fmt(ms).padStart(7) + pct(ms).padStart(6) + (note ? '  ' + note : '')
  const tools = ranked(t.tools)
  const toolNote = tools.slice(0, 3).map(([k, v]) => k + ' ' + fmt(v)).join(', ') + (tools.length > 3 ? ', +' + (tools.length - 3) + ' more' : '')
  const youNote = ranked(t.youBy).map(([k, v]) => k + ' ' + fmt(v)).join(', ')
  const lines = [
    'this session, this machine · ' + t.turns + ' turn' + (t.turns === 1 ? '' : 's') + ' · ' + fmt(t.wall) + ' of turn time' + (t.interrupted ? ' · ' + t.interrupted + ' interrupted' : ''),
    row('Claude', t.waiting + t.writing, 'before output ' + fmt(t.waiting) + ', writing ' + fmt(t.writing)),
    row('tools', toolTotal(t), toolNote),
    row('you', t.you, youNote),
    row('other', t.other, 'not attributed: hooks, local work, gaps'),
    'longest turn ' + fmt(t.longest) + '. Times are summed waits measured in this session, not server speed.',
  ]
  return lines
}

const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const PM_SUBCOMMANDS = new Set(['test', 'install', 'i', 'ci', 'build', 'lint', 'dev', 'start', 'typecheck', 'format', 'add', 'exec'])
const SCRIPT_NAMES = new Set(['test', 'build', 'lint', 'dev', 'start', 'typecheck', 'format', 'check', 'e2e'])
const SUBCOMMANDS: Record<string, Set<string>> = {
  cargo: new Set(['test', 'build', 'run', 'check', 'clippy', 'fmt', 'bench']),
  go: new Set(['test', 'build', 'run', 'vet', 'mod', 'generate']),
  git: new Set(['status', 'diff', 'log', 'commit', 'push', 'pull', 'fetch', 'clone', 'checkout', 'switch', 'rebase', 'merge', 'add', 'show', 'stash', 'grep']),
  docker: new Set(['build', 'run', 'compose', 'pull', 'push']),
  gh: new Set(['pr', 'issue', 'run', 'api', 'repo']),
  dotnet: new Set(['test', 'build', 'run', 'restore']),
  swift: new Set(['test', 'build', 'run']),
}
const PROGRAMS = new Set([
  'npm', 'pnpm', 'yarn', 'bun', 'npx', 'node', 'deno', 'tsc', 'jest', 'vitest', 'eslint', 'prettier', 'playwright',
  'python', 'python3', 'pip', 'pip3', 'uv', 'pytest', 'ruff', 'mypy', 'poetry',
  'cargo', 'rustc', 'go', 'make', 'cmake', 'ninja', 'gradle', 'gradlew', 'mvn', 'java', 'dotnet', 'swift', 'xcodebuild',
  'git', 'gh', 'docker', 'kubectl', 'terraform', 'curl', 'wget',
  'ls', 'cat', 'grep', 'rg', 'find', 'sed', 'awk', 'head', 'tail', 'wc', 'sleep', 'echo', 'mkdir', 'rm', 'cp', 'mv', 'chmod', 'tar', 'jq', 'expr',
])

// A chained command runs several programs; the one that ran tests or a build
// is almost always where the time went, so it names the call over the others.
const RUNNERS = /^(?:(?:npm|pnpm|yarn|bun) (?:test|run (?:test|build|e2e|typecheck)|build|e2e|typecheck)|npx|node --test|pytest|tsc|jest|vitest|playwright|cargo (?:test|build|bench)|go (?:test|build)|make|cmake|ninja|gradle|gradlew|mvn|dotnet (?:test|build)|swift (?:test|build)|xcodebuild)$/

// Only a program on PROGRAMS, and only a subcommand on its own list, is ever
// shown: a script name or path can be private, so anything else reads "Bash".
export function bashLabel(command: unknown): string {
  if (typeof command !== 'string') return 'Bash'
  const labels = command
    .split(/&&|\|\||;|\n/)
    .map(part => labelOne((part.split('|')[0] as string).trim()))
    .filter((label): label is string => label !== null)
  return labels.find(label => RUNNERS.test(label)) || labels.find(label => label !== 'Bash') || 'Bash'
}

function labelOne(segment: string): string | null {
  const words = segment.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean)
  let i = 0
  while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i] as string) || words[i] === 'time' || words[i] === 'env')) i++
  const raw = words[i]
  if (!raw || raw === 'cd') return null
  const program = raw.replace(/^\.\//, '').split('/').pop() as string
  if (!PROGRAMS.has(program)) return 'Bash'
  const next = words[i + 1]
  const after = words[i + 2]
  if ((program === 'python' || program === 'python3') && next === '-m' && after === 'pytest') return 'pytest'
  if (program === 'node' && next === '--test') return 'node --test'
  if (PACKAGE_MANAGERS.has(program) && next) {
    if (next === 'run' && after && SCRIPT_NAMES.has(after)) return program + ' run ' + after
    if (PM_SUBCOMMANDS.has(next)) return program + ' ' + next
    if (program !== 'npm' && SCRIPT_NAMES.has(next)) return program + ' ' + next
    return program
  }
  const subs = SUBCOMMANDS[program]
  if (subs && next && subs.has(next)) return program + ' ' + next
  return program
}

export function toolLabel(tool: string, input: { command?: unknown }): string {
  if (tool === 'Bash') return bashLabel(input.command)
  if (tool.startsWith('mcp__')) return 'MCP'
  if (tool === 'Agent' || tool === 'Task') return 'subagent'
  return tool
}
