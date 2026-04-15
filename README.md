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

## How I Use It

I usually run one Claude pane as the manager and one Codex pane as the worker.
`tmaxx` is the thin pipe between them.

The pattern is simple:

- Claude watches the worker pane
- Claude sends work into the worker pane
- Claude reads either the visible pane or the durable transcript
- Codex replies back through its own normal chat flow, and agent-to-agent replies can also come back through `tmaxx`

I am not trying to build a protocol empire here. I just want a reliable way for
one agent to talk to another through tmux without fumbling raw `send-keys`.

### Setup

I keep stable pane names so I do not have to rediscover them every time.

Example:

```bash
manager pane: claude3:1.1
worker pane:  codex1:1.1
```

The exact names do not matter. What matters is that the panes already exist and
the agents are already running inside them.

### Normal Loop

Claude is the supervisor. Codex is the hands.

Typical commands:

```bash
tmaxx pane self
tmaxx pane list
tmaxx pane inspect --target codex1:1.1
tmaxx pane read --target codex1:1.1
tmaxx chat tail --target codex1:1.1 --limit 5
tmaxx send --to codex1:1.1 --body "check the failing compiler tests and fix the root cause"
```

That is basically it.

If I want the message to look like an explicit agent-to-agent instruction, I
use the default structured send. If I want it to look like plain human input in
the target chat, I use anonymous mode:

```bash
tmaxx send --to codex1:1.1 --anonymous --body "look at slice 36 again"
```

### Pane Read Vs Chat Read

Sometimes I just want to know what is on screen right now:

```bash
tmaxx pane read --target codex1:1.1
```

Sometimes I want the actual conversation history instead of whatever happens to
be visible:

```bash
tmaxx chat tail --target codex1:1.1 --limit 10
```

That split is one of the main reasons this tool exists.

### Fresh Sessions

Sometimes the pane is easy to identify but the backing chat session is not.
When that happens, I can force the match with a probe:

```bash
tmaxx chat probe --target codex1:1.1
```

That sends a nonce, finds it in the durable logs, and binds the pane honestly.

### Manager Claude And `/loop`

When Codex already has a clear assignment, I usually keep Claude in manager
mode and let Claude run `/loop`.

The point of `/loop` is not to make Claude do the work. The point is to keep
Codex operating through the failure modes it predictably has:

- analysis paralysis instead of execution
- permission-seeking instead of taking the obvious next step
- getting stuck on one error for too long
- whack-a-mole fixes instead of fixing the bug class
- background-terminal weirdness where it looks busy but is not actually moving
- context compaction or drift where it loses the immediate thread

The basic manager loop is:

1. inspect the worker pane
2. read the visible pane or recent transcript
3. decide whether Codex is making real progress
4. if not, send a short corrective message and keep the assignment tight

Typical manager-side commands inside that loop:

```bash
tmaxx pane inspect --target codex1:1.1
tmaxx pane read --target codex1:1.1 | tail -20
tmaxx chat tail --target codex1:1.1 --limit 6
tmaxx send --to codex1:1.1 --body "Stop analyzing. Execute the fix and report the result."
```

I use `/loop` when the plan is already clear and the risk is mostly execution
drift, not planning quality. If the worker still needs actual problem framing,
I do that first and only then drop into the supervision loop.

The important part is that Claude stays brief and operational. It should not
spam the worker. It should only intervene when one of the common failure modes
shows up or when the worker needs a precise shove back onto the assignment.

There is also a cleaned-up manager skill in
[skills/codex-manager/SKILL.md](/home/k/work/tmaxx/skills/codex-manager/SKILL.md)
that captures this pattern in a more reusable form.

## Commands

```bash
tmaxx send --to worker:1.1 --body "check the failing test"
tmaxx send --to worker:1.1 --from claude3:1.1 --body "check the failing test"
tmaxx send --to worker:1.1 --body-file ./message.txt
tmaxx send --to worker:1.1 --anonymous --body "check the failing test"
tmaxx pane self
tmaxx pane list
tmaxx pane read --self
tmaxx pane inspect --target worker:1.1
tmaxx chat resolve --self
tmaxx chat read --target worker:1.1 --role assistant --limit 10
tmaxx chat tail --target worker:1.1 --limit 5
tmaxx chat read --provider claude --session 7b1654f3-dc8e-4b36-b203-df8fca16679d
tmaxx chat probe --target worker:1.1
```

`send` uses a standard message envelope by default so agent messages can carry
`message_id`, `from`, `to`, `sent_at`, and `body`. If `--from` is omitted, `tmaxx`
first tries to use the current pane target automatically, then falls back to
`TMAXX_SENDER` or the local user identity when it is not running inside tmux.

Use `--anonymous` when you want the message to look like ordinary human input.
Use `--body-file` for multiline messages when shell quoting would be annoying.

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
