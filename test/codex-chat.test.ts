import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractCodexResumeThreadId,
  findRecentCodexThreadsContainingText,
  normalizeCodexRolloutMessages,
  readCodexChat,
  scoreCodexThreadCandidate,
} from "../src/chat/codex.ts";

let tempRoot = "";

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = "";
  }
});

function createCodexFixture(): { codexHome: string; threadId: string; rolloutPath: string } {
  tempRoot = mkdtempSync(join(tmpdir(), "tmaxx-codex-"));
  const codexHome = join(tempRoot, ".codex");
  const sessionsDir = join(codexHome, "sessions", "2026", "04", "14");
  mkdirSync(sessionsDir, { recursive: true });
  const threadId = "019d-test-thread-0001";
  const rolloutPath = join(sessionsDir, `rollout-2026-04-14T00-00-00-${threadId}.jsonl`);
  writeFileSync(
    rolloutPath,
    [
      JSON.stringify({ timestamp: "2026-04-14T00:00:00.000Z", type: "session_meta", payload: { id: threadId } }),
      JSON.stringify({ timestamp: "2026-04-14T00:00:01.000Z", type: "event_msg", payload: { type: "user_message", message: "hello from operator" } }),
      JSON.stringify({
        timestamp: "2026-04-14T00:00:02.000Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "looking at the pane now", phase: "commentary" },
      }),
      JSON.stringify({
        timestamp: "2026-04-14T00:00:03.000Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "final answer here", phase: "final_answer" },
      }),
      "",
    ].join("\n"),
  );
  const db = new Database(join(codexHome, "state_5.sqlite"));
  db.run(`CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    rollout_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    source TEXT NOT NULL,
    model_provider TEXT NOT NULL,
    cwd TEXT NOT NULL,
    title TEXT NOT NULL,
    sandbox_policy TEXT NOT NULL,
    approval_mode TEXT NOT NULL,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    has_user_event INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    archived_at INTEGER,
    git_sha TEXT,
    git_branch TEXT,
    git_origin_url TEXT,
    cli_version TEXT NOT NULL DEFAULT '',
    first_user_message TEXT NOT NULL DEFAULT '',
    agent_nickname TEXT,
    agent_role TEXT,
    memory_mode TEXT NOT NULL DEFAULT 'enabled',
    model TEXT,
    reasoning_effort TEXT,
    agent_path TEXT
  )`);
  db.run(
    `INSERT INTO threads (
      id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
      sandbox_policy, approval_mode, first_user_message, cli_version, memory_mode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      threadId,
      rolloutPath,
      1_776_120_000,
      1_776_120_060,
      "cli",
      "openai",
      "/tmp/project",
      "hello from operator",
      "danger-full-access",
      "never",
      "hello from operator",
      "0.120.0",
      "enabled",
    ],
  );
  db.close();
  return { codexHome, threadId, rolloutPath };
}

describe("codex transcript support", () => {
  test("extracts the resumed thread id from codex argv", () => {
    expect(extractCodexResumeThreadId("node /usr/bin/codex --yolo resume 019d7b14-a5ec-7873-b3da-56805a796f61")).toBe(
      "019d7b14-a5ec-7873-b3da-56805a796f61",
    );
    expect(extractCodexResumeThreadId("node /usr/bin/codex --yolo")).toBeNull();
  });

  test("normalizes rollout messages into user/assistant chat entries", () => {
    const messages = normalizeCodexRolloutMessages(
      "thread-1",
      [
        JSON.stringify({ type: "event_msg", timestamp: "2026-04-14T00:00:01.000Z", payload: { type: "user_message", message: "hello" } }),
        JSON.stringify({
          type: "event_msg",
          timestamp: "2026-04-14T00:00:02.000Z",
          payload: { type: "agent_message", message: "working on it", phase: "commentary" },
        }),
        "",
      ].join("\n"),
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: "thread-1:1", role: "user", content: "hello" });
    expect(messages[1]).toMatchObject({ id: "thread-1:2", role: "assistant", phase: "commentary" });
  });

  test("reads codex chat with cursor and role filtering", () => {
    const fixture = createCodexFixture();
    const all = readCodexChat(fixture.threadId, { codexHome: fixture.codexHome });
    expect(all.messages).toHaveLength(3);

    const assistantOnly = readCodexChat(fixture.threadId, {
      codexHome: fixture.codexHome,
      role: "assistant",
      afterMessageId: `${fixture.threadId}:1`,
    });
    expect(assistantOnly.messages).toHaveLength(2);
    expect(assistantOnly.messages.every((message) => message.role === "assistant")).toBe(true);
  });

  test("scores rollout overlap strongly when pane text appears in the transcript tail", () => {
    const fixture = createCodexFixture();
    const scored = scoreCodexThreadCandidate(
      {
        id: fixture.threadId,
        rolloutPath: fixture.rolloutPath,
        updatedAt: 1_776_120_060,
        cwd: "/tmp/project",
        title: "hello from operator",
        firstUserMessage: "hello from operator",
      },
      {
        cwd: "/tmp/project",
        visibleText: "looking at the pane now\nfinal answer here",
        nowUnix: 1_776_120_100,
      },
    );
    expect(scored.score).toBeGreaterThanOrEqual(70);
    expect(scored.evidence.some((entry) => entry.startsWith("rollout_overlap:"))).toBe(true);
  });

  test("finds recent codex threads containing a probe nonce", () => {
    const fixture = createCodexFixture();
    const matches = findRecentCodexThreadsContainingText("/tmp/project", "final answer here", {
      codexHome: fixture.codexHome,
      limit: 5,
    });
    expect(matches.map((match) => match.id)).toEqual([fixture.threadId]);
  });
});
