/**
 * Update prompt module for CLI auto-update
 *
 * Handles formatting the update message and resolving the correct
 * update command based on the package manager.
 */

import { log, select, isCancel } from "@clack/prompts";

export type UpdateChoice = "update" | "skip" | "dismiss";

export type UpdateCommand = {
  command: string;
  args: Array<string>;
  displayCommand: string;
};

/**
 * Get the correct update command for the detected package manager.
 *
 * @param args - Arguments
 * @param args.installSource - The detected package manager (npm, bun, yarn, pnpm, unknown)
 *
 * @returns UpdateCommand object or null if package manager is unknown
 */
export const getUpdateCommand = (args: {
  installSource: string;
}): UpdateCommand | null => {
  const { installSource } = args;

  switch (installSource) {
    case "npm":
      return {
        command: "npm",
        args: ["install", "-g", "nori-skillsets@latest"],
        displayCommand: "npm install -g nori-skillsets@latest",
      };
    case "bun":
      return {
        command: "bun",
        args: ["install", "-g", "nori-skillsets@latest"],
        displayCommand: "bun install -g nori-skillsets@latest",
      };
    case "yarn":
      return {
        command: "yarn",
        args: ["global", "add", "nori-skillsets@latest"],
        displayCommand: "yarn global add nori-skillsets@latest",
      };
    case "pnpm":
      return {
        command: "pnpm",
        args: ["add", "-g", "nori-skillsets@latest"],
        displayCommand: "pnpm add -g nori-skillsets@latest",
      };
    default:
      return null;
  }
};

/**
 * Show the interactive update prompt and return the user's choice.
 *
 * @param args - Arguments
 * @param args.currentVersion - The current version
 * @param args.latestVersion - The latest available version
 * @param args.isInteractive - Whether we're in interactive mode
 * @param args.updateCommand - The update command to show in non-interactive mode
 *
 * @returns The user's update choice
 */
export const showUpdatePrompt = async (args: {
  currentVersion: string;
  latestVersion: string;
  isInteractive: boolean;
  updateCommand: UpdateCommand | null;
}): Promise<UpdateChoice> => {
  const { currentVersion, latestVersion, isInteractive, updateCommand } = args;

  if (!isInteractive) {
    const cmdStr =
      updateCommand?.displayCommand ?? "npm install -g nori-skillsets@latest";
    log.warn(
      `Update available: ${currentVersion} \u2192 ${latestVersion}. Run: ${cmdStr}`,
    );
    return "skip";
  }

  const choice = await select({
    message: `Update available! ${currentVersion} \u2192 ${latestVersion}`,
    options: [
      { value: "update", label: "Update now" },
      { value: "skip", label: "Skip" },
      { value: "dismiss", label: "Skip until next version" },
    ],
  });

  if (isCancel(choice)) {
    return "skip";
  }

  return choice as UpdateChoice;
};
