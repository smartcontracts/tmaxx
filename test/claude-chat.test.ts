import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claudeProjectDirForCwd,
  findRecentClaudeSessionsContainingText,
  normalizeClaudeMessages,
  readClaudeChat,
  scoreClaudeSessionCandidate,
} from "../src/chat/claude.ts";

let tempRoot = "";

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = "";
  }
});

function createClaudeFixture(): { claudeHome: string; sessionId: string; transcriptPath: string; cwd: string } {
  tempRoot = mkdtempSync(join(tmpdir(), "tmaxx-claude-"));
  const claudeHome = join(tempRoot, ".claude");
  const cwd = "/tmp/project";
  const projectDir = claudeProjectDirForCwd(cwd, claudeHome);
  mkdirSync(projectDir, { recursive: true });
  const sessionId = "7b1654f3-dc8e-4b36-b203-df8fca16679d";
  const transcriptPath = join(projectDir, `${sessionId}.jsonl`);
  writeFileSync(
    transcriptPath,
    [
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-14T00:00:01.000Z",
        sessionId,
        cwd,
        message: { role: "user", content: "hello test message from tmaxx" },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-04-14T00:00:02.000Z",
        sessionId,
        cwd,
        message: { role: "assistant", content: [{ type: "text", text: "Hello — received. Ready when you are." }] },
      }),
      "",
    ].join("\n"),
  );
  return { claudeHome, sessionId, transcriptPath, cwd };
}

describe("claude transcript support", () => {
  test("maps cwd to the claude project directory", () => {
    expect(claudeProjectDirForCwd("/home/k/work/autogrind", "/tmp/.claude")).toBe(
      "/tmp/.claude/projects/-home-k-work-autogrind",
    );
  });

  test("normalizes claude transcripts into user/assistant chat entries", () => {
    const messages = normalizeClaudeMessages(
      "session-1",
      [
        JSON.stringify({ type: "user", timestamp: "2026-04-14T00:00:01.000Z", message: { role: "user", content: "hello" } }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-04-14T00:00:02.000Z",
          message: { role: "assistant", content: [{ type: "text", text: "received" }] },
        }),
        "",
      ].join("\n"),
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "hello" });
    expect(messages[1]).toMatchObject({ role: "assistant", content: "received" });
  });

  test("reads claude chat from the durable session file", () => {
    const fixture = createClaudeFixture();
    const result = readClaudeChat(fixture.sessionId, {
      claudeHome: fixture.claudeHome,
      cwd: fixture.cwd,
    });
    expect(result.chat.provider).toBe("claude");
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]?.content).toContain("Ready when you are");
  });

  test("scores transcript overlap and finds sessions containing sent text", () => {
    const fixture = createClaudeFixture();
    const matches = findRecentClaudeSessionsContainingText(fixture.cwd, "hello test message from tmaxx", {
      claudeHome: fixture.claudeHome,
    });
    expect(matches.map((match) => match.id)).toEqual([fixture.sessionId]);

    const scored = scoreClaudeSessionCandidate(
      {
        id: fixture.sessionId,
        transcriptPath: fixture.transcriptPath,
        updatedAtMs: Date.now(),
        cwd: fixture.cwd,
        firstUserMessage: "hello test message from tmaxx",
      },
      {
        cwd: fixture.cwd,
        visibleText: "Hello — received. Ready when you are.",
        nowMs: Date.now(),
      },
    );
    expect(scored.score).toBeGreaterThanOrEqual(45);
    expect(scored.evidence.some((entry) => entry.startsWith("transcript_overlap:"))).toBe(true);
  });
});
