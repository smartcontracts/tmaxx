import { spawnSync } from "node:child_process";

export type TmuxAdapter = {
  run(args: string[], allowFailure: boolean): string;
};

const defaultAdapter: TmuxAdapter = {
  run(args: string[], allowFailure: boolean): string {
    const result = spawnSync("tmux", args, { encoding: "utf8" });
    if (result.status !== 0 && !allowFailure) {
      throw new Error(result.stderr.trim() || `tmux ${args.join(" ")} exited with status ${result.status}`);
    }
    return result.stdout ?? "";
  },
};

let adapter: TmuxAdapter = defaultAdapter;

export function runTmux(args: string[], allowFailure = false): string {
  return adapter.run(args, allowFailure);
}

export function installTmuxAdapter(nextAdapter: TmuxAdapter): void {
  adapter = nextAdapter;
}

export function resetTmuxAdapter(): void {
  adapter = defaultAdapter;
}

export function requireTmuxCommand(): void {
  const result = spawnSync("bash", ["-lc", "command -v tmux"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error("missing required command: tmux");
  }
}
