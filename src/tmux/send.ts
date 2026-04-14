import type { PaneTarget, SendReceipt } from "./types.ts";
import {
  capturePane,
  clearPromptBuffer,
  lastPromptLine,
  nudgePromptInput,
  paneHasPastedContent,
  paneIsWorking,
  promptLineHasBufferedInput,
  promptStillShowsDraft,
  sendKey,
  sendLiteral,
} from "./inspect.ts";

export type ExistingInputPolicy = "clear" | "error";

export async function sendMessageToPane(
  pane: PaneTarget,
  message: string,
  submitDelaySeconds: number,
  existingInputPolicy: ExistingInputPolicy = "clear",
): Promise<SendReceipt> {
  const beforePane = capturePane(pane);
  const beforePrompt = lastPromptLine(beforePane);
  const hadRiskyBufferedState = paneHasPastedContent(beforePane) || promptLineHasBufferedInput(beforePrompt);
  let sendMode: "typed_message" | "cleared_existing_buffer" = "typed_message";
  let unstickAttempted = false;

  // This guard exists because silently clobbering an agent's drafted prompt is
  // the main operator-visible failure mode for tmux-based delivery.
  if (hadRiskyBufferedState) {
    if (existingInputPolicy === "error") {
      throw new Error(`pane ${pane.target} has buffered prompt input; rerun with a clear policy if overwrite is intended`);
    }
    sendMode = "cleared_existing_buffer";
    await clearPromptBuffer(pane);
  }

  sendLiteral(pane, message);
  await Bun.sleep(submitDelaySeconds * 1000);
  sendKey(pane, "C-m");
  await Bun.sleep(1000);

  let afterPane = capturePane(pane);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (paneIsWorking(afterPane)) {
      break;
    }
    if (promptStillShowsDraft(lastPromptLine(afterPane), message)) {
      await nudgePromptInput(pane);
      unstickAttempted = true;
      sendKey(pane, "C-m");
      await Bun.sleep(1000);
      afterPane = capturePane(pane);
      continue;
    }
    if (!paneHasPastedContent(afterPane)) {
      break;
    }
    sendKey(pane, "C-m");
    await Bun.sleep(1000);
    afterPane = capturePane(pane);
  }

  return {
    target: pane.target,
    beforePrompt,
    afterPrompt: lastPromptLine(afterPane),
    confirmedWorking: paneIsWorking(afterPane),
    unstickAttempted,
    sendMode,
  };
}
