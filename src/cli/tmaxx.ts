#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { readCodexChat } from "../chat/codex.ts";
import { readClaudeChat } from "../chat/claude.ts";
import { deliverMessageWithReceipt } from "../message/delivery.ts";
import { formatMessageEnvelope } from "../message/envelope.ts";
import { probePaneToChat } from "../resolution/probe.ts";
import { resolvePaneToChat } from "../resolution/resolve.ts";
import { inspectPane } from "../tmux/inspect.ts";
import { requireTmuxCommand } from "../tmux/process.ts";
import { getCurrentPaneIdentity, getCurrentPaneTarget, listPaneIdentities } from "../tmux/runtime.ts";
import type { ExistingInputPolicy } from "../tmux/send.ts";

type ParsedArgs = {
  positionals: string[];
  flags: Map<string, string | boolean>;
};

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(name, true);
      continue;
    }
    flags.set(name, next);
    index += 1;
  }
  return { positionals, flags };
}

function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function flagBoolean(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

function requireFlag(args: ParsedArgs, name: string): string {
  const value = flagString(args, name);
  if (!value) {
    throw new Error(`missing required flag --${name}`);
  }
  return value;
}

function requireTargetOrSelf(args: ParsedArgs): string {
  const explicit = flagString(args, "target");
  if (explicit) {
    return explicit;
  }
  if (flagBoolean(args, "self")) {
    requireTmuxCommand();
    return getCurrentPaneTarget();
  }
  throw new Error("missing required flag --target or --self");
}

async function readBody(args: ParsedArgs): Promise<string> {
  const inline = flagString(args, "body");
  if (typeof inline === "string") {
    return inline;
  }
  const bodyFile = flagString(args, "body-file");
  if (bodyFile) {
    if (!existsSync(bodyFile)) {
      throw new Error(`body file not found: ${bodyFile}`);
    }
    const text = readFileSync(bodyFile, "utf8");
    if (!text.trim()) {
      throw new Error(`message body file is empty: ${bodyFile}`);
    }
    return text;
  }
  const text = await Bun.stdin.text();
  if (!text.trim()) {
    throw new Error("message body required via --body, --body-file, or stdin");
  }
  return text;
}

function printUsage(): void {
  process.stdout.write(`tmaxx: tmux transport and transcript bridge

Usage:
  tmaxx send --to <pane> [--body <text> | --body-file <path>] [--from <sender>] [--anonymous] [--delay-seconds <seconds>] [--existing-input clear|error]
  tmaxx pane read (--target <pane> | --self) [--start-line <-120>]
  tmaxx pane inspect (--target <pane> | --self) [--start-line <-120>]
  tmaxx pane self
  tmaxx pane list
  tmaxx chat resolve (--target <pane> | --self)
  tmaxx chat probe (--target <pane> | --self) [--wait-ms <ms>] [--existing-input clear|error]
  tmaxx chat read ((--target <pane> | --self) | --session <id> --provider <codex|claude>) [--role <all|user|assistant>] [--after-id <message-id>] [--after-ts <iso>] [--limit <n>]
  tmaxx chat tail ((--target <pane> | --self) | --session <id> --provider <codex|claude>) [--role <all|user|assistant>] [--limit <n>]
`);
}

function defaultSender(): string {
  try {
    return getCurrentPaneIdentity().target;
  } catch {
    const explicit = process.env.TMAXX_SENDER?.trim();
    if (explicit) {
      return explicit;
    }
    const user = process.env.USER?.trim();
    const host = process.env.HOSTNAME?.trim();
    if (user && host) {
      return `${user}@${host}`;
    }
    if (user) {
      return user;
    }
    return "tmaxx";
  }
}

async function runSend(args: ParsedArgs): Promise<void> {
  requireTmuxCommand();
  const to = requireFlag(args, "to");
  const body = await readBody(args);
  const anonymous = flagBoolean(args, "anonymous");
  const from = flagString(args, "from");
  const delaySeconds = Number(flagString(args, "delay-seconds") ?? "0.2");
  if (!Number.isFinite(delaySeconds) || delaySeconds < 0) {
    throw new Error("--delay-seconds must be a non-negative number");
  }
  const existingInput = (flagString(args, "existing-input") ?? "clear") as ExistingInputPolicy;
  if (existingInput !== "clear" && existingInput !== "error") {
    throw new Error("--existing-input must be clear or error");
  }
  const payload = anonymous
    ? body
    : formatMessageEnvelope({
        from: from ?? defaultSender(),
        to,
        body,
      });
  const receipt = await deliverMessageWithReceipt({ target: to }, payload, {
    submitDelaySeconds: delaySeconds,
    existingInputPolicy: existingInput,
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

function parseStartLine(args: ParsedArgs): number {
  const raw = flagString(args, "start-line") ?? "-120";
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error("--start-line must be an integer");
  }
  return value;
}

function runPaneRead(args: ParsedArgs): void {
  requireTmuxCommand();
  const target = requireTargetOrSelf(args);
  const inspection = inspectPane({ target }, parseStartLine(args));
  process.stdout.write(inspection.visibleText);
  if (!inspection.visibleText.endsWith("\n")) {
    process.stdout.write("\n");
  }
}

function runPaneInspect(args: ParsedArgs): void {
  requireTmuxCommand();
  const target = requireTargetOrSelf(args);
  const inspection = inspectPane({ target }, parseStartLine(args));
  process.stdout.write(`${JSON.stringify(inspection, null, 2)}\n`);
}

function runPaneSelf(): void {
  requireTmuxCommand();
  process.stdout.write(`${JSON.stringify(getCurrentPaneIdentity(), null, 2)}\n`);
}

function runPaneList(): void {
  requireTmuxCommand();
  process.stdout.write(`${JSON.stringify(listPaneIdentities(), null, 2)}\n`);
}

function resolveChatRef(args: ParsedArgs): { sessionId: string; provider: "codex" | "claude"; cwd?: string } {
  const direct = flagString(args, "session");
  if (direct) {
    const provider = flagString(args, "provider") ?? "codex";
    if (provider !== "codex" && provider !== "claude") {
      throw new Error("--provider must be codex or claude");
    }
    return { sessionId: direct, provider };
  }
  requireTmuxCommand();
  const target = requireTargetOrSelf(args);
  const resolution = resolvePaneToChat(target);
  if (!resolution.resolved || !resolution.chat) {
    throw new Error(`unable to resolve pane ${target} to a durable chat session`);
  }
  return { sessionId: resolution.chat.sessionId, provider: resolution.chat.provider };
}

function parseRole(args: ParsedArgs): "all" | "user" | "assistant" {
  const role = flagString(args, "role") ?? "all";
  if (role !== "all" && role !== "user" && role !== "assistant") {
    throw new Error("--role must be all, user, or assistant");
  }
  return role;
}

function parseLimit(args: ParsedArgs): number | undefined {
  const raw = flagString(args, "limit");
  if (!raw) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("--limit must be a positive integer");
  }
  return value;
}

function runChatResolve(args: ParsedArgs): void {
  requireTmuxCommand();
  const target = requireTargetOrSelf(args);
  const resolution = resolvePaneToChat(target);
  process.stdout.write(`${JSON.stringify(resolution, null, 2)}\n`);
}

async function runChatProbe(args: ParsedArgs): Promise<void> {
  requireTmuxCommand();
  const target = requireTargetOrSelf(args);
  const waitMsRaw = flagString(args, "wait-ms") ?? "1500";
  const waitMs = Number(waitMsRaw);
  if (!Number.isInteger(waitMs) || waitMs < 0) {
    throw new Error("--wait-ms must be a non-negative integer");
  }
  const existingInput = (flagString(args, "existing-input") ?? "error") as ExistingInputPolicy;
  if (existingInput !== "clear" && existingInput !== "error") {
    throw new Error("--existing-input must be clear or error");
  }
  const resolution = await probePaneToChat(target, {
    waitMs,
    existingInputPolicy: existingInput,
  });
  process.stdout.write(`${JSON.stringify(resolution, null, 2)}\n`);
}

function runChatRead(args: ParsedArgs, tail: boolean): void {
  const resolved = resolveChatRef(args);
  const common = {
    role: parseRole(args),
    limit: parseLimit(args),
    tail,
    afterMessageId: flagString(args, "after-id"),
    afterTimestamp: flagString(args, "after-ts"),
  };
  const result =
    resolved.provider === "claude"
      ? readClaudeChat(resolved.sessionId, { ...common, cwd: process.cwd() })
      : readCodexChat(resolved.sessionId, common);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [command, subcommand] = args.positionals;
  if (!command || command === "--help" || command === "help") {
    printUsage();
    return;
  }
  if (command === "send") {
    await runSend(args);
    return;
  }
  if (command === "pane" && subcommand === "read") {
    runPaneRead(args);
    return;
  }
  if (command === "pane" && subcommand === "inspect") {
    runPaneInspect(args);
    return;
  }
  if (command === "pane" && subcommand === "self") {
    runPaneSelf();
    return;
  }
  if (command === "pane" && subcommand === "list") {
    runPaneList();
    return;
  }
  if (command === "chat" && subcommand === "resolve") {
    runChatResolve(args);
    return;
  }
  if (command === "chat" && subcommand === "probe") {
    await runChatProbe(args);
    return;
  }
  if (command === "chat" && subcommand === "read") {
    runChatRead(args, false);
    return;
  }
  if (command === "chat" && subcommand === "tail") {
    runChatRead(args, true);
    return;
  }
  throw new Error(`unknown command: ${args.positionals.join(" ")}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
});
