/**
 * Dir Command
 *
 * Opens the Nori profiles directory (~/.nori/profiles) in the system file explorer,
 * falling back to printing the path if opening fails.
 */

import { spawn } from "child_process";

import { log, outro } from "@clack/prompts";

import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";

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
 */
export const dirMain = async (args?: {
  nonInteractive?: boolean | null;
}): Promise<void> => {
  const { nonInteractive } = args ?? {};
  const profilesDir = getNoriProfilesDir();

  if (nonInteractive) {
    // Plain output for scripting
    process.stdout.write(profilesDir + "\n");
    return;
  }

  let opened = false;
  try {
    openInExplorer({ dirPath: profilesDir });
    opened = true;
  } catch {
    // Fall through to fallback
  }

  if (opened) {
    log.success(`Opened ${profilesDir}`);
  } else {
    log.step(`Nori profiles directory: ${profilesDir}`);
  }
  outro("Done");
};
