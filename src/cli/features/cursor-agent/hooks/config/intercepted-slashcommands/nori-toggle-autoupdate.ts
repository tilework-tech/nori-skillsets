/**
 * Intercepted slash command for toggling autoupdate
 * Handles /nori-toggle-autoupdate command
 *
 * Autoupdate has been removed. This command now informs the user
 * that updates are always notification-only.
 */

import { getInstallDirs } from "@/utils/path.js";

import type {
  HookInput,
  HookOutput,
  InterceptedSlashCommand,
} from "./types.js";

import { formatError, formatSuccess } from "./format.js";

/**
 * Run the nori-toggle-autoupdate command
 * @param args - The function arguments
 * @param args.input - The hook input containing prompt and cwd
 *
 * @returns The hook output with informational message, or null if not matched
 */
const run = async (args: { input: HookInput }): Promise<HookOutput | null> => {
  const { input } = args;
  const { cwd } = input;

  // Find installation directory
  const allInstallations = getInstallDirs({ currentDir: cwd });

  if (allInstallations.length === 0) {
    return {
      decision: "block",
      reason: formatError({ message: `No Nori installation found.` }),
    };
  }

  // Autoupdate is now always notification-only. The toggle no longer changes behavior.
  return {
    decision: "block",
    reason: formatSuccess({
      message: `Automatic updates have been removed. Nori Skillsets will notify you when a new version is available. To update, run 'npm install -g nori-skillsets' from your terminal, then 'nori-skillsets switch-skillset <your-skillset>' to apply.`,
    }),
  };
};

/**
 * nori-toggle-autoupdate intercepted slash command
 */
export const noriToggleAutoupdate: InterceptedSlashCommand = {
  matchers: ["^\\/nori-toggle-autoupdate\\s*$"],
  run,
};
