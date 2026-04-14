import { readChat } from "../chat/read.ts";
import type { ChatMessage, ChatRef } from "../chat/types.ts";
import { inspectPane, lastPromptLine, paneHasPastedContent, promptStillShowsDraft, sendKey } from "../tmux/inspect.ts";
import { sendMessageToPane, type ExistingInputPolicy } from "../tmux/send.ts";
import type { PaneTarget, SendReceipt } from "../tmux/types.ts";
import { resolvePaneToChat } from "../resolution/resolve.ts";

type TranscriptReceipt = NonNullable<SendReceipt["transcript"]>;

export async function deliverMessageWithReceipt(
  pane: PaneTarget,
  message: string,
  options?: {
    submitDelaySeconds?: number;
    existingInputPolicy?: ExistingInputPolicy;
    transcriptPolls?: number;
    transcriptPollIntervalMs?: number;
  },
): Promise<SendReceipt> {
  const sendStartedAt = new Date();
  const lowLevelReceipt = await sendMessageToPane(
    pane,
    message,
    options?.submitDelaySeconds ?? 0.2,
    options?.existingInputPolicy ?? "clear",
  );

  const resolution = resolvePaneToChat(pane.target);
  if (!resolution.resolved || !resolution.chat) {
    return {
      ...lowLevelReceipt,
      deliveryConfirmed: lowLevelReceipt.confirmedWorking,
      transcript: {
        checked: false,
        matched: false,
        replyObserved: false,
        retryEnterAttempted: false,
        pollCount: 0,
      },
    };
  }

  let transcript = await confirmTranscriptDelivery(resolution.chat, message, sendStartedAt, resolution.fingerprint.currentPath, {
    polls: options?.transcriptPolls ?? 3,
    pollIntervalMs: options?.transcriptPollIntervalMs ?? 700,
  });

  if (!transcript.matched && shouldRetrySubmitAfterWeakReceipt(pane, message)) {
    sendKey(pane, "C-m");
    await Bun.sleep(900);
    const retried = await confirmTranscriptDelivery(resolution.chat, message, sendStartedAt, resolution.fingerprint.currentPath, {
      polls: options?.transcriptPolls ?? 3,
      pollIntervalMs: options?.transcriptPollIntervalMs ?? 700,
    });
    transcript = {
      ...retried,
      retryEnterAttempted: true,
      pollCount: transcript.pollCount + retried.pollCount,
    };
  }

  return {
    ...lowLevelReceipt,
    deliveryConfirmed: lowLevelReceipt.confirmedWorking || transcript.matched,
    transcript,
  };
}

async function confirmTranscriptDelivery(
  chat: ChatRef,
  message: string,
  sentAt: Date,
  cwd: string | undefined,
  options: {
    polls: number;
    pollIntervalMs: number;
  },
): Promise<TranscriptReceipt> {
  const normalizedBody = normalizeMessageBody(message);
  for (let pollIndex = 0; pollIndex < options.polls; pollIndex += 1) {
    const result = readChat(chat, {
      role: "all",
      tail: true,
      limit: 80,
      cwd,
    });
    const matched = findTranscriptMatch(result.messages, normalizedBody, sentAt);
    if (matched) {
      const reply = findAssistantReplyAfter(result.messages, matched.index);
      return {
        checked: true,
        matched: true,
        provider: chat.provider,
        sessionId: chat.sessionId,
        matchedMessageId: matched.message.id,
        replyObserved: reply !== null,
        replyMessageId: reply?.id,
        retryEnterAttempted: false,
        pollCount: pollIndex + 1,
      };
    }
    if (pollIndex < options.polls - 1) {
      await Bun.sleep(options.pollIntervalMs);
    }
  }
  return {
    checked: true,
    matched: false,
    provider: chat.provider,
    sessionId: chat.sessionId,
    replyObserved: false,
    retryEnterAttempted: false,
    pollCount: options.polls,
  };
}

function findTranscriptMatch(
  messages: ChatMessage[],
  normalizedBody: string,
  sentAt: Date,
): {
  index: number;
  message: ChatMessage;
} | null {
  const sentAtIso = sentAt.toISOString();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== "user") {
      continue;
    }
    if (normalizeMessageBody(message.content) !== normalizedBody) {
      continue;
    }
    if (typeof message.timestamp === "string" && message.timestamp < sentAtIso) {
      continue;
    }
    return { index, message };
  }
  return null;
}

function findAssistantReplyAfter(messages: ChatMessage[], matchedIndex: number): ChatMessage | null {
  for (let index = matchedIndex + 1; index < messages.length; index += 1) {
    if (messages[index]?.role === "assistant") {
      return messages[index] ?? null;
    }
  }
  return null;
}

function shouldRetrySubmitAfterWeakReceipt(pane: PaneTarget, message: string): boolean {
  const inspection = inspectPane(pane);
  return shouldRetryBecausePromptStillShowsDraft(inspection.visibleText, message);
}

function normalizeMessageBody(body: string): string {
  return body.replace(/\r\n/g, "\n").trim();
}

export function didTranscriptMatchMessage(
  messages: ChatMessage[],
  message: string,
  sentAtIso: string,
): boolean {
  return findTranscriptMatch(messages, normalizeMessageBody(message), new Date(sentAtIso)) !== null;
}

export function shouldRetryBecausePromptStillShowsDraft(visibleText: string, message: string): boolean {
  return paneHasPastedContent(visibleText) || promptStillShowsDraft(lastPromptLine(visibleText), message);
}
