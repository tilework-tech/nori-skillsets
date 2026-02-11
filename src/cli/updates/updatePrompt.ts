/**
 * Update prompt module for CLI auto-update
 *
 * Handles formatting the update message and resolving the correct
 * update command based on the package manager.
 */

import * as readline from "readline";

export type UpdateChoice = "update" | "skip" | "dismiss";

export type UpdateCommand = {
  command: string;
  args: Array<string>;
  displayCommand: string;
};

/**
 * Format the update available message for display.
 *
 * @param args - Arguments
 * @param args.currentVersion - The current version
 * @param args.latestVersion - The latest available version
 *
 * @returns Formatted update message string with ANSI colors
 */
export const formatUpdateMessage = (args: {
  currentVersion: string;
  latestVersion: string;
}): string => {
  const { currentVersion, latestVersion } = args;
  return [
    "",
    `\x1b[33m┃\x1b[0m  🍙 Update available! ${currentVersion} → ${latestVersion}`,
    "\x1b[33m┃\x1b[0m",
    "\x1b[33m┃\x1b[0m  1. Update now",
    "\x1b[33m┃\x1b[0m  2. Skip",
    "\x1b[33m┃\x1b[0m  3. Skip until next version\n\n",
  ].join("\n");
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
    process.stderr.write(
      `[nori-skillsets] Update available: ${currentVersion} → ${latestVersion}. Run: ${cmdStr}\n`,
    );
    return "skip";
  }

  const message = formatUpdateMessage({ currentVersion, latestVersion });
  process.stderr.write(message);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise<UpdateChoice>((resolve) => {
    rl.question("Choose [1/2/3] (default: 2): ", (answer) => {
      rl.close();
      const trimmed = answer.trim();
      if (trimmed === "1") {
        resolve("update");
      } else if (trimmed === "3") {
        resolve("dismiss");
      } else {
        resolve("skip");
      }
    });
  });
};
