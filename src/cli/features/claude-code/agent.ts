/**
 * Claude Code agent implementation
 * Implements the Agent interface for Claude Code
 */

import * as fs from "fs/promises";
import * as path from "path";

import { loadConfig, saveConfig } from "@/cli/config.js";
import { LoaderRegistry } from "@/cli/features/claude-code/loaderRegistry.js";
import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";
import { success, info } from "@/cli/logger.js";

import type { Agent } from "@/cli/features/agentRegistry.js";

/** Instructions file name for Claude Code */
const INSTRUCTIONS_FILE = "CLAUDE.md";

/**
 * Get the profiles directory path for Claude Code
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Path to the profiles directory (in .nori/profiles/)
 */
const getProfilesDir = (args: { installDir: string }): string => {
  return getNoriProfilesDir(args);
};

/**
 * Claude Code agent implementation
 */
export const claudeCodeAgent: Agent = {
  name: "claude-code",
  displayName: "Claude Code",

  getLoaderRegistry: () => {
    return LoaderRegistry.getInstance();
  },

  getGlobalLoaders: () => {
    return [
      { name: "hooks", humanReadableName: "hooks" },
      { name: "statusline", humanReadableName: "statusline" },
      { name: "slashcommands", humanReadableName: "global slash commands" },
      { name: "announcements", humanReadableName: "announcements" },
    ];
  },

  listProfiles: async (args: {
    installDir: string;
  }): Promise<Array<string>> => {
    const { installDir } = args;
    const profilesDir = getProfilesDir({ installDir });
    const profiles: Array<string> = [];

    try {
      await fs.access(profilesDir);
      const entries = await fs.readdir(profilesDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const instructionsPath = path.join(
            profilesDir,
            entry.name,
            INSTRUCTIONS_FILE,
          );
          try {
            // Check if this is a flat profile (has CLAUDE.md directly)
            await fs.access(instructionsPath);
            profiles.push(entry.name);
          } catch {
            // Not a flat profile - check if it's an org directory with nested profiles
            // Org directories contain subdirectories with CLAUDE.md files
            try {
              const orgDir = path.join(profilesDir, entry.name);
              const subEntries = await fs.readdir(orgDir, {
                withFileTypes: true,
              });

              for (const subEntry of subEntries) {
                if (subEntry.isDirectory()) {
                  const nestedInstructionsPath = path.join(
                    orgDir,
                    subEntry.name,
                    INSTRUCTIONS_FILE,
                  );
                  try {
                    await fs.access(nestedInstructionsPath);
                    // Found a nested profile - use org/profile format
                    profiles.push(`${entry.name}/${subEntry.name}`);
                  } catch {
                    // Skip subdirectories without instructions file
                  }
                }
              }
            } catch {
              // Skip directories that can't be read
            }
          }
        }
      }
    } catch {
      // Profiles directory doesn't exist
    }

    return profiles.sort();
  },

  switchProfile: async (args: {
    installDir: string;
    profileName: string;
  }): Promise<void> => {
    const { installDir, profileName } = args;
    const profilesDir = getProfilesDir({ installDir });

    // Verify profile exists
    // profileName can be flat (e.g., "senior-swe") or namespaced (e.g., "myorg/my-profile")
    // path.join handles both cases correctly since it just joins the path components
    const profileDir = path.join(profilesDir, profileName);
    const instructionsPath = path.join(profileDir, INSTRUCTIONS_FILE);

    try {
      await fs.access(instructionsPath);
    } catch {
      throw new Error(`Profile "${profileName}" not found in ${profilesDir}`);
    }

    // Load current config
    const currentConfig = await loadConfig({ installDir });

    // Get existing agents config (agents keys are the source of truth for installed agents)
    const existingAgents = currentConfig?.agents ?? {};

    // Update profile for this agent
    const updatedAgents = {
      ...existingAgents,
      ["claude-code"]: {
        ...existingAgents["claude-code"],
        profile: { baseProfile: profileName },
      },
    };

    await saveConfig({
      username: currentConfig?.auth?.username ?? null,
      password: currentConfig?.auth?.password ?? null,
      refreshToken: currentConfig?.auth?.refreshToken ?? null,
      organizationUrl: currentConfig?.auth?.organizationUrl ?? null,
      agents: updatedAgents,
      sendSessionTranscript: currentConfig?.sendSessionTranscript ?? null,
      autoupdate: currentConfig?.autoupdate,
      registryAuths: currentConfig?.registryAuths ?? null,
      version: currentConfig?.version ?? null,
      installDir,
    });

    success({
      message: `Switched to "${profileName}" profile for Claude Code`,
    });
    info({
      message: `Restart Claude Code to load the new profile configuration`,
    });
  },
};
