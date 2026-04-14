import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { extractSearchSnippets } from "./codex.ts";
import type { ChatCursor, ChatMessage, ChatReadResult, ChatRef } from "./types.ts";

type ClaudeLine = {
  type?: string;
  timestamp?: string;
  uuid?: string;
  sessionId?: string;
  cwd?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
};

export type ClaudeSessionMetadata = {
  id: string;
  transcriptPath: string;
  updatedAtMs: number;
  cwd: string;
  firstUserMessage: string;
};

export function defaultClaudeHome(): string {
  return process.env.TMAXX_CLAUDE_HOME ?? join(homedir(), ".claude");
}

export function claudeProjectDirForCwd(cwd: string, claudeHome = defaultClaudeHome()): string {
  const slug = `-${cwd.split("/").filter(Boolean).join("-")}`;
  return join(claudeHome, "projects", slug);
}

export function listRecentClaudeSessionsByCwd(
  cwd: string,
  limit = 12,
  claudeHome = defaultClaudeHome(),
): ClaudeSessionMetadata[] {
  const projectDir = claudeProjectDirForCwd(cwd, claudeHome);
  if (!existsSync(projectDir)) {
    return [];
  }
  return readdirSync(projectDir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => {
      const transcriptPath = join(projectDir, name);
      const stats = statSync(transcriptPath);
      const id = name.replace(/\.jsonl$/, "");
      const firstUserMessage = readFirstClaudeUserMessage(transcriptPath);
      return {
        id,
        transcriptPath,
        updatedAtMs: stats.mtimeMs,
        cwd,
        firstUserMessage,
      };
    })
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
    .slice(0, limit);
}

export function findRecentClaudeSessionsContainingText(
  cwd: string,
  needle: string,
  options?: {
    limit?: number;
    claudeHome?: string;
  },
): ClaudeSessionMetadata[] {
  const normalizedNeedle = needle.trim().toLowerCase();
  if (!normalizedNeedle) {
    return [];
  }
  return listRecentClaudeSessionsByCwd(cwd, options?.limit ?? 20, options?.claudeHome).filter((session) => {
    try {
      return readFileSync(session.transcriptPath, "utf8").toLowerCase().includes(normalizedNeedle);
    } catch {
      return false;
    }
  });
}

function readFirstClaudeUserMessage(transcriptPath: string): string {
  try {
    const content = readFileSync(transcriptPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      const parsed = JSON.parse(line) as ClaudeLine;
      if (parsed.type === "user" && parsed.message?.role === "user") {
        const text = extractClaudeContentText(parsed.message.content);
        if (text) {
          return text;
        }
      }
    }
  } catch {
    return "";
  }
  return "";
}

export function readClaudeChat(
  sessionId: string,
  options?: {
    role?: ChatMessage["role"] | "all";
    limit?: number;
    tail?: boolean;
    afterMessageId?: string;
    afterTimestamp?: string;
    cwd?: string;
    claudeHome?: string;
  },
): ChatReadResult {
  const transcriptPath = findClaudeTranscriptPath(sessionId, options?.cwd, options?.claudeHome);
  if (!transcriptPath) {
    throw new Error(`unknown claude session: ${sessionId}`);
  }
  const chat: ChatRef = {
    provider: "claude",
    sessionId,
    transcriptPath,
  };
  const allMessages = normalizeClaudeMessages(sessionId, readFileSync(transcriptPath, "utf8"));
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

function findClaudeTranscriptPath(sessionId: string, cwd?: string, claudeHome = defaultClaudeHome()): string | null {
  if (cwd) {
    const direct = join(claudeProjectDirForCwd(cwd, claudeHome), `${sessionId}.jsonl`);
    if (existsSync(direct)) {
      return direct;
    }
  }
  const projectRoot = join(claudeHome, "projects");
  if (!existsSync(projectRoot)) {
    return null;
  }
  for (const projectDir of readdirSync(projectRoot)) {
    const candidate = join(projectRoot, projectDir, `${sessionId}.jsonl`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
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

export function normalizeClaudeMessages(sessionId: string, transcriptText: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let ordinal = 0;
  for (const line of transcriptText.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let parsed: ClaudeLine;
    try {
      parsed = JSON.parse(line) as ClaudeLine;
    } catch {
      continue;
    }
    if (parsed.type === "user" && parsed.message?.role === "user") {
      const content = extractClaudeContentText(parsed.message.content);
      if (content) {
        ordinal += 1;
        messages.push({
          id: `${sessionId}:${ordinal}`,
          role: "user",
          timestamp: parsed.timestamp,
          content,
          sourceKind: "user",
        });
      }
      continue;
    }
    if (parsed.type === "assistant" && parsed.message?.role === "assistant") {
      const content = extractClaudeContentText(parsed.message.content);
      if (content) {
        ordinal += 1;
        messages.push({
          id: `${sessionId}:${ordinal}`,
          role: "assistant",
          timestamp: parsed.timestamp,
          content,
          sourceKind: "assistant",
        });
      }
    }
  }
  return messages;
}

function extractClaudeContentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts = content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (!item || typeof item !== "object") {
        return "";
      }
      const typed = item as Record<string, unknown>;
      if (typeof typed.text === "string") {
        return typed.text;
      }
      if (typeof typed.content === "string") {
        return typed.content;
      }
      return "";
    })
    .filter(Boolean);
  return parts.join("\n").trim();
}

export function scoreClaudeSessionCandidate(
  candidate: ClaudeSessionMetadata,
  input: {
    cwd: string;
    visibleText: string;
    nowMs?: number;
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
  const nowMs = input.nowMs ?? Date.now();
  const ageMs = nowMs - candidate.updatedAtMs;
  if (ageMs <= 5 * 60_000) {
    score += 20;
    evidence.push("updated_within_5m");
  } else if (ageMs <= 30 * 60_000) {
    score += 10;
    evidence.push("updated_within_30m");
  }
  const snippets = extractSearchSnippets(input.visibleText).map((snippet) => snippet.toLowerCase());
  const normalizedTitle = candidate.firstUserMessage.toLowerCase();
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
  let transcriptTail = "";
  try {
    transcriptTail = readFileSync(candidate.transcriptPath, "utf8").slice(-80_000).toLowerCase();
  } catch {
    transcriptTail = "";
  }
  let transcriptMatches = 0;
  for (const snippet of snippets) {
    if (transcriptTail.includes(snippet)) {
      transcriptMatches += 1;
    }
  }
  if (transcriptMatches > 0) {
    score += transcriptMatches * 25;
    evidence.push(`transcript_overlap:${transcriptMatches}`);
  }
  return { score, evidence };
}
