export type ChatRef = {
  sessionId: string;
  provider: "codex" | "claude";
  rolloutPath?: string;
  transcriptPath?: string;
};

export type ChatCursor = {
  chat: ChatRef;
  afterMessageId?: string;
  afterTimestamp?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  timestamp?: string;
  content: string;
  phase?: string;
  sourceKind?: string;
};

export type ChatReadResult = {
  chat: ChatRef;
  messages: ChatMessage[];
  cursor?: ChatCursor;
};
