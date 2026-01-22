/**
 * Profiles feature loader for cursor-agent
 * Installs profile templates to ~/.cursor/profiles/
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { getCursorProfilesDir } from "@/cli/features/cursor-agent/paths.js";
import { CursorProfileLoaderRegistry } from "@/cli/features/cursor-agent/profiles/profileLoaderRegistry.js";
import { success, info, warn } from "@/cli/logger.js";

import type { Config } from "@/cli/config.js";
import type { Loader, ValidationResult } from "@/cli/features/agentRegistry.js";

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Profile templates config directory (relative to this loader)
const PROFILE_TEMPLATES_DIR = path.join(__dirname, "config");

/**
 * Install profile templates to ~/.cursor/profiles/
 * Each profile is self-contained with all content inlined directly
 *
 * When config.skipBuiltinProfiles is true, this function skips copying built-in profiles
 * entirely. This is used during switch-profile operations where the user has downloaded
 * a profile from the registry and doesn't want all built-in profiles installed.
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const installProfiles = async (args: { config: Config }): Promise<void> => {
  const { config } = args;

  const cursorProfilesDir = getCursorProfilesDir({
    installDir: config.installDir,
  });

  // Create profiles directory if it doesn't exist
  await fs.mkdir(cursorProfilesDir, { recursive: true });

  // Skip installing built-in profiles if flag is set (used during switch-profile)
  if (config.skipBuiltinProfiles === true) {
    info({
      message:
        "Skipping built-in profile installation (switch-profile mode)...",
    });
    return;
  }

  info({ message: "Installing Cursor profiles..." });

  let installedCount = 0;
  let skippedCount = 0;

  // Read all directories from templates directory (these are built-in profiles)
  const entries = await fs.readdir(PROFILE_TEMPLATES_DIR, {
    withFileTypes: true,
  });

  // Install user-facing profiles
  // Internal directories (starting with _) are NEVER installed
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) {
      continue; // Skip non-directories and internal directories
    }

    const profileSrcDir = path.join(PROFILE_TEMPLATES_DIR, entry.name);
    const profileDestDir = path.join(cursorProfilesDir, entry.name);

    try {
      // User-facing profile - must have AGENTS.md
      const agentsMdPath = path.join(profileSrcDir, "AGENTS.md");
      await fs.access(agentsMdPath);

      // Remove existing profile directory if it exists
      await fs.rm(profileDestDir, { recursive: true, force: true });

      // Create destination directory
      await fs.mkdir(profileDestDir, { recursive: true });

      // Copy all profile content directly (no mixin composition)
      // Skip profile.json (legacy format) - we use nori.json instead
      await fs.cp(profileSrcDir, profileDestDir, {
        recursive: true,
        filter: (source) => !source.endsWith("profile.json"),
      });

      success({
        message: `✓ ${entry.name} profile installed`,
      });
      installedCount++;
    } catch {
      warn({
        message: `Profile directory ${entry.name} not found or invalid, skipping`,
      });
      skippedCount++;
    }
  }

  if (installedCount > 0) {
    success({
      message: `Successfully installed ${installedCount} profile${
        installedCount === 1 ? "" : "s"
      }`,
    });
    info({ message: `Profiles directory: ${cursorProfilesDir}` });
  }
  if (skippedCount > 0) {
    warn({
      message: `Skipped ${skippedCount} profile${
        skippedCount === 1 ? "" : "s"
      } (not found or invalid)`,
    });
  }
};

/**
 * Uninstall profiles directory
 * Profiles are never deleted - users manage them via the registry
 * Only logs that profiles are preserved
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const uninstallProfiles = async (args: { config: Config }): Promise<void> => {
  const { config } = args;

  const cursorProfilesDir = getCursorProfilesDir({
    installDir: config.installDir,
  });

  // Profiles are never deleted during uninstall
  // Users manage their profiles via the registry and we preserve all customizations
  info({ message: "Preserving Cursor profiles (profiles are never deleted)" });

  try {
    await fs.access(cursorProfilesDir);

    const entries = await fs.readdir(cursorProfilesDir, {
      withFileTypes: true,
    });

    const profileCount = entries.filter((e) => e.isDirectory()).length;
    if (profileCount > 0) {
      info({
        message: `  ${profileCount} profile${profileCount === 1 ? "" : "s"} preserved`,
      });
    }
  } catch {
    info({ message: "Profiles directory not found (may not be installed)" });
  }
};

/**
 * Validate profiles installation
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 *
 * @returns Validation result
 */
const validate = async (args: {
  config: Config;
}): Promise<ValidationResult> => {
  const { config } = args;

  const cursorProfilesDir = getCursorProfilesDir({
    installDir: config.installDir,
  });

  const errors: Array<string> = [];

  // Check if profiles directory exists
  try {
    await fs.access(cursorProfilesDir);
  } catch {
    errors.push(`Profiles directory not found at ${cursorProfilesDir}`);
    errors.push(
      'Run "nori-ai install --agent cursor-agent" to create the profiles directory',
    );
    return {
      valid: false,
      message: "Profiles directory not found",
      errors,
    };
  }

  // Check if at least one profile exists
  const entries = await fs.readdir(cursorProfilesDir, { withFileTypes: true });
  const profiles = entries.filter((e) => e.isDirectory());

  if (profiles.length === 0) {
    errors.push("No profiles found in profiles directory");
    errors.push(
      'Run "nori-ai install --agent cursor-agent" to install profiles',
    );
    return {
      valid: false,
      message: "No profiles installed",
      errors,
    };
  }

  return {
    valid: true,
    message: `${profiles.length} profile(s) installed`,
    errors: null,
  };
};

/**
 * Profiles feature loader
 */
export const profilesLoader: Loader = {
  name: "profiles",
  description: "Profile templates in ~/.cursor/profiles/",
  run: async (args: { config: Config }) => {
    const { config } = args;
    await installProfiles({ config });

    // Install all profile-dependent features
    const registry = CursorProfileLoaderRegistry.getInstance();
    const loaders = registry.getAll();
    for (const loader of loaders) {
      await loader.install({ config });
    }
  },
  uninstall: async (args: { config: Config }) => {
    const { config } = args;

    // Uninstall profile-dependent features in reverse order
    const registry = CursorProfileLoaderRegistry.getInstance();
    const loaders = registry.getAllReversed();
    for (const loader of loaders) {
      await loader.uninstall({ config });
    }

    await uninstallProfiles({ config });
  },
  validate,
};

/**
 * Export internal functions for testing
 * Note: Mixin composition has been removed - all content is now inlined in profiles
 */
export const _testing = {
  getMixinPaths: undefined,
};
