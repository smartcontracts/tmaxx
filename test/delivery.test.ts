import { describe, expect, test } from "bun:test";
import { didTranscriptMatchMessage, shouldRetryBecausePromptStillShowsDraft } from "../src/message/delivery.ts";

describe("transcript-aware delivery helpers", () => {
  test("matches an exact user transcript message at or after the send time", () => {
    const matched = didTranscriptMatchMessage(
      [
        {
          id: "thread:1",
          role: "user",
          timestamp: "2026-04-14T00:00:02.000Z",
          content: "hello test message from tmaxx",
        },
      ],
      "hello test message from tmaxx",
      "2026-04-14T00:00:01.000Z",
    );
    expect(matched).toBe(true);
  });

  test("does not match a pre-existing earlier user message", () => {
    const matched = didTranscriptMatchMessage(
      [
        {
          id: "thread:1",
          role: "user",
          timestamp: "2026-04-14T00:00:00.000Z",
          content: "hello test message from tmaxx",
        },
      ],
      "hello test message from tmaxx",
      "2026-04-14T00:00:01.000Z",
    );
    expect(matched).toBe(false);
  });

  test("retries only when the pane still visibly shows the drafted message", () => {
    expect(
      shouldRetryBecausePromptStillShowsDraft("some output\n› hello test message from tmaxx", "hello test message from tmaxx"),
    ).toBe(true);
    expect(shouldRetryBecausePromptStillShowsDraft("some output\n› ", "hello test message from tmaxx")).toBe(false);
  });
});
