/**
 * Profiles feature loader
 * Installs profile templates to ~/.claude/profiles/
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { isPaidInstall, type Config } from "@/cli/config.js";
import {
  getClaudeProfilesDir,
  getClaudeSettingsFile,
} from "@/cli/features/claude-code/paths.js";
import {
  readProfileMetadata,
  type ProfileMetadata,
} from "@/cli/features/claude-code/profiles/metadata.js";
import { ProfileLoaderRegistry } from "@/cli/features/claude-code/profiles/profileLoaderRegistry.js";
import { success, info, warn } from "@/cli/logger.js";

import type { Loader, ValidationResult } from "@/cli/features/agentRegistry.js";

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Profile templates config directory (relative to this loader)
const PROFILE_TEMPLATES_DIR = path.join(__dirname, "config");

// Mixins directory (contains reusable profile components)
const MIXINS_DIR = path.join(PROFILE_TEMPLATES_DIR, "_mixins");

/**
 * Check if user is a paid tier user
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 *
 * @returns True if user has auth credentials (paid install)
 */
const isPaidUser = (args: { config: Config }): boolean => {
  return isPaidInstall(args);
};

/**
 * Inject conditional mixins dynamically based on config and profile metadata
 *
 * This handles multi-criteria mixin injection:
 * 1. Cross-category paid mixin (_paid) - added for all paid users
 * 2. Category-specific tier mixins (_docs-paid, _swe-paid) - added when:
 *    - User is paid AND
 *    - Profile contains that category mixin
 *
 * @param args - Function arguments
 * @param args.metadata - Profile metadata
 * @param args.config - Runtime configuration
 *
 * @returns Metadata with conditional mixins added if applicable
 */
const injectConditionalMixins = (args: {
  metadata: ProfileMetadata;
  config: Config;
}): ProfileMetadata => {
  const { metadata, config } = args;

  // Check if user is paid
  const isPaid = isPaidUser({ config });

  if (!isPaid) {
    return metadata;
  }

  const newMixins = { ...metadata.mixins };

  // Inject cross-category paid mixin if not already present
  if (!("paid" in newMixins)) {
    newMixins.paid = {};
  }

  // Inject category-specific paid mixins based on categories in profile
  // Only inject if both:
  // 1. The base category mixin is present (e.g., 'docs')
  // 2. The corresponding tier-specific mixin is not already present (e.g., 'docs-paid')

  const categories = Object.keys(metadata.mixins).filter(
    (name) => !name.endsWith("-paid") && name !== "base" && name !== "paid",
  );

  for (const category of categories) {
    const tierMixinName = `${category}-paid`;
    if (!(tierMixinName in newMixins)) {
      newMixins[tierMixinName] = {};
    }
  }

  return {
    ...metadata,
    mixins: newMixins,
  };
};

/**
 * Get mixin paths in precedence order (alphabetical)
 * @param args - Function arguments
 * @param args.metadata - Profile metadata with mixins
 *
 * @returns Array of mixin directory paths in alphabetical order
 */
const getMixinPaths = (args: { metadata: ProfileMetadata }): Array<string> => {
  const { metadata } = args;

  // Sort mixin names alphabetically for deterministic precedence
  const mixinNames = Object.keys(metadata.mixins).sort();

  // Map to full paths, prepending _ prefix
  return mixinNames.map((name) => path.join(MIXINS_DIR, `_${name}`));
};

