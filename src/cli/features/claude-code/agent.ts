/**
 * Claude Code agent implementation
 * Implements the Agent interface for Claude Code
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { loadConfig, saveConfig } from "@/cli/config.js";
import { LoaderRegistry } from "@/cli/features/claude-code/loaderRegistry.js";
import { success, info } from "@/cli/logger.js";

import type { Agent, SourceProfile } from "@/cli/features/agentRegistry.js";

// Get directory of this file for source profile loading
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Source profiles directory (in the package)
const SOURCE_PROFILES_DIR = path.join(__dirname, "profiles", "config");

/** Instructions file name for Claude Code */
const INSTRUCTIONS_FILE = "CLAUDE.md";

/**
 * Get the profiles directory path for Claude Code
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Path to the profiles directory
 */
const getProfilesDir = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".claude", "profiles");
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

  listSourceProfiles: async (): Promise<Array<SourceProfile>> => {
    const profiles: Array<SourceProfile> = [];

    try {
      const entries = await fs.readdir(SOURCE_PROFILES_DIR, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        // Skip non-directories and internal directories (starting with _)
        if (!entry.isDirectory() || entry.name.startsWith("_")) {
          continue;
        }

        const profileJsonPath = path.join(
          SOURCE_PROFILES_DIR,
          entry.name,
          "profile.json",
        );

        try {
          const content = await fs.readFile(profileJsonPath, "utf-8");
          const profileData = JSON.parse(content);

          profiles.push({
            name: entry.name,
            description: profileData.description || "No description available",
          });
        } catch {
          // Skip profiles without valid profile.json
        }
      }
    } catch {
      // Source profiles directory doesn't exist (shouldn't happen in production)
    }

    return profiles.sort((a, b) => a.name.localeCompare(b.name));
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
      ["claude-code"]: {
        ...existingAgents["claude-code"],
        profile: { baseProfile: profileName },
      },
    };

    await saveConfig({
      username: currentConfig?.auth?.username ?? null,
      password: currentConfig?.auth?.password ?? null,
      organizationUrl: currentConfig?.auth?.organizationUrl ?? null,
      agents: updatedAgents,
      sendSessionTranscript: currentConfig?.sendSessionTranscript ?? null,
      autoupdate: currentConfig?.autoupdate,
      registryAuths: currentConfig?.registryAuths ?? null,
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
