/**
 * Dir Command
 *
 * Opens the Nori profiles directory (~/.nori/profiles) in the system file explorer,
 * falling back to printing the path if opening fails.
 */

import { spawn } from "child_process";

import { log } from "@clack/prompts";

import { getNoriSkillsetsDir } from "@/norijson/skillset.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";

const openInExplorer = (args: { dirPath: string }): void => {
  const { dirPath } = args;
  const command = process.platform === "darwin" ? "open" : "xdg-open";

  const child = spawn(command, [dirPath], { detached: true, stdio: "ignore" });

  if (child.pid == null) {
    throw new Error(`Failed to spawn ${command}`);
  }

  child.unref();
};

/**
 * Main function for dir command
 * Opens the Nori profiles directory in the system file explorer,
 * falling back to printing the path if opening fails.
 *
 * @param args - Configuration arguments
 * @param args.nonInteractive - If true, output plain path without opening explorer
 *
 * @returns Command status
 */
export const dirMain = async (args?: {
  nonInteractive?: boolean | null;
}): Promise<CommandStatus> => {
  const { nonInteractive } = args ?? {};
  const skillsetsDir = getNoriSkillsetsDir();

  if (nonInteractive) {
    // Plain output for scripting
    process.stdout.write(skillsetsDir + "\n");
    return { success: true, cancelled: false, message: "Done" };
  }

  let opened = false;
  try {
    openInExplorer({ dirPath: skillsetsDir });
    opened = true;
  } catch {
    // Fall through to fallback
  }

  if (opened) {
    log.success(`Opened ${skillsetsDir}`);
  } else {
    log.step(`Nori profiles directory: ${skillsetsDir}`);
  }
  return { success: true, cancelled: false, message: "Done" };
};
