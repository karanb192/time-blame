# Contributing

Issues and pull requests are welcome.

## Run the checks

```sh
claude plugin validate .claude-plugin/plugin.json
claude plugin test .
```

Both must pass. For type checking, run `/plugin-types` in a Claude Code session in this folder, then `npx tsc -p .`. The generated types are git-ignored.

## Keep the reach low

time-blame calls two things on the mods API: `$.ui.log` and `$.command.register`. That is reach L0, the lowest a mod can have, and the README's threat model depends on it. A change that adds a call, reads a file, runs a process or touches the network needs an issue first that says why.

## Where things live

- `hooks/ledger.ts`: the accounting and the labels, as pure functions. Most changes belong here, with a test in `tests/ledger.test.ts`.
- `hooks/register.ts`: collects timestamps from the hooks and prints the lines.
- `site/`: the landing page, published to https://timeblame.aidojo.si/ from `main`.

## Command labels

Bash commands are named only from a fixed list of programs and subcommands, because a command line can carry private names. A new program or subcommand on the list is fine if it is common and its name says nothing about the user's project.
