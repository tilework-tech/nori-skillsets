/**
 * Profiles feature loader for cursor-agent
 * Installs profile templates to ~/.cursor/profiles/
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { getCursorProfilesDir } from "@/cli/features/cursor-agent/paths.js";
import {
  readProfileMetadata,
  type ProfileMetadata,
} from "@/cli/features/cursor-agent/profiles/metadata.js";
import { CursorProfileLoaderRegistry } from "@/cli/features/cursor-agent/profiles/profileLoaderRegistry.js";
import { success, info, warn } from "@/cli/logger.js";

import type { Config } from "@/cli/config.js";
import type { Loader, ValidationResult } from "@/cli/features/agentRegistry.js";

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Profile templates config directory (relative to this loader)
const PROFILE_TEMPLATES_DIR = path.join(__dirname, "config");

// Mixins directory (contains reusable profile components)
const MIXINS_DIR = path.join(PROFILE_TEMPLATES_DIR, "_mixins");

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
 * Install profile templates to ~/.cursor/profiles/
 * Handles profile composition by resolving mixins
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const installProfiles = async (args: { config: Config }): Promise<void> => {
  const { config } = args;

  const cursorProfilesDir = getCursorProfilesDir({
    installDir: config.installDir,
  });

  info({ message: "Installing Cursor profiles..." });

  // Create profiles directory if it doesn't exist
  await fs.mkdir(cursorProfilesDir, { recursive: true });

  let installedCount = 0;
  let skippedCount = 0;

  // Read all directories from templates directory (these are built-in profiles)
  const entries = await fs.readdir(PROFILE_TEMPLATES_DIR, {
    withFileTypes: true,
  });

  // Install user-facing profiles with composition
  // Internal profiles (like _mixins) are NEVER installed
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) {
      continue; // Skip non-directories and internal profiles
    }

    const profileSrcDir = path.join(PROFILE_TEMPLATES_DIR, entry.name);
    const profileDestDir = path.join(cursorProfilesDir, entry.name);

    try {
      // User-facing profile - must have AGENTS.md
      const agentsMdPath = path.join(profileSrcDir, "AGENTS.md");
      await fs.access(agentsMdPath);

      // Remove existing profile directory if it exists
      await fs.rm(profileDestDir, { recursive: true, force: true });

      // Read profile metadata
      const profileJsonPath = path.join(profileSrcDir, "profile.json");
      let metadata: ProfileMetadata | null = null;

      try {
        await fs.access(profileJsonPath);
        metadata = await readProfileMetadata({
          profileDir: profileSrcDir,
        });
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
            // Mixin not found - skip silently (not all mixins need to exist)
          }
        }
      }

      // Copy/overlay profile-specific content (AGENTS.md, profile.json, etc.)
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
 * Only removes built-in profiles (those with "builtin": true in profile.json)
 * Custom user profiles are preserved
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const uninstallProfiles = async (args: { config: Config }): Promise<void> => {
  const { config } = args;

  const cursorProfilesDir = getCursorProfilesDir({
    installDir: config.installDir,
  });

  info({ message: "Removing built-in Cursor profiles..." });

  try {
    await fs.access(cursorProfilesDir);

    const entries = await fs.readdir(cursorProfilesDir, {
      withFileTypes: true,
    });

    let removedCount = 0;
    let preservedCount = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const profileDir = path.join(cursorProfilesDir, entry.name);
      const profileJsonPath = path.join(profileDir, "profile.json");

      try {
        const content = await fs.readFile(profileJsonPath, "utf-8");
        const profileData = JSON.parse(content);

        if (profileData.builtin === true) {
          await fs.rm(profileDir, { recursive: true, force: true });
          removedCount++;
        } else {
          preservedCount++;
        }
      } catch {
        // If profile.json doesn't exist or can't be read, treat as custom
        preservedCount++;
      }
    }

    if (removedCount > 0) {
      success({
        message: `✓ Removed ${removedCount} built-in profile${removedCount === 1 ? "" : "s"}`,
      });
    }
    if (preservedCount > 0) {
      info({
        message: `  Preserved ${preservedCount} custom profile${preservedCount === 1 ? "" : "s"}`,
      });
    }
  } catch {
    info({ message: "Profiles directory not found (may not be installed)" });
  }

  // Remove parent directory if empty
  try {
    const files = await fs.readdir(cursorProfilesDir);
    if (files.length === 0) {
      await fs.rmdir(cursorProfilesDir);
      success({ message: `✓ Removed empty directory: ${cursorProfilesDir}` });
    }
  } catch {
    // Directory doesn't exist or couldn't be removed, which is fine
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
  description: "Install Cursor profile templates to ~/.cursor/profiles/",
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
 */
export const _testing = {
  getMixinPaths,
};
