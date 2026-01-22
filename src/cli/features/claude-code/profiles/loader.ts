/**
 * Profiles feature loader
 * Installs profile templates to ~/.nori/profiles/
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { type Config } from "@/cli/config.js";
import {
  getNoriProfilesDir,
  getClaudeSettingsFile,
} from "@/cli/features/claude-code/paths.js";
import { ProfileLoaderRegistry } from "@/cli/features/claude-code/profiles/profileLoaderRegistry.js";
import { success, info, warn } from "@/cli/logger.js";

import type { Loader, ValidationResult } from "@/cli/features/agentRegistry.js";

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Profile templates config directory (relative to this loader)
const PROFILE_TEMPLATES_DIR = path.join(__dirname, "config");

/**
 * Install profile templates to ~/.nori/profiles/
 *
 * This function copies built-in profiles from the nori-ai package to ~/.nori/profiles/.
 * Each profile directory contains all its content directly (skills, subagents, etc.)
 * without any mixin composition - profiles are self-contained.
 *
 * Built-in profiles are NEVER overwritten to preserve user customizations.
 * Custom profiles (those that don't exist in the nori-ai package) are never touched.
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

  const noriProfilesDir = getNoriProfilesDir({
    installDir: config.installDir,
  });

  // Create profiles directory if it doesn't exist
  await fs.mkdir(noriProfilesDir, { recursive: true });

  // Skip installing built-in profiles if flag is set (used during switch-profile)
  if (config.skipBuiltinProfiles === true) {
    info({
      message:
        "Skipping built-in profile installation (switch-profile mode)...",
    });
    // Still configure permissions for profiles directory
    await configureProfilesPermissions({ config });
    return;
  }

  info({ message: "Installing Nori profiles..." });

  let installedCount = 0;
  let skippedCount = 0;

  // Read all directories from templates directory (these are built-in profiles)
  const entries = await fs.readdir(PROFILE_TEMPLATES_DIR, {
    withFileTypes: true,
  });

  // Install user-facing profiles directly (no mixin composition needed)
  // Internal directories (starting with _) are skipped
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) {
      continue; // Skip non-directories and internal directories
    }

    const profileSrcDir = path.join(PROFILE_TEMPLATES_DIR, entry.name);
    const profileDestDir = path.join(noriProfilesDir, entry.name);

    try {
      // User-facing profile - must have CLAUDE.md
      const claudeMdPath = path.join(profileSrcDir, "CLAUDE.md");
      await fs.access(claudeMdPath);

      // Skip if profile already exists - never overwrite user profiles
      // Users can update profiles via the registry if they want newer versions
      try {
        await fs.access(profileDestDir);
        info({
          message: `  ${entry.name} already exists, skipping (use registry to update)`,
        });
        skippedCount++;
        continue;
      } catch {
        // Profile doesn't exist, proceed with installation
      }

      // Create destination directory
      await fs.mkdir(profileDestDir, { recursive: true });

      // Copy all profile content directly (profiles are self-contained)
      // Skip profile.json (legacy format) - we use nori.json instead
      const profileEntries = await fs.readdir(profileSrcDir, {
        withFileTypes: true,
      });

      for (const profileEntry of profileEntries) {
        // Skip legacy profile.json - nori.json is the new format
        if (profileEntry.name === "profile.json") {
          continue;
        }

        const srcPath = path.join(profileSrcDir, profileEntry.name);
        const destPath = path.join(profileDestDir, profileEntry.name);

        if (profileEntry.isDirectory()) {
          await fs.cp(srcPath, destPath, { recursive: true });
        } else {
          await fs.copyFile(srcPath, destPath);
        }
      }

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
    info({ message: `Profiles directory: ${noriProfilesDir}` });
  }
  if (skippedCount > 0) {
    warn({
      message: `Skipped ${skippedCount} profile${
        skippedCount === 1 ? "" : "s"
      } (not found or invalid)`,
    });
  }

  // Configure permissions for profiles directory
  await configureProfilesPermissions({ config });
};

/**
 * Configure permissions for profiles directory
 * Adds profiles directory to permissions.additionalDirectories in settings.json
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const configureProfilesPermissions = async (args: {
  config: Config;
}): Promise<void> => {
  const { config } = args;

  const claudeSettingsFile = getClaudeSettingsFile({
    installDir: config.installDir,
  });
  const noriProfilesDir = getNoriProfilesDir({
    installDir: config.installDir,
  });

  info({ message: "Configuring permissions for profiles directory..." });

  // Create .claude directory if it doesn't exist
  await fs.mkdir(path.dirname(claudeSettingsFile), { recursive: true });

  // Read or initialize settings
  let settings: any = {};
  try {
    const content = await fs.readFile(claudeSettingsFile, "utf-8");
    settings = JSON.parse(content);
  } catch {
    settings = {
      $schema: "https://json.schemastore.org/claude-code-settings.json",
    };
  }

  // Initialize permissions object if needed
  if (!settings.permissions) {
    settings.permissions = {};
  }

  // Initialize additionalDirectories array if needed
  if (!settings.permissions.additionalDirectories) {
    settings.permissions.additionalDirectories = [];
  }

  // Add profiles directory if not already present
  const profilesPath = noriProfilesDir;
  if (!settings.permissions.additionalDirectories.includes(profilesPath)) {
    settings.permissions.additionalDirectories.push(profilesPath);
  }

  // Write back to file
  await fs.writeFile(claudeSettingsFile, JSON.stringify(settings, null, 2));
  success({ message: `✓ Configured permissions for ${noriProfilesDir}` });
};

/**
 * Uninstall profiles directory
 * Profiles are never deleted - users manage them via the registry
 * Only removes permissions configuration from settings.json
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const uninstallProfiles = async (args: { config: Config }): Promise<void> => {
  const { config } = args;

  // Profiles are never deleted during uninstall
  // Users manage their profiles via the registry and we preserve all customizations
  info({ message: "Preserving Nori profiles (profiles are never deleted)" });

  // Remove permissions configuration
  await removeProfilesPermissions({ config });
};

/**
 * Remove profiles directory permissions
 * Removes profiles directory from permissions.additionalDirectories in settings.json
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const removeProfilesPermissions = async (args: {
  config: Config;
}): Promise<void> => {
  const { config } = args;

  const claudeSettingsFile = getClaudeSettingsFile({
    installDir: config.installDir,
  });
  const noriProfilesDir = getNoriProfilesDir({
    installDir: config.installDir,
  });

  info({ message: "Removing profiles directory permissions..." });

  try {
    const content = await fs.readFile(claudeSettingsFile, "utf-8");
    const settings = JSON.parse(content);

    if (settings.permissions?.additionalDirectories) {
      const profilesPath = noriProfilesDir;
      settings.permissions.additionalDirectories =
        settings.permissions.additionalDirectories.filter(
          (dir: string) => dir !== profilesPath,
        );

      // Clean up empty arrays/objects
      if (settings.permissions.additionalDirectories.length === 0) {
        delete settings.permissions.additionalDirectories;
      }
      if (Object.keys(settings.permissions).length === 0) {
        delete settings.permissions;
      }

      await fs.writeFile(claudeSettingsFile, JSON.stringify(settings, null, 2));
      success({ message: "✓ Removed profiles directory permissions" });
    } else {
      info({ message: "No permissions found in settings.json" });
    }
  } catch (err) {
    warn({ message: `Could not remove permissions: ${err}` });
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

  const noriProfilesDir = getNoriProfilesDir({
    installDir: config.installDir,
  });
  const claudeSettingsFile = getClaudeSettingsFile({
    installDir: config.installDir,
  });

  const errors: Array<string> = [];

  // Check if profiles directory exists
  try {
    await fs.access(noriProfilesDir);
  } catch {
    errors.push(`Profiles directory not found at ${noriProfilesDir}`);
    errors.push('Run "nori-ai install" to create the profiles directory');
    return {
      valid: false,
      message: "Profiles directory not found",
      errors,
    };
  }

  // Check if required profile directories are present
  const requiredProfiles = [
    "senior-swe",
    "amol",
    "product-manager",
    "documenter",
    "none",
  ];
  const missingProfiles: Array<string> = [];

  for (const profile of requiredProfiles) {
    const profileDir = path.join(noriProfilesDir, profile);
    const claudeMdPath = path.join(profileDir, "CLAUDE.md");
    const noriJsonPath = path.join(profileDir, "nori.json");

    try {
      await fs.access(claudeMdPath);
      await fs.access(noriJsonPath);
    } catch {
      missingProfiles.push(profile);
    }
  }

  if (missingProfiles.length > 0) {
    errors.push(
      `Missing ${
        missingProfiles.length
      } required profile(s): ${missingProfiles.join(", ")}`,
    );
    errors.push('Run "nori-ai install" to install missing profiles');
  }

  if (errors.length > 0) {
    return {
      valid: false,
      message: "Some required profiles are not installed",
      errors,
    };
  }

  // Check if permissions are configured in settings.json
  try {
    const content = await fs.readFile(claudeSettingsFile, "utf-8");
    const settings = JSON.parse(content);

    if (
      !settings.permissions?.additionalDirectories?.includes(noriProfilesDir)
    ) {
      errors.push(
        "Profiles directory not configured in permissions.additionalDirectories",
      );
      errors.push('Run "nori-ai install" to configure permissions');
      return {
        valid: false,
        message: "Profiles permissions not configured",
        errors,
      };
    }
  } catch {
    errors.push("Could not read or parse settings.json");
    return {
      valid: false,
      message: "Settings file error",
      errors,
    };
  }

  return {
    valid: true,
    message: `All required profiles are properly installed`,
    errors: null,
  };
};

/**
 * Profiles feature loader
 */
export const profilesLoader: Loader = {
  name: "profiles",
  description: "Profile templates in ~/.nori/profiles/",
  run: async (args: { config: Config }) => {
    const { config } = args;
    await installProfiles({ config });

    // Install all profile-dependent features
    const registry = ProfileLoaderRegistry.getInstance();
    const loaders = registry.getAll();
    for (const loader of loaders) {
      await loader.install({ config });
    }
  },
  uninstall: async (args: { config: Config }) => {
    const { config } = args;

    // Uninstall profile-dependent features in reverse order
    const registry = ProfileLoaderRegistry.getInstance();
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
 * Note: injectConditionalMixins and getMixinPaths removed - profiles are now self-contained
 */
export const _testing = {
  injectConditionalMixins: undefined,
  getMixinPaths: undefined,
};
