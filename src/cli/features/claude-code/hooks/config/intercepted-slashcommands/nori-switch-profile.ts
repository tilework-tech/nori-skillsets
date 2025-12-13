/**
 * Intercepted slash command for switching profiles
 * Handles /nori-switch-profile commands for instant profile switching
 */

import * as fs from "fs/promises";
import * as path from "path";

import { AgentRegistry } from "@/cli/features/agentRegistry.js";
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
 * @returns The hook output with switch result, or null if not matched
 */
const run = async (args: { input: HookInput }): Promise<HookOutput | null> => {
  const { input } = args;
  const { prompt, cwd } = input;

  // Extract profile name if provided (matcher already validated the pattern)
  const trimmedPrompt = prompt.trim();
  const profileMatch = trimmedPrompt.match(
    /^\/nori-switch-profile(?:\s+([a-z0-9-]+))?\s*$/i,
  );
  const profileName = profileMatch?.[1] ?? null;

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

  // List available profiles using agent method
  const profiles = await agent.listProfiles({ installDir });

  if (profiles.length === 0) {
    const profilesDir = path.join(installDir, ".claude", "profiles");
    return {
      decision: "block",
      reason: formatError({
        message: `No profiles found in ${profilesDir}.\n\nRun 'nori-ai install' to install profiles.`,
      }),
    };
  }

  // If no profile name provided, show available profiles
  if (profileName == null) {
    return {
      decision: "block",
      reason: formatSuccess({
        message: `Available profiles: ${profiles.join(", ")}\n\nUsage: /nori-switch-profile <profile-name>`,
      }),
    };
  }

  // Check if profile exists
  if (!profiles.includes(profileName)) {
    return {
      decision: "block",
      reason: formatError({
        message: `Profile "${profileName}" not found.\n\nAvailable profiles: ${profiles.join(", ")}`,
      }),
    };
  }

  // Switch to the profile using agent method
  try {
    await agent.switchProfile({ installDir, profileName });

    // Run install in non-interactive mode with skipUninstall to apply profile changes
    // This is the same pattern used by the CLI `nori-ai switch-profile` command
    // CRITICAL: Use silent mode to prevent stdout pollution during hook execution
    // (JSON response corruption - installMain outputs ASCII art and messages)
    const { main: installMain } =
      await import("@/cli/commands/install/install.js");
    await installMain({
      nonInteractive: true,
      skipUninstall: true,
      installDir,
      agent: "claude-code",
      silent: true,
    });

    // Read profile description if available
    let profileDescription = "";
    try {
      const profilesDir = path.join(installDir, ".claude", "profiles");
      const profileJsonPath = path.join(
        profilesDir,
        profileName,
        "profile.json",
      );
      const profileJson = JSON.parse(
        await fs.readFile(profileJsonPath, "utf-8"),
      );
      if (profileJson.description) {
        profileDescription = profileJson.description;
      }
    } catch {
      // No profile.json or no description
    }

    return {
      decision: "block",
      reason: formatSuccess({
        message: `Profile switched to "${profileName}"${profileDescription ? `: ${profileDescription}` : ""}.\n\nRestart Claude Code to apply the changes.`,
      }),
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      decision: "block",
      reason: formatError({
        message: `Failed to switch profile: ${errorMessage}`,
      }),
    };
  }
};

/**
 * nori-switch-profile intercepted slash command
 */
export const noriSwitchProfile: InterceptedSlashCommand = {
  matchers: [
    "^\\/nori-switch-profile\\s*$",
    "^\\/nori-switch-profile\\s+[a-z0-9-]+\\s*$",
  ],
  run,
};
