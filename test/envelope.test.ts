import { describe, expect, test } from "bun:test";
import { formatMessageEnvelope } from "../src/message/envelope.ts";

describe("formatMessageEnvelope", () => {
  test("renders the expected terminal envelope", () => {
    const message = formatMessageEnvelope({
      messageId: "msg-123",
      from: "supervisor",
      to: "worker:1.1",
      sentAt: new Date("2026-04-14T10:00:00.000Z"),
      body: "check the latest output\nand report back",
    });

    expect(message).toBe(
      [
        "[tmaxx-message v1]",
        "message_id: msg-123",
        "from: supervisor",
        "to: worker:1.1",
        "sent_at: 2026-04-14T10:00:00.000Z",
        "body:",
        "check the latest output",
        "and report back",
        "[/tmaxx-message]",
      ].join("\n"),
    );
  });
});
