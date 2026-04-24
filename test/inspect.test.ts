import { afterEach, describe, expect, test } from "bun:test";
import {
  inspectPane,
  lastPromptLine,
  paneHasPastedContent,
  paneHasPrompt,
  paneIsWorking,
  promptLineHasBufferedInput,
  promptStillShowsDraft,
} from "../src/tmux/inspect.ts";
import { installTmuxAdapter, resetTmuxAdapter } from "../src/tmux/process.ts";

afterEach(() => {
  resetTmuxAdapter();
});

describe("tmux inspection heuristics", () => {
  test("detects prompt lines and buffered input", () => {
    const text = ["some output", "› investigate the latest test failure"].join("\n");
    expect(paneHasPrompt(text)).toBe(true);
    expect(lastPromptLine(text)).toBe("› investigate the latest test failure");
    expect(promptLineHasBufferedInput(lastPromptLine(text))).toBe(true);
  });

  test("detects visible working state from tail lines", () => {
    const text = ["line 1", "line 2", "Working (12s)", "tail"].join("\n");
    expect(paneIsWorking(text)).toBe(true);
    const waitingText = [
      "• previous step output",
      "◦ Waiting for background terminal (2m 01s • esc to interrupt) · 2 background terminals running · /ps to view · /st…",
      "  └ cargo test -p eth-con-node",
      "› Use /skills to list available skills",
      "  gpt-5.5 xhigh fast · ~/work/projects/ethql",
    ].join("\n");
    expect(paneIsWorking(waitingText)).toBe(true);
    const idleText = ["• Worked for 1m 31s ───", "› Use /skills to list available skills"].join("\n");
    expect(paneIsWorking(idleText)).toBe(false);
  });

  test("detects pasted content buffer", () => {
    expect(paneHasPastedContent("abc\n[Pasted Content 42 bytes]\n")).toBe(true);
  });

  test("matches drafted text prefixes case-insensitively", () => {
    expect(promptStillShowsDraft("> Run the New Benchmark", "run the new benchmark now")).toBe(true);
  });

  test("produces a structured pane snapshot", () => {
    installTmuxAdapter({
      run(args) {
        expect(args).toEqual(["capture-pane", "-p", "-t", "worker:1.1", "-S", "-120"]);
        return ["build output", "› examine the failing path"].join("\n");
      },
    });

    const inspection = inspectPane({ target: "worker:1.1" });
    expect(inspection.target).toBe("worker:1.1");
    expect(inspection.promptVisible).toBe(true);
    expect(inspection.draftBuffered).toBe(true);
    expect(inspection.reachable).toBe(true);
  });
});
