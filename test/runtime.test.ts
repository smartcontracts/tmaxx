import { afterEach, describe, expect, test } from "bun:test";
import {
  getCurrentPaneIdentity,
  getCurrentPaneTarget,
  getPaneIdentity,
  listPaneIdentities,
} from "../src/tmux/runtime.ts";
import { installTmuxAdapter, resetTmuxAdapter } from "../src/tmux/process.ts";

afterEach(() => {
  resetTmuxAdapter();
  delete process.env.TMUX_PANE;
});

describe("tmux runtime helpers", () => {
  test("prefers TMUX_PANE when resolving the current pane target", () => {
    process.env.TMUX_PANE = "%42";
    expect(getCurrentPaneTarget()).toBe("%42");
  });

  test("parses a pane identity snapshot", () => {
    installTmuxAdapter({
      run(args) {
        expect(args).toEqual([
          "display-message",
          "-p",
          "-t",
          "worker:1.1",
          "#{session_name}:#{window_index}.#{pane_index}\t#{pane_id}\t#{pane_current_command}\t#{pane_current_path}",
        ]);
        return "worker:1.1\t%7\tbun\t/home/k/work/tmaxx\n";
      },
    });

    expect(getPaneIdentity({ target: "worker:1.1" })).toEqual({
      target: "worker:1.1",
      paneId: "%7",
      currentCommand: "bun",
      currentPath: "/home/k/work/tmaxx",
    });
  });

  test("derives the current pane identity from TMUX_PANE", () => {
    process.env.TMUX_PANE = "%3";
    installTmuxAdapter({
      run(args) {
        expect(args).toEqual([
          "display-message",
          "-p",
          "-t",
          "%3",
          "#{session_name}:#{window_index}.#{pane_index}\t#{pane_id}\t#{pane_current_command}\t#{pane_current_path}",
        ]);
        return "claude4:1.1\t%3\tclaude\t/home/k/work/autogrind\n";
      },
    });

    expect(getCurrentPaneIdentity()).toEqual({
      target: "claude4:1.1",
      paneId: "%3",
      currentCommand: "claude",
      currentPath: "/home/k/work/autogrind",
    });
  });

  test("lists pane identities across tmux sessions", () => {
    installTmuxAdapter({
      run(args) {
        expect(args).toEqual([
          "list-panes",
          "-a",
          "-F",
          "#{session_name}:#{window_index}.#{pane_index}\t#{pane_id}\t#{pane_current_command}\t#{pane_current_path}",
        ]);
        return [
          "claude4:1.1\t%1\tclaude\t/home/k/work/autogrind",
          "codex1:1.1\t%2\tbun\t/home/k/work/tmaxx",
        ].join("\n");
      },
    });

    expect(listPaneIdentities()).toEqual([
      {
        target: "claude4:1.1",
        paneId: "%1",
        currentCommand: "claude",
        currentPath: "/home/k/work/autogrind",
      },
      {
        target: "codex1:1.1",
        paneId: "%2",
        currentCommand: "bun",
        currentPath: "/home/k/work/tmaxx",
      },
    ]);
  });
});