/**
 * Install profile templates to ~/.claude/profiles/
 * Handles profile composition by resolving inheritance from base profiles
 *
 * This function copies built-in profiles from the nori-ai package to ~/.claude/profiles/.
 * Built-in profiles are ALWAYS overwritten to ensure they stay up-to-date.
 * Custom profiles (those that don't exist in the nori-ai package) are never touched.
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const installProfiles = async (args: { config: Config }): Promise<void> => {
  const { config } = args;

  const claudeProfilesDir = getClaudeProfilesDir({
    installDir: config.installDir,
  });

  info({ message: "Installing Nori profiles..." });

  // Create profiles directory if it doesn't exist
  await fs.mkdir(claudeProfilesDir, { recursive: true });

  let installedCount = 0;
  let skippedCount = 0;

  // Read all directories from templates directory (these are built-in profiles)
  const entries = await fs.readdir(PROFILE_TEMPLATES_DIR, {
    withFileTypes: true,
  });

  // Install user-facing profiles with composition
  // Internal profiles (like _base) are NEVER installed - they only exist for composition
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) {
      continue; // Skip non-directories and internal profiles
    }

    const profileSrcDir = path.join(PROFILE_TEMPLATES_DIR, entry.name);
    const profileDestDir = path.join(claudeProfilesDir, entry.name);

    try {
      // User-facing profile - must have CLAUDE.md
      const claudeMdPath = path.join(profileSrcDir, "CLAUDE.md");
      await fs.access(claudeMdPath);

      // Remove existing profile directory if it exists (ensures built-ins stay updated)
      await fs.rm(profileDestDir, { recursive: true, force: true });

      // Read profile metadata and inject paid mixin if applicable
      const profileJsonPath = path.join(profileSrcDir, "profile.json");
      let metadata: ProfileMetadata | null = null;

      try {
        await fs.access(profileJsonPath);
        metadata = await readProfileMetadata({
          profileDir: profileSrcDir,
        });

        // Inject conditional mixins if user is paid
        metadata = injectConditionalMixins({ metadata, config });
      } catch {
        // No profile.json - skip composition
      }

      // Create destination directory
      await fs.mkdir(profileDestDir, { recursive: true });

      // Compose mixins in alphabetical precedence order
      if (metadata?.mixins != null) {
        const mixinPaths = getMixinPaths({ metadata });
        const mixinNames = Object.keys(metadata.mixins).sort();

        info({
          message: `  Composing from mixins: ${mixinNames.join(", ")}`,
        });

        // Copy content from each mixin in order
        for (const mixinPath of mixinPaths) {
          try {
            await fs.access(mixinPath);

            const mixinEntries = await fs.readdir(mixinPath, {
              withFileTypes: true,
            });

            for (const mixinEntry of mixinEntries) {
              const srcPath = path.join(mixinPath, mixinEntry.name);
              const destPath = path.join(profileDestDir, mixinEntry.name);

              if (mixinEntry.isDirectory()) {
                // Directories: merge contents (union)
                await fs.cp(srcPath, destPath, { recursive: true });
              } else {
                // Files: last writer wins
                await fs.copyFile(srcPath, destPath);
              }
            }
          } catch {
            warn({
              message: `  Mixin ${path.basename(
                mixinPath,
              )} not found, skipping`,
            });
          }
        }
      }

      // Copy/overlay profile-specific content (CLAUDE.md, profile.json, etc.)
      const profileEntries = await fs.readdir(profileSrcDir, {
        withFileTypes: true,
      });

      for (const profileEntry of profileEntries) {
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
    info({ message: `Profiles directory: ${claudeProfilesDir}` });
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
  const claudeProfilesDir = getClaudeProfilesDir({
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
  const profilesPath = claudeProfilesDir;
  if (!settings.permissions.additionalDirectories.includes(profilesPath)) {
    settings.permissions.additionalDirectories.push(profilesPath);
  }

  // Write back to file
  await fs.writeFile(claudeSettingsFile, JSON.stringify(settings, null, 2));
  success({ message: `✓ Configured permissions for ${claudeProfilesDir}` });
};

/**
 * Uninstall profiles directory
 * Only removes built-in profiles (those with "builtin": true in profile.json)
 * Custom user profiles are preserved
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const uninstallProfiles = async (args: { config: Config }): Promise<void> => {
  const { config } = args;

  const claudeProfilesDir = getClaudeProfilesDir({
    installDir: config.installDir,
  });

  info({ message: "Removing built-in Nori profiles..." });

  try {
    await fs.access(claudeProfilesDir);

    // Read all profile directories
    const entries = await fs.readdir(claudeProfilesDir, {
      withFileTypes: true,
    });

    let removedCount = 0;
    let preservedCount = 0;

    // Remove only built-in profiles
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const profileDir = path.join(claudeProfilesDir, entry.name);
      const profileJsonPath = path.join(profileDir, "profile.json");

      try {
        // Read profile.json to check if it's a built-in profile
        const content = await fs.readFile(profileJsonPath, "utf-8");
        const profileData = JSON.parse(content);

        if (profileData.builtin === true) {
          // Built-in profile - remove it
          await fs.rm(profileDir, { recursive: true, force: true });
          removedCount++;
        } else {
          // Custom profile - preserve it
          preservedCount++;
        }
      } catch {
        // If profile.json doesn't exist or can't be read, treat as custom (preserve it)
        preservedCount++;
      }
    }

    if (removedCount > 0) {
      success({
        message: `✓ Removed ${removedCount} built-in profile${
          removedCount === 1 ? "" : "s"
        }`,
      });
    }
    if (preservedCount > 0) {
      info({
        message: `  Preserved ${preservedCount} custom profile${
          preservedCount === 1 ? "" : "s"
        }`,
      });
    }
  } catch {
    info({ message: "Profiles directory not found (may not be installed)" });
  }

  // Remove parent directory if empty
  try {
    const files = await fs.readdir(claudeProfilesDir);
    if (files.length === 0) {
      await fs.rmdir(claudeProfilesDir);
      success({ message: `✓ Removed empty directory: ${claudeProfilesDir}` });
    }
  } catch {
    // Directory doesn't exist or couldn't be removed, which is fine
  }

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
  const claudeProfilesDir = getClaudeProfilesDir({
    installDir: config.installDir,
  });

  info({ message: "Removing profiles directory permissions..." });

  try {
    const content = await fs.readFile(claudeSettingsFile, "utf-8");
    const settings = JSON.parse(content);

    if (settings.permissions?.additionalDirectories) {
      const profilesPath = claudeProfilesDir;
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

  const claudeProfilesDir = getClaudeProfilesDir({
    installDir: config.installDir,
  });
  const claudeSettingsFile = getClaudeSettingsFile({
    installDir: config.installDir,
  });

  const errors: Array<string> = [];

  // Check if profiles directory exists
  try {
    await fs.access(claudeProfilesDir);
  } catch {
    errors.push(`Profiles directory not found at ${claudeProfilesDir}`);
    errors.push('Run "nori-ai install" to create the profiles directory');
    return {
      valid: false,
      message: "Profiles directory not found",
      errors,
    };
  }

  // Check if required profile directories are present
  // Note: _base is NOT checked here because it's never installed to ~/.claude/profiles/
  // It only exists in source templates for composition
  const requiredProfiles = [
    "senior-swe",
    "amol",
    "product-manager",
    "documenter",
    "none",
  ];
  const missingProfiles: Array<string> = [];

  for (const profile of requiredProfiles) {
    const profileDir = path.join(claudeProfilesDir, profile);
    const claudeMdPath = path.join(profileDir, "CLAUDE.md");
    const profileJsonPath = path.join(profileDir, "profile.json");

    try {
      await fs.access(claudeMdPath);
      await fs.access(profileJsonPath);
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
      message: "Some required profiles or base components are not installed",
      errors,
    };
  }

  // Check if permissions are configured in settings.json
  try {
    const content = await fs.readFile(claudeSettingsFile, "utf-8");
    const settings = JSON.parse(content);

    if (
      !settings.permissions?.additionalDirectories?.includes(claudeProfilesDir)
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
  description: "Install Nori profile templates to ~/.claude/profiles/",
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
 */
export const _testing = {
  isPaidUser,
  injectConditionalMixins,
  getMixinPaths,
};
