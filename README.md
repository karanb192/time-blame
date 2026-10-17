# time-blame

A Claude Code mod that answers one question after every turn: was Claude slow, or was it your `npm test`?

It splits each turn's time by cause and prints one dim line under the answer. `/blame` prints a receipt for the whole session. Claude never reads either, and nothing leaves your machine.

```
⏺ time-blame: 26s · Claude 8.0s (7.2s before output) · sleep 4.7s · you 12s · other 0.3s
```

```
⏺ time-blame: this session, this machine · 1 turn · 26s of turn time
⏺ time-blame: Claude     8.0s   31%  before output 7.2s, writing 0.8s
⏺ time-blame: tools      4.7s   19%  sleep 4.7s
⏺ time-blame: you         12s   49%  approvals 12s
⏺ time-blame: other      0.3s    1%  not attributed: hooks, local work, gaps
⏺ time-blame: longest turn 26s. Times are summed waits measured in this session, not server speed.
```

Both blocks are copied as text from a live session on Claude Code 2.1.302, where a permission dialog was left open for 12 seconds before it was approved.

## Install

Function hooks are early access, so mods load only with a flag:

```sh
git clone https://github.com/karanb192/time-blame
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir ./time-blame
```

To keep it on, add `{ "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }` to `~/.claude/settings.json`. That loads the hooks module of every installed plugin that has one. Needs Claude Code 2.1.302 or later.

## What each bucket means

Every millisecond of a turn lands in exactly one bucket, so the parts always add up to the total.

| Bucket | Measured as | When two overlap |
|---|---|---|
| you | A permission dialog, from the moment it opens to the moment the tool starts. Also the whole of an `AskUserQuestion` or `ExitPlanMode` call. | Wins over everything |
| tools | The tool's own execution time, which Claude Code reports with each result. Named by tool, and by command for Bash. | Wins over Claude |
| Claude, before output | From the moment a model request is sent to its first text, thinking or tool-call chunk. Includes queueing, retries and network. | |
| Claude, writing | From that first chunk to the end of the request. | |
| other | Whatever is left: hooks, local work, the gaps between steps. Always shown, never hidden. | |

Two or more tools running at once count as `parallel tools`, rather than blaming whichever one was slowest to return.

A subagent's time sits inside the Agent call that started it, labelled `subagent`. Its own steps are not counted again.

The line is printed for turns of 3 seconds or more. `/blame` counts every turn.

## Things to know

- **The total is longer than Claude Code's "Worked for".** Claude Code's counter leaves out the time a dialog waits for you. In the run above it said 13s, and time-blame said 26s: the 12 seconds of the open dialog, plus rounding.
- **Bash commands are named only from a fixed list.** Common programs (`npm`, `pytest`, `cargo`, `git`, `make` and others) and their common subcommands (`npm test`, `cargo build`) are shown. A script name, a path or anything else shows as `Bash`, because a command line can carry private names.
- **On a managed Claude Code install, approvals count as tool time.** Approvals are timed with the `PermissionRequest` and `PostToolUse` settings-hook events. Where an organization manages Claude Code, those events skip plugins a person installs. The dialog wait then falls into the tool's time.
- **Retries are not a separate bucket.** Claude Code logs a retried request only after it gives up, so a retry that succeeds leaves no record a mod can read. Retry time shows up as "before output".
- **It measures this session on this machine.** It says nothing about Anthropic's servers, and it keeps nothing after the session ends.

## What it can reach

Validated on Claude Code 2.1.302:

    ❯ ./register.ts hooks: session.start, command.run{command=blame}, session.end, turn.start, turn.step, classic.PermissionRequest, classic.PostToolUse, classic.PostToolUseFailure, tool.call, turn.complete
    ❯ ./register.ts calls: $.command.register, $.ui.log

Reach L0, draws and remembers. It sees every tool call and every model request, as timing only.

    Threat model for time-blame (reach L0, draws and remembers)
    1. Reads:    timestamps of turns, model requests and tool calls; the kind of each streamed chunk (never its text); the tool name; for Bash, the command line, matched against a fixed list of program names and dropped; the execution time Claude Code reports with each result
    2. Runs:     nothing
    3. Sends:    nothing leaves the machine
    4. Persists: nothing; the session's totals live in memory and reset on /clear and /resume
    5. Hostile input: a crafted command line can only change which allowlisted label is shown or turn it into "Bash"; no input reaches a process, a file, a prompt or the network, and the lines go to the transcript as dim log lines Claude does not read

If a hook throws, Claude Code skips it and the tool call or request runs as it would without the mod.

## Develop

```sh
claude plugin validate .claude-plugin/plugin.json
claude plugin test .
```

`hooks/ledger.ts` holds the accounting and the labels as pure functions; `hooks/register.ts` only collects timestamps. For type checking, run `/plugin-types` in a session in this folder, then `npx tsc -p .`. The generated types are git-ignored.

## License

MIT
