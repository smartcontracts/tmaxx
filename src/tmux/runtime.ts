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
