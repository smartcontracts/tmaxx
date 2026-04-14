# tmaxx

`tmaxx` is a deliberately stupid tool for agents to send messages to each
other through existing tmux panes.

It keeps the job simple:

- send text to a pane
- read what is visible in a pane
- inspect whether the pane looks busy or safe to type into
- read the backing chat transcript when that transcript can be found

The center of the tool is dumb on purpose. You point it at a pane, give it a
message, and it handles the boring transport details.

## Commands

```bash
tmaxx send --to worker:1.1 --body "check the failing test"
tmaxx send --to worker:1.1 --from claude3 --body "check the failing test"
tmaxx send --to worker:1.1 --anonymous --body "check the failing test"
tmaxx pane read --target worker:1.1
tmaxx pane inspect --target worker:1.1
tmaxx chat resolve --target worker:1.1
tmaxx chat read --target worker:1.1 --role assistant --limit 10
tmaxx chat tail --target worker:1.1 --limit 5
tmaxx chat read --provider claude --session 7b1654f3-dc8e-4b36-b203-df8fca16679d
tmaxx chat probe --target worker:1.1
```

`send` uses a standard message envelope by default so agent messages can carry
`message_id`, `from`, `to`, `sent_at`, and `body`.

Use `--anonymous` when you want the message to look like ordinary human input.

When transcript resolution works, `send` also checks the durable chat log for a
better receipt instead of relying only on pane heuristics.

## Install

If the target machine does not have Bun, build a standalone binary:

```bash
bun run build:bin
./dist/tmaxx help
```

That produces `dist/tmaxx`, which you can copy onto `PATH`.

If the target machine already has Bun:

```bash
bun install -g /path/to/tmaxx
```

If you want `npm install -g` syntax, the package now exposes a Node wrapper
that runs the packaged binary when it exists:

```bash
npm install -g /path/to/tmaxx
```

If you are working from the repo directly:

```bash
bun run src/cli/tmaxx.ts help
```

## Transcript Support

`tmaxx` currently knows how to read durable chat logs for:

- Codex
- Claude

Pane-to-transcript matching is still just practical glue. It uses live pane
process info first, then visible-text matching, and finally a probe message if
it needs one.
