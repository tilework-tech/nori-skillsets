/**
 * Dir Command
 *
 * Opens the Nori profiles directory (~/.nori/profiles) in the system file explorer,
 * falling back to printing the path if opening fails.
 */

import { execFile } from "child_process";

import { log } from "@clack/prompts";

import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";

const openInExplorer = (args: { dirPath: string }): Promise<void> => {
  const { dirPath } = args;
  const command = process.platform === "darwin" ? "open" : "xdg-open";

  return new Promise((resolve, reject) => {
    execFile(command, [dirPath], (error) => {
      if (error != null) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
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

  try {
    await openInExplorer({ dirPath: profilesDir });
    log.success(`Opened ${profilesDir}`);
  } catch {
    log.step(`Nori profiles directory: ${profilesDir}`);
  }
};
