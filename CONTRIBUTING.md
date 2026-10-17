# Contributing

Issues are welcome, and so are pull requests that follow this rule:

1. **Small fixes: send a pull request directly.** A program or subcommand for the label list, a typo, a missing test.
2. **Anything else: open an issue first** and wait for a yes before writing code. That covers a new bucket, a change to how time is split, and any new call on the mods API.
3. A pull request that goes beyond a small fix without an agreed issue is closed with a link to this file.

An issue about a wrong split is most useful with the Claude Code version, the time-blame line as printed, and what actually happened in that turn.

## Run the checks

```sh
claude plugin validate .claude-plugin/plugin.json
claude plugin test .
```

Both must pass. For type checking, run `/plugin-types` in a Claude Code session in this folder, then `npx tsc -p .`. The generated types are git-ignored.

## Keep the reach low

time-blame only draws, registers `/blame` and reads which apps are attached: `$.ui.log`, `$.ui.open`, `$.ui.resolve`, `$.ui.invalidate`, `$.command.register` and `$.session.surfaces`. That is reach L0, the lowest a mod can have, and the README's threat model depends on it. A change that adds a call, reads a file, runs a process or touches the network needs an issue first that says why.

## Where things live

- `hooks/ledger.ts`: the accounting and the labels, as pure functions. Most changes belong here, with a test in `tests/ledger.test.ts`.
- `hooks/register.ts`: collects timestamps from the hooks and draws the line and the panel.
- `site/`: the landing page, published to https://timeblame.aidojo.si/ from `main`.

## Command labels

Bash commands are named only from a fixed list of programs and subcommands, because a command line can carry private names. A new program or subcommand on the list is fine if it is common and its name says nothing about the user's project.
