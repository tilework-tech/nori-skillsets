/**
 * Cursor agent implementation
 * Implements the Agent interface for Cursor
 */

import * as fs from "fs/promises";
import * as path from "path";

import { loadConfig, saveConfig } from "@/cli/config.js";
import { CursorLoaderRegistry } from "@/cli/features/cursor-agent/loaderRegistry.js";
import { success, info } from "@/cli/logger.js";

import type { Agent } from "@/cli/features/agentRegistry.js";

/** Instructions file name for Cursor */
const INSTRUCTIONS_FILE = "AGENTS.md";

/**
 * Get the profiles directory path for Cursor
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Path to the profiles directory
 */
const getProfilesDir = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".cursor", "profiles");
};

/**
 * Cursor agent implementation
 */
export const cursorAgent: Agent = {
  name: "cursor-agent",
  displayName: "Cursor Agent",

  getLoaderRegistry: () => {
    return CursorLoaderRegistry.getInstance();
  },

  getGlobalLoaders: () => {
    return [
      { name: "hooks", humanReadableName: "hooks" },
      { name: "slashcommands", humanReadableName: "slash commands" },
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
            await fs.access(instructionsPath);
            profiles.push(entry.name);
          } catch {
            // Skip directories without instructions file
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
      ["cursor-agent"]: {
        ...existingAgents["cursor-agent"],
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
      version: currentConfig?.version ?? null,
      installDir,
    });

    success({
      message: `Switched to "${profileName}" profile for Cursor`,
    });
    info({
      message: `Restart Cursor to load the new profile configuration`,
    });
  },
};
