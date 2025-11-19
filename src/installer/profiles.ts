/**
 * Profile management for Nori Profiles
 * Handles profile listing, loading, and switching
 */

import * as fs from "fs/promises";
import * as path from "path";

import { loadDiskConfig, saveDiskConfig } from "@/installer/config.js";
import { getClaudeProfilesDir } from "@/installer/env.js";
import { success, info } from "@/installer/logger.js";

/**
 * List all available profiles from ~/.claude/profiles/
 * @param args - Configuration arguments
 * @param args.installDir - Custom installation directory (optional)
 *
 * @returns Array of profile names
 */
export const listProfiles = async (args?: {
  installDir?: string | null;
}): Promise<Array<string>> => {
  const { installDir } = args || {};
  const profilesDir = getClaudeProfilesDir({ installDir });
  const profiles: Array<string> = [];

  try {
    // Check if profiles directory exists
    await fs.access(profilesDir);

    // Read all directories in profiles directory
    const entries = await fs.readdir(profilesDir, {
      withFileTypes: true,
    });

    // Get all directories that contain a CLAUDE.md file
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const claudeMdPath = path.join(profilesDir, entry.name, "CLAUDE.md");
        try {
          await fs.access(claudeMdPath);
          profiles.push(entry.name);
        } catch {
          // Skip directories without CLAUDE.md
        }
      }
    }
  } catch (err: any) {
    throw new Error(
      `Failed to list profiles from ${profilesDir}: ${err.message}`,
    );
  }

  return profiles;
};

/**
 * Switch to a profile by name
 * Preserves auth credentials, updates profile selection
 * @param args - Function arguments
 * @param args.profileName - Name of profile to switch to
 * @param args.installDir - Custom installation directory (optional)
 */
export const switchProfile = async (args: {
  profileName: string;
  installDir?: string | null;
}): Promise<void> => {
  const { profileName, installDir } = args;
  const profilesDir = getClaudeProfilesDir({ installDir });

  // 1. Verify profile exists by checking for CLAUDE.md in profile directory
  const profileDir = path.join(profilesDir, profileName);
  try {
    const claudeMdPath = path.join(profileDir, "CLAUDE.md");
    await fs.access(claudeMdPath);
  } catch {
    throw new Error(`Profile "${profileName}" not found in ${profilesDir}`);
  }

  // 2. Load current disk config
  const currentConfig = await loadDiskConfig({ installDir });

  // 3. Preserve auth, update profile
  await saveDiskConfig({
    username: currentConfig?.auth?.username || null,
    password: currentConfig?.auth?.password || null,
    organizationUrl: currentConfig?.auth?.organizationUrl || null,
    profile: {
      baseProfile: profileName,
    },
    installDir,
  });

  success({ message: `Switched to "${profileName}" profile` });
  info({
    message: `Restart Claude Code to load the new profile configuration`,
  });
};
