/**
 * Intercepted slash command for toggling session transcripts
 * Handles /nori-toggle-session-transcripts command
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
 * Run the nori-toggle-session-transcripts command
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

  // Toggle sendSessionTranscript field
  // If field doesn't exist or is "enabled", set to "disabled"
  // If field is "disabled", set to "enabled"
  const currentValue = currentConfig.sendSessionTranscript as
    | string
    | undefined;
  const newValue = currentValue === "disabled" ? "enabled" : "disabled";

  const newConfig = {
    ...currentConfig,
    sendSessionTranscript: newValue,
  };

  await fs.writeFile(configPath, JSON.stringify(newConfig, null, 2));

  if (newValue === "enabled") {
    return {
      decision: "block",
      reason: formatSuccess({
        message: `Session transcripts are now ENABLED. Your conversations will be summarized and stored.`,
      }),
    };
  } else {
    return {
      decision: "block",
      reason: formatSuccess({
        message: `Session transcripts are now DISABLED. Your conversations will not be summarized or stored.`,
      }),
    };
  }
};

/**
 * nori-toggle-session-transcripts intercepted slash command
 */
export const noriToggleSessionTranscripts: InterceptedSlashCommand = {
  matchers: ["^\\/nori-toggle-session-transcripts\\s*$"],
  run,
};
