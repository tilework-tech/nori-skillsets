/**
 * Intercepted slash command for switching skillsets
 * Handles /nori-switch-skillset and /nori-switch-profile (alias) commands
 */

import { execSync } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";

import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";
import { setSilentMode } from "@/cli/logger.js";
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
        message: `No skillsets found in ${profilesDir}.\n\nRun 'nori-ai install' to install skillsets.`,
      }),
    };
  }

  // If no skillset name provided, show available skillsets
  if (profileName == null) {
    return {
      decision: "block",
      reason: formatSuccess({
        message: `Available skillsets: ${profiles.join(", ")}\n\nUsage: /nori-switch-skillset <skillset-name>`,
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

  // Switch to the skillset using agent method
  // Enable silent mode to prevent console output from corrupting JSON response.
  // agent.switchProfile() calls success() and info() which would pollute stdout.
  setSilentMode({ silent: true });
  try {
    await agent.switchProfile({ installDir, profileName });

    // Run install to apply skillset changes via subprocess.
    //
    // IMPORTANT: We use subprocess (execSync) instead of dynamic import because
    // this hook script is bundled by esbuild. When bundled, __dirname resolves
    // to the bundled script location (hooks/config/) instead of the original
    // loader locations, breaking path resolution in installMain's loaders.
    // Spawning nori-ai as a subprocess runs the CLI from its installed location
    // where paths resolve correctly.
    // See: https://github.com/evanw/esbuild/issues/1921
    //
    // --skip-builtin-profiles prevents installing all built-in profiles when
    // user has downloaded a specific profile from the registry.
    execSync(
      `nori-ai install --non-interactive --silent --skip-uninstall --skip-builtin-profiles --install-dir "${installDir}" --agent claude-code`,
      { stdio: ["ignore", "ignore", "ignore"] },
    );

    // Read skillset description if available
    // Try nori.json first, fall back to profile.json for backward compatibility
    let profileDescription = "";
    try {
      const profilesDir = getNoriProfilesDir({ installDir });
      const noriJsonPath = path.join(profilesDir, profileName, "nori.json");
      const profileJsonPath = path.join(
        profilesDir,
        profileName,
        "profile.json",
      );

      let profileData: { description?: string };
      try {
        profileData = JSON.parse(await fs.readFile(noriJsonPath, "utf-8"));
      } catch {
        profileData = JSON.parse(await fs.readFile(profileJsonPath, "utf-8"));
      }

      if (profileData.description) {
        profileDescription = profileData.description;
      }
    } catch {
      // No metadata file or no description
    }

    return {
      decision: "block",
      reason: formatSuccess({
        message: `Skillset switched to "${profileName}"${profileDescription ? `: ${profileDescription}` : ""}.\n\nRestart Claude Code to apply the changes.`,
      }),
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      decision: "block",
      reason: formatError({
        message: `Failed to switch skillset: ${errorMessage}`,
      }),
    };
  } finally {
    // Always restore logging
    setSilentMode({ silent: false });
  }
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
