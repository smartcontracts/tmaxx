---
name: codex-manager
description: Keep a Codex worker operating from a manager Claude pane using tmaxx send/read/inspect plus a simple supervision loop.
---

# Codex Manager

This skill is for the common setup where:

- Claude is the manager
- Codex is the worker
- both are already running in existing tmux panes
- `tmaxx` is the transport layer between them

Use it when the worker already has a clear assignment and the manager's job is
to keep execution moving.

## The Core Idea

Run Claude in a `/loop` and keep the loop dumb:

1. inspect the worker pane
2. read what is visible
3. optionally read the recent durable transcript
4. decide whether the worker is making real progress
5. only intervene if one of the known failure modes shows up

The manager is not there to re-solve the task every minute. The manager is
there to keep the worker from drifting, freezing, or pretending to work.

## Basic Setup

Example pane naming:

```bash
manager pane: claude3:1.1
worker pane:  codex1:1.1
```

Useful commands:

```bash
tmaxx pane inspect --target codex1:1.1
tmaxx pane read --target codex1:1.1 | tail -20
tmaxx chat tail --target codex1:1.1 --limit 6
tmaxx send --to codex1:1.1 --from claude3 --body "execute immediately and report results"
```

## When To Use `/loop`

Use `/loop` when:

- the worker already has a clear plan
- the main risk is execution drift
- you want the manager to keep checking for stalls and nudging as needed

Do not use `/loop` as a substitute for giving the worker a real assignment in
the first place.

## Failure Modes To Watch For

### 1. Analysis paralysis

The worker keeps talking about approaches, detectors, candidates, plans, or
frontiers instead of doing the work.

Typical nudge:

```bash
tmaxx send --to codex1:1.1 --from claude3 --body "Stop analyzing. Execute the fix now and report results."
```

### 2. Permission-seeking

The worker describes the obvious next step and then asks if it should do it.

Typical nudge:

```bash
tmaxx send --to codex1:1.1 --from claude3 --body "You already know the next step. Do it and report results."
```

### 3. Stall loop

The worker is on the same error, same file, same idea for too long.

Manager response:

- stop the loop of vague nudges
- inspect the actual blocker directly
- send one precise instruction back

### 4. Whack-a-mole

The worker keeps fixing one instance of a bug class at a time instead of fixing
the shared cause.

Typical nudge:

```bash
tmaxx send --to codex1:1.1 --from claude3 --body "Stop fixing instances one by one. Count the whole bug class, find the common cause, and write one fix for that class."
```

### 5. Fake busy state

The pane looks busy, but it is really just sitting in a background-terminal or
stale waiting state.

Manager response:

- inspect the pane
- read the last visible lines
- if nothing is moving, tell the worker to check the stuck background job and continue

### 6. Compaction drift

The worker compacted and lost the immediate thread.

Manager response:

- send a short re-brief
- restate the assignment, the current step, and the next concrete deliverable

## Good Manager Behavior

- Keep messages short.
- Intervene only when there is a reason.
- Prefer operational nudges over speeches.
- Read the transcript when the pane view is not enough.
- Escalate from generic nudge to precise directive when the worker is actually stuck.

## Bad Manager Behavior

- Spamming the worker every minute.
- Replanning the task from scratch while the worker is already executing.
- Sending vague "keep going" messages with no information value.
- Mistaking visible motion for real progress.
- Letting the worker sit in analysis mode just because the pane is not idle.

## Suggested `/loop` Prompt Shape

If you want a compact manager loop prompt for Claude, use something in this
shape:

```text
You are supervising a Codex worker in pane codex1:1.1.

Loop:
1. Run `tmaxx pane inspect --target codex1:1.1`
2. Run `tmaxx pane read --target codex1:1.1 | tail -20`
3. If needed, run `tmaxx chat tail --target codex1:1.1 --limit 6`
4. Decide whether Codex is making real progress on the assigned task
5. If Codex is drifting, stalled, permission-seeking, or analyzing instead of executing, send one short corrective message with `tmaxx send`
6. Otherwise do nothing

Keep interventions brief and operational. Do not spam. Do not take over unless Codex is clearly stuck.
```

That is the whole pattern. The tool stays stupid. The manager loop just keeps
the worker alive and pointed at the job.
