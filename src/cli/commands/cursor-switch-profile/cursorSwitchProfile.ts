/**
 * cursor-switch-profile CLI command
 * Switches the active Cursor profile and reinstalls
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { installCursorMain } from "@/cli/commands/install-cursor/installCursor.js";
import { loadConfig, saveConfig } from "@/cli/config.js";
import { getCursorProfilesDir } from "@/cli/env.js";
import { success, info } from "@/cli/logger.js";

import type { Command } from "commander";

/**
 * List all available Cursor profiles from ~/.cursor/profiles/
 *
 * @returns Array of profile names
 */
export const listCursorProfiles = async (): Promise<Array<string>> => {
  const profilesDir = getCursorProfilesDir({ installDir: os.homedir() });
  const profiles: Array<string> = [];

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

  return profiles;
};

/**
 * Switch to a Cursor profile by name
 * Updates config and reinstalls Cursor profiles
 *
 * @param args - Function arguments
 * @param args.profileName - Name of profile to switch to
 */
export const cursorSwitchProfile = async (args: {
  profileName: string;
}): Promise<void> => {
  const { profileName } = args;
  const installDir = os.homedir();

  const profilesDir = getCursorProfilesDir({ installDir });

  // 1. Verify profile exists by checking for CLAUDE.md in profile directory
  const profileDir = path.join(profilesDir, profileName);
  try {
    const claudeMdPath = path.join(profileDir, "CLAUDE.md");
    await fs.access(claudeMdPath);
  } catch {
    throw new Error(`Profile "${profileName}" not found in ${profilesDir}`);
  }

  // 2. Load current config
  const currentConfig = await loadConfig({ installDir });

  // 3. Preserve existing settings, update cursorProfile
  await saveConfig({
    username: currentConfig?.auth?.username || null,
    password: currentConfig?.auth?.password || null,
    organizationUrl: currentConfig?.auth?.organizationUrl || null,
    profile: currentConfig?.profile || null,
    cursorProfile: {
      baseProfile: profileName,
    },
    sendSessionTranscript: currentConfig?.sendSessionTranscript ?? null,
    autoupdate: currentConfig?.autoupdate,
    registryAuths: currentConfig?.registryAuths ?? null,
    installDir,
  });

  success({ message: `Switched Cursor to "${profileName}" profile` });

  // 4. Run install-cursor to apply the profile
  info({ message: "Applying profile configuration..." });
  await installCursorMain();
};

/**
 * Register the 'cursor-switch-profile' command with commander
 *
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerCursorSwitchProfileCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("cursor-switch-profile <name>")
    .description("Switch to a different Cursor profile and reinstall")
    .action(async (name: string) => {
      await cursorSwitchProfile({ profileName: name });
    });
};
