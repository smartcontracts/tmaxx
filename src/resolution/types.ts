import type { ChatRef } from "../chat/types.ts";

export type PaneFingerprint = {
  paneId?: string;
  panePid?: string;
  paneTty?: string;
  currentPath?: string;
  lastPromptLine?: string;
  visibleTextPrefix?: string;
};

export type ResolutionMethod =
  | "cache"
  | "visible_text_match"
  | "nonce_probe"
  | "manual"
  | "process_resume"
  | "recent_rollout_match";

export type BindingRecord = {
  tmuxTarget: string;
  fingerprint: PaneFingerprint;
  chat: ChatRef;
  method: ResolutionMethod;
  confidence: "low" | "medium" | "high";
  resolvedAt: string;
};

export type ResolutionReceipt = {
  tmuxTarget: string;
  resolved: boolean;
  fingerprint: PaneFingerprint;
  chat?: ChatRef;
  method?: ResolutionMethod;
  confidence?: "low" | "medium" | "high";
  evidence: string[];
};
