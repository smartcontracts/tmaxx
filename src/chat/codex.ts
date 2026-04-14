import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChatCursor, ChatMessage, ChatReadResult, ChatRef } from "./types.ts";

type CodexThreadRow = {
  id: string;
  rollout_path: string;
  updated_at: number;
  cwd: string;
  title: string;
  first_user_message: string;
};

type CodexRolloutLine = {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
};

export type CodexThreadMetadata = {
  id: string;
  rolloutPath: string;
  updatedAt: number;
  cwd: string;
  title: string;
  firstUserMessage: string;
};

export function defaultCodexHome(): string {
  return process.env.TMAXX_CODEX_HOME ?? join(homedir(), ".codex");
}

function openCodexStateDb(codexHome: string): Database {
  const dbPath = join(codexHome, "state_5.sqlite");
  if (!existsSync(dbPath)) {
    throw new Error(`codex state db not found at ${dbPath}`);
  }
  return new Database(dbPath, { readonly: true });
}

export function getCodexThreadById(threadId: string, codexHome = defaultCodexHome()): CodexThreadMetadata | null {
  const db = openCodexStateDb(codexHome);
  try {
    const row = db
      .query(
        "SELECT id, rollout_path, updated_at, cwd, title, first_user_message FROM threads WHERE id = ? LIMIT 1",
      )
      .get(threadId) as CodexThreadRow | null;
    return row ? fromCodexThreadRow(row) : null;
  } finally {
    db.close();
  }
}

export function listRecentCodexThreadsByCwd(
  cwd: string,
  limit = 12,
  codexHome = defaultCodexHome(),
): CodexThreadMetadata[] {
  const db = openCodexStateDb(codexHome);
  try {
    const rows = db
      .query(
        "SELECT id, rollout_path, updated_at, cwd, title, first_user_message FROM threads WHERE cwd = ? ORDER BY updated_at DESC LIMIT ?",
      )
      .all(cwd, limit) as CodexThreadRow[];
    return rows.map(fromCodexThreadRow);
  } finally {
    db.close();
  }
}

export function findRecentCodexThreadsContainingText(
  cwd: string,
  needle: string,
  options?: {
    limit?: number;
    codexHome?: string;
  },
): CodexThreadMetadata[] {
  const normalizedNeedle = needle.trim().toLowerCase();
  if (!normalizedNeedle) {
    return [];
  }
  return listRecentCodexThreadsByCwd(cwd, options?.limit ?? 20, options?.codexHome).filter((thread) => {
    try {
      return readFileSync(thread.rolloutPath, "utf8").toLowerCase().includes(normalizedNeedle);
    } catch {
      return false;
    }
  });
}

function fromCodexThreadRow(row: CodexThreadRow): CodexThreadMetadata {
  return {
    id: row.id,
    rolloutPath: row.rollout_path,
    updatedAt: row.updated_at,
    cwd: row.cwd,
    title: row.title,
    firstUserMessage: row.first_user_message,
  };
}

export function extractCodexResumeThreadId(commandArgs: string): string | null {
  const match = commandArgs.match(/\bresume\s+([0-9a-z-]{12,})\b/i);
  return match?.[1] ?? null;
}

export function readCodexChat(
  threadId: string,
  options?: {
    role?: ChatMessage["role"] | "all";
    limit?: number;
    tail?: boolean;
    afterMessageId?: string;
    afterTimestamp?: string;
    codexHome?: string;
  },
): ChatReadResult {
  const thread = getCodexThreadById(threadId, options?.codexHome);
  if (!thread) {
    throw new Error(`unknown codex thread: ${threadId}`);
  }
  const chat: ChatRef = {
    provider: "codex",
    sessionId: thread.id,
    rolloutPath: thread.rolloutPath,
  };
  const allMessages = normalizeCodexRolloutMessages(thread.id, readFileSync(thread.rolloutPath, "utf8"));
  let messages = applyCursor(allMessages, {
    chat,
    afterMessageId: options?.afterMessageId,
    afterTimestamp: options?.afterTimestamp,
  });
  const role = options?.role ?? "all";
  if (role !== "all") {
    messages = messages.filter((message) => message.role === role);
  }
  const limit = options?.limit;
  if (typeof limit === "number" && limit > 0) {
    messages = options?.tail === true ? messages.slice(-limit) : messages.slice(0, limit);
  }
  return {
    chat,
    messages,
    cursor: messages.length > 0 ? { chat, afterMessageId: messages.at(-1)?.id } : { chat },
  };
}

