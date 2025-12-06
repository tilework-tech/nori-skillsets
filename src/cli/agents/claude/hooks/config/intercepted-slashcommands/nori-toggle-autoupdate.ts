/**
 * Intercepted slash command for toggling autoupdate
 * Handles /nori-toggle-autoupdate command
 */

import * as fs from "fs/promises";
import * as path from "path";

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
 * @returns The hook output with toggle result, or null if not matched
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

  const installDir = allInstallations[0];
  const configPath = path.join(installDir, ".nori-config.json");

  // Read current config
  let currentConfig: Record<string, unknown> = {};
  try {
    const content = await fs.readFile(configPath, "utf-8");
    currentConfig = JSON.parse(content);
  } catch {
    // No existing config - will create new one
  }

  // Toggle autoupdate field
  // If field doesn't exist or is "enabled", set to "disabled"
  // If field is "disabled", set to "enabled"
  const currentValue = currentConfig.autoupdate as string | undefined;
  const newValue = currentValue === "disabled" ? "enabled" : "disabled";

  const newConfig = {
    ...currentConfig,
    autoupdate: newValue,
  };

  await fs.writeFile(configPath, JSON.stringify(newConfig, null, 2));

  if (newValue === "enabled") {
    return {
      decision: "block",
      reason: formatSuccess({
        message: `Autoupdate is now ENABLED. Nori Profiles will automatically update when a new version is available.`,
      }),
    };
  } else {
    return {
      decision: "block",
      reason: formatSuccess({
        message: `Autoupdate is now DISABLED. You will be notified of new versions but must update manually with 'npx nori-ai install'.`,
      }),
    };
  }
};

/**
 * nori-toggle-autoupdate intercepted slash command
 */
export const noriToggleAutoupdate: InterceptedSlashCommand = {
  matchers: ["^\\/nori-toggle-autoupdate\\s*$"],
  run,
};
