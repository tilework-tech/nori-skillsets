/**
 * Intercepted slash command for switching skillsets
 * Handles /nori-switch-skillset and /nori-switch-profile (alias) commands
 *
 * This hook is informational only -- it tells the user how to switch
 * skillsets from their terminal rather than performing the switch itself.
 */

import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";
import { getInstallDirs } from "@/utils/path.js";

import type {
  HookInput,
  HookOutput,
  InterceptedSlashCommand,
} from "./types.js";

import { formatError, formatSuccess } from "./format.js";

/**
 * Run the nori-switch-profile command
 * @param args - The function arguments
 * @param args.input - The hook input containing prompt and cwd
 *
 * @returns The hook output with informational message, or null if not matched
 */
const run = async (args: { input: HookInput }): Promise<HookOutput | null> => {
  const { input } = args;
  const { prompt, cwd } = input;

  // Extract skillset name if provided (matcher already validated the pattern)
  // Matches both /nori-switch-skillset and /nori-switch-profile (alias)
  const trimmedPrompt = prompt.trim();
  const skillsetMatch = trimmedPrompt.match(
    /^\/nori-switch-(?:skillset|profile)(?:\s+([a-z0-9-]+))?\s*$/i,
  );
  const profileName = skillsetMatch?.[1] ?? null;

  // Find installation directory
  const allInstallations = getInstallDirs({ currentDir: cwd });

  if (allInstallations.length === 0) {
    return {
      decision: "block",
      reason: formatError({ message: `No Nori installation found.` }),
    };
  }

  const installDir = allInstallations[0]; // Use closest installation
  const agent = AgentRegistry.getInstance().get({ name: "claude-code" });

  // List available skillsets using agent method
  const profiles = await agent.listProfiles({ installDir });

  if (profiles.length === 0) {
    const profilesDir = getNoriProfilesDir({ installDir });
    return {
      decision: "block",
      reason: formatError({
        message: `No skillsets found in ${profilesDir}.\n\nRun 'nori-skillsets init' to install skillsets.`,
      }),
    };
  }

  // If no skillset name provided, show available skillsets with terminal usage
  if (profileName == null) {
    return {
      decision: "block",
      reason: formatSuccess({
        message: `Available skillsets: ${profiles.join(", ")}\n\nUsage: Run 'nori-skillsets switch-skillset <name>' from your terminal`,
      }),
    };
  }

  // Check if skillset exists
  if (!profiles.includes(profileName)) {
    return {
      decision: "block",
      reason: formatError({
        message: `Skillset "${profileName}" not found.\n\nAvailable skillsets: ${profiles.join(", ")}`,
      }),
    };
  }

  // Return informational message directing user to terminal
  return {
    decision: "block",
    reason: formatSuccess({
      message: `To switch to skillset '${profileName}', run 'nori-skillsets switch-skillset ${profileName}' from your terminal, then restart Claude Code.`,
    }),
  };
};

/**
 * nori-switch-skillset intercepted slash command
 * Also matches /nori-switch-profile as an alias for backward compatibility
 */
export const noriSwitchProfile: InterceptedSlashCommand = {
  matchers: [
    "^\\/nori-switch-skillset\\s*$",
    "^\\/nori-switch-skillset\\s+[a-z0-9-]+\\s*$",
    "^\\/nori-switch-profile\\s*$",
    "^\\/nori-switch-profile\\s+[a-z0-9-]+\\s*$",
  ],
  run,
};
