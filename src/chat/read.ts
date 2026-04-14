import { readClaudeChat } from "./claude.ts";
import { readCodexChat } from "./codex.ts";
import type { ChatMessage, ChatReadResult, ChatRef } from "./types.ts";

export function readChat(
  chat: ChatRef,
  options?: {
    role?: ChatMessage["role"] | "all";
    limit?: number;
    tail?: boolean;
    afterMessageId?: string;
    afterTimestamp?: string;
    cwd?: string;
  },
): ChatReadResult {
  if (chat.provider === "claude") {
    return readClaudeChat(chat.sessionId, {
      role: options?.role,
      limit: options?.limit,
      tail: options?.tail,
      afterMessageId: options?.afterMessageId,
      afterTimestamp: options?.afterTimestamp,
      cwd: options?.cwd,
    });
  }
  return readCodexChat(chat.sessionId, {
    role: options?.role,
    limit: options?.limit,
    tail: options?.tail,
    afterMessageId: options?.afterMessageId,
    afterTimestamp: options?.afterTimestamp,
  });
}
