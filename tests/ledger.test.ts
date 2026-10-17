import { describe, expect, test, tier } from 'claude-code/testing'
import { add, bashLabel, emptyTotals, fmt, PARALLEL, receipt, split, toolLabel, turnLine } from '../hooks/ledger'
import type { Span } from '../hooks/ledger'

tier('user')

const span = (kind: Span['kind'], start: number, end: number, label = ''): Span => ({ kind, start, end, label })

describe('split', () => {
  test('every millisecond lands in exactly one bucket', async () => {
    const r = split([
      span('waiting', 0, 3000),
      span('writing', 3000, 5000),
      span('tool', 4500, 9000, 'npm test'),
      span('you', 9500, 11000, 'approvals'),
    ], 0, 12000)
    expect(r.waiting).toBe(3000)
    expect(r.writing).toBe(1500)
    expect(r.tools).toEqual({ 'npm test': 4500 })
    expect(r.you).toBe(1500)
    expect(r.other).toBe(1500)
    expect(r.waiting + r.writing + r.tools['npm test']! + r.you + r.other).toBe(r.wall)
  })

  test('overlapping tools are a parallel batch, not the longest tool', async () => {
    const r = split([span('tool', 0, 4865, 'expr'), span('tool', 665, 3637, 'subagent')], 0, 5000)
    expect(r.tools).toEqual({ expr: 665 + 1228, [PARALLEL]: 2972 })
    expect(r.other).toBe(135)
  })

  test('the run-3 probe turn sums to its wall time', async () => {
    // Main-loop times from the 17 Oct probe, run 3, in ms after turn.start;
    // turn.complete came at 11369 with durationMs 11650.
    const spans = [
      span('waiting', 223, 3393), span('writing', 3393, 5454),
      span('tool', 4559, 9421, 'expr'), span('tool', 5224, 8196, 'subagent'),
      span('waiting', 9442, 11347), span('writing', 11347, 11364),
    ]
    const r = split(spans, 11369 - 11650, 11369)
    const tools = Object.values(r.tools).reduce((a, b) => a + b, 0)
    expect(r.wall).toBe(11650)
    expect(r.waiting + r.writing + tools + r.you + r.other).toBe(11650)
    expect(r.tools[PARALLEL]).toBe(2972)
  })

  test('spans outside the turn are clipped', async () => {
    const r = split([span('tool', -500, 500, 'Read'), span('writing', 900, 2000)], 0, 1000)
    expect(r.tools).toEqual({ Read: 500 })
    expect(r.writing).toBe(100)
    expect(r.other).toBe(400)
  })
})

describe('labels', () => {
  test('known programs and subcommands only', async () => {
    expect(bashLabel('npm test')).toBe('npm test')
    expect(bashLabel('npm run build -- --watch')).toBe('npm run build')
    expect(bashLabel('npm run deploy-to-acme-prod')).toBe('npm')
    expect(bashLabel('cd packages/api && pnpm test')).toBe('pnpm test')
    expect(bashLabel('CI=1 NODE_ENV=test npx vitest run')).toBe('npx')
    expect(bashLabel('python3 -m pytest tests/')).toBe('pytest')
    expect(bashLabel('cargo test --release')).toBe('cargo test')
    expect(bashLabel('git push origin feature/secret-thing')).toBe('git push')
    expect(bashLabel('./scripts/rotate-prod-keys.sh')).toBe('Bash')
    expect(bashLabel('/Users/me/bin/internal-tool --flag')).toBe('Bash')
    expect(bashLabel(undefined)).toBe('Bash')
  })

  test('tool names', async () => {
    expect(toolLabel('Read', {})).toBe('Read')
    expect(toolLabel('mcp__acme__search', {})).toBe('MCP')
    expect(toolLabel('Agent', {})).toBe('subagent')
    expect(toolLabel('Bash', { command: 'make' })).toBe('make')
  })
})

describe('output', () => {
  test('durations', async () => {
    expect(fmt(4230)).toBe('4.2s')
    expect(fmt(38000)).toBe('38s')
    expect(fmt(72000)).toBe('1m12s')
    expect(fmt(3_900_000)).toBe('1h05m')
  })

  test('turn line always shows other, and marks an interrupt', async () => {
    const r = split([span('waiting', 0, 4000), span('writing', 4000, 31000), span('tool', 31000, 69000, 'npm test')], 0, 72000, true)
    expect(turnLine(r)).toBe('1m12s · Claude 31s (4.0s before output) · npm test 38s · other 3.0s · interrupted')
  })

  test('receipt says whose session it measures', async () => {
    const r = split([span('writing', 0, 10000), span('tool', 10000, 20000, 'pytest'), span('you', 20000, 25000, 'questions')], 0, 26000)
    const lines = receipt(add(add(emptyTotals(), r), r))
    expect(lines[0]).toBe('this session, this machine · 2 turns · 52s of turn time')
    expect(lines.join('\n')).toContain('pytest 20s')
    expect(lines.join('\n')).toContain('questions 10s')
    expect(lines.join('\n')).toContain('not attributed')
  })

  test('receipt before any turn', async () => {
    expect(receipt(emptyTotals())).toEqual(['No finished turns yet in this session.'])
  })
})