function applyCursor(messages: ChatMessage[], cursor: ChatCursor): ChatMessage[] {
  let startIndex = 0;
  if (cursor.afterMessageId) {
    const foundIndex = messages.findIndex((message) => message.id === cursor.afterMessageId);
    if (foundIndex >= 0) {
      startIndex = foundIndex + 1;
    }
  }
  let sliced = messages.slice(startIndex);
  if (cursor.afterTimestamp) {
    sliced = sliced.filter((message) => typeof message.timestamp === "string" && message.timestamp > cursor.afterTimestamp!);
  }
  return sliced;
}

export function normalizeCodexRolloutMessages(threadId: string, rolloutText: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let ordinal = 0;
  for (const line of rolloutText.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let parsed: CodexRolloutLine;
    try {
      parsed = JSON.parse(line) as CodexRolloutLine;
    } catch {
      continue;
    }
    if (parsed.type !== "event_msg" || !parsed.payload) {
      continue;
    }
    const payloadType = stringField(parsed.payload.type);
    if (payloadType === "user_message") {
      const content = stringField(parsed.payload.message);
      if (content) {
        ordinal += 1;
        messages.push({
          id: `${threadId}:${ordinal}`,
          role: "user",
          timestamp: parsed.timestamp,
          content,
          sourceKind: payloadType,
        });
      }
      continue;
    }
    if (payloadType === "agent_message") {
      const content = stringField(parsed.payload.message);
      if (content) {
        ordinal += 1;
        messages.push({
          id: `${threadId}:${ordinal}`,
          role: "assistant",
          timestamp: parsed.timestamp,
          content,
          phase: stringField(parsed.payload.phase),
          sourceKind: payloadType,
        });
      }
    }
  }
  return messages;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function extractSearchSnippets(visibleText: string): string[] {
  const raw = visibleText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^[>›❯]\s*/, ""))
    .filter((line) => line.length >= 16)
    .filter((line) => !/^[\u2500-\u257f\s]+$/.test(line))
    .filter((line) => !line.startsWith("gpt-"))
    .filter((line) => !line.startsWith("Ran "))
    .filter((line) => !line.startsWith("Explored"))
    .filter((line) => !line.startsWith("Command:"))
    .filter((line) => !line.startsWith("Process exited"))
    .filter((line) => !line.startsWith("Wall time"));
  return [...new Set(raw)].slice(-10);
}

export function scoreCodexThreadCandidate(
  candidate: CodexThreadMetadata,
  input: {
    cwd: string;
    visibleText: string;
    nowUnix?: number;
  },
): {
  score: number;
  evidence: string[];
} {
  const evidence: string[] = [];
  let score = 0;
  if (candidate.cwd === input.cwd) {
    score += 20;
    evidence.push("cwd_match");
  }
  const nowUnix = input.nowUnix ?? Math.floor(Date.now() / 1000);
  const ageSeconds = nowUnix - candidate.updatedAt;
  if (ageSeconds <= 300) {
    score += 20;
    evidence.push("updated_within_5m");
  } else if (ageSeconds <= 1800) {
    score += 10;
    evidence.push("updated_within_30m");
  }
  const snippets = extractSearchSnippets(input.visibleText).map((snippet) => snippet.toLowerCase());
  const normalizedTitle = `${candidate.title}\n${candidate.firstUserMessage}`.toLowerCase();
  let titleMatches = 0;
  for (const snippet of snippets) {
    if (normalizedTitle.includes(snippet)) {
      titleMatches += 1;
    }
  }
  if (titleMatches > 0) {
    score += titleMatches * 15;
    evidence.push(`title_overlap:${titleMatches}`);
  }
  let rolloutTail = "";
  try {
    rolloutTail = readFileSync(candidate.rolloutPath, "utf8").slice(-80_000).toLowerCase();
  } catch {
    rolloutTail = "";
  }
  let rolloutMatches = 0;
  for (const snippet of snippets) {
    if (rolloutTail.includes(snippet)) {
      rolloutMatches += 1;
    }
  }
  if (rolloutMatches > 0) {
    score += rolloutMatches * 25;
    evidence.push(`rollout_overlap:${rolloutMatches}`);
  }
  return { score, evidence };
}
