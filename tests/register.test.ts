import { describe, expect, test, tier } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On, ToolCallInput, TurnStepChunk, TurnStepInput, TurnStepResult } from 'claude-code'

tier('user')

declare function setTimeout(callback: () => void, ms: number): unknown

const npmTest: ToolCallInput = { tool: 'Bash', command: 'npm test', tool_use_id: 'u1' }

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function world(on: On) {
  const lines: string[] = []
  on('ui.log', ($, e) => { lines.push(e.text); return { value: undefined } })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', async ($, e) => { await pause(40); return { result: 'ok' } as never })
  on('turn.step', async function* ($, e: TurnStepInput): AsyncGenerator<TurnStepChunk, TurnStepResult> {
    await pause(20)
    yield { kind: 'text', index: 0, text: 'hi' }
    await pause(20)
    yield { kind: 'stop', stopReason: 'end_turn', usage: null }
    return { turnId: e.turnId, index: e.index, answer: 'hi', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return lines
}

async function step($: Parameters<TestBody>[0], turnId: string, agentId?: string) {
  const it = $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId })
  for await (const _ of it) { /* drain */ }
}

describe('a turn', () => {
  test('prints one line that names the command and always shows other', async ($, on) => {
    const lines = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.turn.start({ text: 'run the tests', turnId: 't1' })
    await step($, 't1')
    // @ts-expect-error tsc gives up on the engine's generic tool.call type (TS2589); the call itself is typed by npmTest.
    await $.tool.call(npmTest)
    await step($, 't1')
    await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 5000, isAborted: false, reason: 'answer' })
    expect(lines.length).toBe(1)
    expect(lines[0]).toMatch(/^5\.0s · Claude .* · npm test .* · other /)
  })

  test('a subagent turn adds no line and no turn', async ($, on) => {
    const lines = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.turn.start({ text: 'go', turnId: 'main' })
    await $.turn.start({ text: 'child', turnId: 'child', agentId: 'a1' })
    await step($, 'child', 'a1')
    await $.turn.complete({ turnId: 'child', agentId: 'a1', answer: 'x', durationMs: 4000, isAborted: false, reason: 'answer' })
    await $.turn.complete({ turnId: 'main', answer: 'x', durationMs: 4000, isAborted: true, reason: 'aborted' })
    expect(lines.length).toBe(1)
    expect(lines[0]).toMatch(/interrupted$/)
    await $.command.run({ command: 'blame', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)
    expect(lines[1]).toMatch(/^this session, this machine · 1 turn · /)
  })

  test('a short turn prints nothing but still counts', async ($, on) => {
    const lines = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.turn.start({ text: 'hi', turnId: 's1' })
    await step($, 's1')
    await $.turn.complete({ turnId: 's1', answer: 'hi', durationMs: 100, isAborted: false, reason: 'answer' })
    expect(lines).toEqual([])
    await $.command.run({ command: 'blame', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)
    expect(lines[0]).toMatch(/· 1 turn ·/)
  })
})
