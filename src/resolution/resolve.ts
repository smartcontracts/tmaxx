import {
  extractCodexResumeThreadId,
  getCodexThreadById,
  listRecentCodexThreadsByCwd,
  scoreCodexThreadCandidate,
} from "../chat/codex.ts";
import { listRecentClaudeSessionsByCwd, scoreClaudeSessionCandidate } from "../chat/claude.ts";
import { inspectPane } from "../tmux/inspect.ts";
import { getPaneRuntimeInfo } from "../tmux/runtime.ts";
import type { ResolutionReceipt } from "./types.ts";

export function resolvePaneToChat(
  target: string,
  options?: {
    codexHome?: string;
  },
): ResolutionReceipt {
  const inspection = inspectPane({ target });
  const runtime = getPaneRuntimeInfo({ target });
  const fingerprint = {
    paneId: runtime.paneId,
    panePid: String(runtime.panePid),
    paneTty: runtime.paneTty,
    currentPath: runtime.currentPath,
    lastPromptLine: inspection.lastPromptLine,
    visibleTextPrefix: inspection.visibleText.slice(0, 160),
  };
  const childArgs = runtime.childProcesses.map((child) => child.args).join("\n");
  if (/\bcodex\b/i.test(childArgs)) {
    for (const child of runtime.childProcesses) {
      if (!/\bcodex\b/i.test(child.args)) {
        continue;
      }
      const threadId = extractCodexResumeThreadId(child.args);
      if (!threadId) {
        continue;
      }
      const thread = getCodexThreadById(threadId, options?.codexHome);
      if (!thread) {
        continue;
      }
      return {
        tmuxTarget: target,
        resolved: true,
        fingerprint,
        chat: {
          provider: "codex",
          sessionId: thread.id,
          rolloutPath: thread.rolloutPath,
        },
        method: "process_resume",
        confidence: "high",
        evidence: [`provider:codex`, `child_process:${child.pid}`, `resume_id:${thread.id}`],
      };
    }
    const candidates = listRecentCodexThreadsByCwd(runtime.currentPath, 12, options?.codexHome);
    const scored = candidates
      .map((candidate) => ({
        candidate,
        ...scoreCodexThreadCandidate(candidate, {
          cwd: runtime.currentPath,
          visibleText: inspection.visibleText,
        }),
      }))
      .sort((left, right) => right.score - left.score);
    const best = scored[0];
    const second = scored[1];
    if (best && best.score >= 45 && (!second || best.score - second.score >= 15)) {
      return {
        tmuxTarget: target,
        resolved: true,
        fingerprint,
        chat: {
          provider: "codex",
          sessionId: best.candidate.id,
          rolloutPath: best.candidate.rolloutPath,
        },
        method: "recent_rollout_match",
        confidence: best.evidence.some((entry) => entry.startsWith("rollout_overlap:2") || entry.startsWith("rollout_overlap:3"))
          ? "high"
          : "medium",
        evidence: ["provider:codex", ...best.evidence],
      };
    }
    return {
      tmuxTarget: target,
      resolved: false,
      fingerprint,
      evidence: scored.slice(0, 3).map((entry) => `codex:${entry.candidate.id}:${entry.score}:${entry.evidence.join(",")}`),
    };
  }
  if (/\bclaude\b/i.test(runtime.currentCommand) || /\bclaude\b/i.test(childArgs)) {
    const candidates = listRecentClaudeSessionsByCwd(runtime.currentPath, 12);
    const scored = candidates
      .map((candidate) => ({
        candidate,
        ...scoreClaudeSessionCandidate(candidate, {
          cwd: runtime.currentPath,
          visibleText: inspection.visibleText,
        }),
      }))
      .sort((left, right) => right.score - left.score);
    const best = scored[0];
    const second = scored[1];
    if (best && best.score >= 45 && (!second || best.score - second.score >= 15)) {
      return {
        tmuxTarget: target,
        resolved: true,
        fingerprint,
        chat: {
          provider: "claude",
          sessionId: best.candidate.id,
          transcriptPath: best.candidate.transcriptPath,
        },
        method: "recent_rollout_match",
        confidence: best.evidence.some((entry) => entry.startsWith("transcript_overlap:2") || entry.startsWith("transcript_overlap:3"))
          ? "high"
          : "medium",
        evidence: ["provider:claude", ...best.evidence],
      };
    }
    return {
      tmuxTarget: target,
      resolved: false,
      fingerprint,
      evidence: scored.slice(0, 3).map((entry) => `claude:${entry.candidate.id}:${entry.score}:${entry.evidence.join(",")}`),
    };
  }
  return {
    tmuxTarget: target,
    resolved: false,
    fingerprint,
    evidence: ["provider_unknown"],
  };
}
