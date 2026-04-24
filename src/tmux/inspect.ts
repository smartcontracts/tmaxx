import type { PaneInspection, PaneTarget } from "./types.ts";
import { runTmux } from "./process.ts";

export function capturePane(pane: PaneTarget, startLine = -120): string {
  return runTmux(["capture-pane", "-p", "-t", pane.target, "-S", String(startLine)], true);
}

export function sendLiteral(pane: PaneTarget, text: string): void {
  runTmux(["send-keys", "-t", pane.target, "-l", "--", text]);
}

export function sendKey(pane: PaneTarget, key: string): void {
  runTmux(["send-keys", "-t", pane.target, key]);
}

export async function nudgePromptInput(pane: PaneTarget): Promise<void> {
  sendKey(pane, "Space");
  await Bun.sleep(75);
  sendKey(pane, "BSpace");
  await Bun.sleep(150);
}

export async function clearPromptBuffer(pane: PaneTarget): Promise<void> {
  sendKey(pane, "Escape");
  await Bun.sleep(100);
  sendKey(pane, "C-u");
  await Bun.sleep(150);
}

export function paneHasPrompt(paneText: string): boolean {
  return /^[\s]*[›❯>]/m.test(paneText);
}

export function paneIsWorking(paneText: string): boolean {
  const lines = paneText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const tail = lines.slice(-8);
  return tail.some((line) => line.includes("Working (") || /esc to interrupt/i.test(line));
}

export function paneHasPastedContent(paneText: string): boolean {
  return paneText.includes("[Pasted Content");
}

export function lastPromptLine(paneText: string): string {
  const matches = paneText.split(/\r?\n/).filter((line) => /^[\s]*[›❯>]/.test(line));
  return matches.at(-1) ?? "";
}

export function promptLineHasBufferedInput(promptLine: string): boolean {
  if (!promptLine) {
    return false;
  }
  const normalized = promptLine.replace(/^[\s]*[›❯>]\s*/, "").trim();
  if (!normalized) {
    return false;
  }
  if (normalized.includes("Improve documentation in @filename")) {
    return false;
  }
  if (normalized.includes("Implement {feature}")) {
    return false;
  }
  return true;
}

function normalizePromptText(text: string): string {
  return text.replace(/^[\s]*[›❯>]\s*/, "").trim().toLowerCase();
}

export function promptStillShowsDraft(promptLine: string, message: string): boolean {
  const normalizedPrompt = normalizePromptText(promptLine);
  const normalizedMessage = message.trim().toLowerCase();
  if (!normalizedPrompt || !normalizedMessage) {
    return false;
  }
  const prefix = normalizedMessage.slice(0, Math.min(32, normalizedMessage.length));
  if (prefix.length > 0 && normalizedPrompt.includes(prefix)) {
    return true;
  }
  return normalizedMessage.includes(normalizedPrompt);
}

export function inspectPane(pane: PaneTarget, startLine = -120): PaneInspection {
  const visibleText = capturePane(pane, startLine);
  return {
    target: pane.target,
    reachable: visibleText.length > 0,
    promptVisible: paneHasPrompt(visibleText),
    busy: paneIsWorking(visibleText),
    pastedContent: paneHasPastedContent(visibleText),
    draftBuffered: promptLineHasBufferedInput(lastPromptLine(visibleText)),
    lastPromptLine: lastPromptLine(visibleText),
    captureStartLine: startLine,
    visibleText,
  };
}
