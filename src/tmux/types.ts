import type { ChatRef } from "../chat/types.ts";

export type PaneTarget = {
  target: string;
};

export type PaneInspection = {
  target: string;
  reachable: boolean;
  promptVisible: boolean;
  busy: boolean;
  pastedContent: boolean;
  draftBuffered: boolean;
  lastPromptLine: string;
  captureStartLine: number;
  visibleText: string;
};

export type SendReceipt = {
  target: string;
  beforePrompt: string;
  afterPrompt: string;
  confirmedWorking: boolean;
  unstickAttempted: boolean;
  sendMode: "typed_message" | "cleared_existing_buffer";
  deliveryConfirmed?: boolean;
  transcript?: {
    checked: boolean;
    matched: boolean;
    provider?: ChatRef["provider"];
    sessionId?: string;
    matchedMessageId?: string;
    replyObserved: boolean;
    replyMessageId?: string;
    retryEnterAttempted: boolean;
    pollCount: number;
  };
};
