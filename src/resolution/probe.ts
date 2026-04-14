import { randomBytes } from "node:crypto";
import { findRecentCodexThreadsContainingText } from "../chat/codex.ts";
import { inspectPane } from "../tmux/inspect.ts";
import { sendMessageToPane, type ExistingInputPolicy } from "../tmux/send.ts";
import { getPaneRuntimeInfo } from "../tmux/runtime.ts";
import type { ResolutionReceipt } from "./types.ts";

export async function probePaneToChat(
  target: string,
  options?: {
    waitMs?: number;
    submitDelaySeconds?: number;
    existingInputPolicy?: ExistingInputPolicy;
    codexHome?: string;
  },
): Promise<ResolutionReceipt> {
  const runtime = getPaneRuntimeInfo({ target });
  const inspection = inspectPane({ target });
  const nonce = `tmaxx-resolve-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  await sendMessageToPane(
    { target },
    `TMAXX_RESOLVE_NONCE ${nonce}`,
    options?.submitDelaySeconds ?? 0.2,
    options?.existingInputPolicy ?? "error",
  );
  await Bun.sleep(options?.waitMs ?? 1500);
  const matches = findRecentCodexThreadsContainingText(runtime.currentPath, nonce, {
    codexHome: options?.codexHome,
    limit: 20,
  });
  const fingerprint = {
    paneId: runtime.paneId,
    panePid: String(runtime.panePid),
    paneTty: runtime.paneTty,
    currentPath: runtime.currentPath,
    lastPromptLine: inspection.lastPromptLine,
    visibleTextPrefix: inspection.visibleText.slice(0, 160),
  };
  if (matches.length === 1) {
    const match = matches[0];
    return {
      tmuxTarget: target,
      resolved: true,
      fingerprint,
      chat: {
        provider: "codex",
        sessionId: match.id,
        rolloutPath: match.rolloutPath,
      },
      method: "nonce_probe",
      confidence: "high",
      evidence: [`probe_nonce:${nonce}`, `cwd_match`, `rollout_match:${match.id}`],
    };
  }
  return {
    tmuxTarget: target,
    resolved: false,
    fingerprint,
    evidence: [`probe_nonce:${nonce}`, `matches:${matches.map((match) => match.id).join(",") || "none"}`],
  };
}
