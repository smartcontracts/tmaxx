import { spawnSync } from "node:child_process";
import type { PaneTarget } from "./types.ts";
import { runTmux } from "./process.ts";

export type PaneRuntimeInfo = {
  target: string;
  paneId: string;
  panePid: number;
  paneTty: string;
  currentCommand: string;
  currentPath: string;
  childProcesses: PaneChildProcess[];
};

export type PaneChildProcess = {
  pid: number;
  args: string;
};

export type PaneIdentity = {
  target: string;
  paneId: string;
  currentCommand: string;
  currentPath: string;
};

export function getCurrentPaneTarget(): string {
  const fromEnv = process.env.TMUX_PANE?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const raw = runTmux(
    ["display-message", "-p", "#{session_name}:#{window_index}.#{pane_index}"],
    false,
  ).trim();
  if (!raw) {
    throw new Error("unable to resolve current tmux pane");
  }
  return raw;
}

export function getPaneIdentity(pane: PaneTarget): PaneIdentity {
  const raw = runTmux(
    [
      "display-message",
      "-p",
      "-t",
      pane.target,
      "#{session_name}:#{window_index}.#{pane_index}\t#{pane_id}\t#{pane_current_command}\t#{pane_current_path}",
    ],
    false,
  ).trim();
  const [target, paneId, currentCommand, currentPath] = raw.split("\t");
  if (!target || !paneId || !currentPath) {
    throw new Error(`unable to parse pane identity metadata for ${pane.target}`);
  }
  return {
    target,
    paneId,
    currentCommand: currentCommand ?? "",
    currentPath,
  };
}

export function getCurrentPaneIdentity(): PaneIdentity {
  return getPaneIdentity({ target: getCurrentPaneTarget() });
}

export function listPaneIdentities(): PaneIdentity[] {
  const raw = runTmux(
    [
      "list-panes",
      "-a",
      "-F",
      "#{session_name}:#{window_index}.#{pane_index}\t#{pane_id}\t#{pane_current_command}\t#{pane_current_path}",
    ],
    false,
  ).trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [target, paneId, currentCommand, currentPath] = line.split("\t");
      if (!target || !paneId || !currentPath) {
        throw new Error(`unable to parse pane identity metadata row: ${line}`);
      }
      return {
        target,
        paneId,
        currentCommand: currentCommand ?? "",
        currentPath,
      };
    });
}

export function getPaneRuntimeInfo(pane: PaneTarget): PaneRuntimeInfo {
  const raw = runTmux(
    [
      "display-message",
      "-p",
      "-t",
      pane.target,
      "#{pane_id}\t#{pane_pid}\t#{pane_tty}\t#{pane_current_command}\t#{pane_current_path}",
    ],
    false,
  ).trim();
  const [paneId, panePidRaw, paneTty, currentCommand, currentPath] = raw.split("\t");
  const panePid = Number(panePidRaw);
  if (!paneId || !Number.isInteger(panePid) || !paneTty || !currentPath) {
    throw new Error(`unable to parse tmux runtime metadata for ${pane.target}`);
  }
  return {
    target: pane.target,
    paneId,
    panePid,
    paneTty,
    currentCommand: currentCommand ?? "",
    currentPath,
    childProcesses: listChildProcesses(panePid),
  };
}

function listChildProcesses(parentPid: number): PaneChildProcess[] {
  const result = spawnSync("bash", ["-lc", `ps -o pid=,args= --ppid ${parentPid}`], { encoding: "utf8" });
  if (result.status !== 0) {
    return [];
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) {
        return null;
      }
      return {
        pid: Number(match[1]),
        args: match[2] ?? "",
      };
    })
    .filter((entry): entry is PaneChildProcess => entry !== null);
}
