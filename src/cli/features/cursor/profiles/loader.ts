/**
 * Cursor profiles feature loader
 * Installs profile templates to ~/.cursor/profiles/
 * Mirrors the Claude profiles loader but writes to Cursor directories
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { isPaidInstall, type Config } from "@/cli/config.js";
import { getCursorProfilesDir, getCursorSettingsFile } from "@/cli/env.js";
import {
  readProfileMetadata,
  type ProfileMetadata,
} from "@/cli/features/profiles/metadata.js";
import { success, info, warn } from "@/cli/logger.js";

import type {
  Loader,
  ValidationResult,
} from "@/cli/features/loaderRegistry.js";

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Profile templates config directory (reuse Claude's profile templates)
const PROFILE_TEMPLATES_DIR = path.join(__dirname, "../../profiles/config");

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

  const isPaid = isPaidUser({ config });

  if (!isPaid) {
    return metadata;
  }

  const newMixins = { ...metadata.mixins };

  if (!("paid" in newMixins)) {
    newMixins.paid = {};
  }

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

  const mixinNames = Object.keys(metadata.mixins).sort();

  return mixinNames.map((name) => path.join(MIXINS_DIR, `_${name}`));
};

/**
 * Install profile templates to ~/.cursor/profiles/
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const installProfiles = async (args: { config: Config }): Promise<void> => {
  const { config } = args;

  const cursorProfilesDir = getCursorProfilesDir({
    installDir: config.installDir,
  });

  info({ message: "Installing Nori profiles for Cursor..." });

  await fs.mkdir(cursorProfilesDir, { recursive: true });

  let installedCount = 0;
  let skippedCount = 0;

  const entries = await fs.readdir(PROFILE_TEMPLATES_DIR, {
    withFileTypes: true,
  });

  // Check if a specific cursor profile is selected
  const selectedProfile = config.cursorProfile?.baseProfile;

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) {
      continue;
    }

    // If a specific profile is selected, only install that one
    if (selectedProfile != null && entry.name !== selectedProfile) {
      continue;
    }

    const profileSrcDir = path.join(PROFILE_TEMPLATES_DIR, entry.name);
    const profileDestDir = path.join(cursorProfilesDir, entry.name);

    try {
      const claudeMdPath = path.join(profileSrcDir, "CLAUDE.md");
      await fs.access(claudeMdPath);

      await fs.rm(profileDestDir, { recursive: true, force: true });

      const profileJsonPath = path.join(profileSrcDir, "profile.json");
      let metadata: ProfileMetadata | null = null;

      try {
        await fs.access(profileJsonPath);
        metadata = await readProfileMetadata({
          profileDir: profileSrcDir,
        });

        metadata = injectConditionalMixins({ metadata, config });
      } catch {
        // No profile.json - skip composition
      }

      await fs.mkdir(profileDestDir, { recursive: true });

      if (metadata?.mixins != null) {
        const mixinPaths = getMixinPaths({ metadata });
        const mixinNames = Object.keys(metadata.mixins).sort();

        info({
          message: `  Composing from mixins: ${mixinNames.join(", ")}`,
        });

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
                await fs.cp(srcPath, destPath, { recursive: true });
              } else {
                await fs.copyFile(srcPath, destPath);
              }
            }
          } catch {
            warn({
              message: `  Mixin ${path.basename(mixinPath)} not found, skipping`,
            });
          }
        }
      }

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

  await configureProfilesPermissions({ config });
};

/**
 * Configure permissions for profiles directory
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const configureProfilesPermissions = async (args: {
  config: Config;
}): Promise<void> => {
  const { config } = args;

  const cursorSettingsFile = getCursorSettingsFile({
    installDir: config.installDir,
  });
  const cursorProfilesDir = getCursorProfilesDir({
    installDir: config.installDir,
  });

  info({ message: "Configuring permissions for Cursor profiles directory..." });

  await fs.mkdir(path.dirname(cursorSettingsFile), { recursive: true });

  let settings: Record<string, unknown> = {};
  try {
    const content = await fs.readFile(cursorSettingsFile, "utf-8");
    settings = JSON.parse(content);
  } catch {
    settings = {
      $schema: "https://json.schemastore.org/claude-code-settings.json",
    };
  }

  if (!settings.permissions) {
    settings.permissions = {};
  }

  const permissions = settings.permissions as Record<string, unknown>;
  if (!permissions.additionalDirectories) {
    permissions.additionalDirectories = [];
  }

  const additionalDirectories =
    permissions.additionalDirectories as Array<string>;
  if (!additionalDirectories.includes(cursorProfilesDir)) {
    additionalDirectories.push(cursorProfilesDir);
  }

  await fs.writeFile(cursorSettingsFile, JSON.stringify(settings, null, 2));
  success({ message: `✓ Configured permissions for ${cursorProfilesDir}` });
};

/**
 * Uninstall profiles directory
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const uninstallProfiles = async (args: { config: Config }): Promise<void> => {
  const { config } = args;

  const cursorProfilesDir = getCursorProfilesDir({
    installDir: config.installDir,
  });

  info({ message: "Removing built-in Nori profiles from Cursor..." });

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

  try {
    const files = await fs.readdir(cursorProfilesDir);
    if (files.length === 0) {
      await fs.rmdir(cursorProfilesDir);
      success({ message: `✓ Removed empty directory: ${cursorProfilesDir}` });
    }
  } catch {
    // Directory doesn't exist or couldn't be removed
  }

  await removeProfilesPermissions({ config });
};

/**
 * Remove profiles directory permissions
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const removeProfilesPermissions = async (args: {
  config: Config;
}): Promise<void> => {
  const { config } = args;

  const cursorSettingsFile = getCursorSettingsFile({
    installDir: config.installDir,
  });
  const cursorProfilesDir = getCursorProfilesDir({
    installDir: config.installDir,
  });

  info({ message: "Removing Cursor profiles directory permissions..." });

  try {
    const content = await fs.readFile(cursorSettingsFile, "utf-8");
    const settings = JSON.parse(content);

    if (settings.permissions?.additionalDirectories) {
      settings.permissions.additionalDirectories =
        settings.permissions.additionalDirectories.filter(
          (dir: string) => dir !== cursorProfilesDir,
        );

      if (settings.permissions.additionalDirectories.length === 0) {
        delete settings.permissions.additionalDirectories;
      }
      if (Object.keys(settings.permissions).length === 0) {
        delete settings.permissions;
      }

      await fs.writeFile(cursorSettingsFile, JSON.stringify(settings, null, 2));
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

  const cursorProfilesDir = getCursorProfilesDir({
    installDir: config.installDir,
  });
  const cursorSettingsFile = getCursorSettingsFile({
    installDir: config.installDir,
  });

  const errors: Array<string> = [];

  try {
    await fs.access(cursorProfilesDir);
  } catch {
    errors.push(`Cursor profiles directory not found at ${cursorProfilesDir}`);
    errors.push(
      'Run "nori-ai install-cursor" to create the profiles directory',
    );
    return {
      valid: false,
      message: "Cursor profiles directory not found",
      errors,
    };
  }

  // When a specific profile is selected, only validate that one
  const selectedProfile = config.cursorProfile?.baseProfile;
  const requiredProfiles =
    selectedProfile != null
      ? [selectedProfile]
      : ["senior-swe", "amol", "product-manager", "documenter", "none"];
  const missingProfiles: Array<string> = [];

  for (const profile of requiredProfiles) {
    const profileDir = path.join(cursorProfilesDir, profile);
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
      `Missing ${missingProfiles.length} required profile(s): ${missingProfiles.join(", ")}`,
    );
    errors.push('Run "nori-ai install-cursor" to install missing profiles');
  }

  if (errors.length > 0) {
    return {
      valid: false,
      message: "Some required Cursor profiles are not installed",
      errors,
    };
  }

  try {
    const content = await fs.readFile(cursorSettingsFile, "utf-8");
    const settings = JSON.parse(content);

    if (
      !settings.permissions?.additionalDirectories?.includes(cursorProfilesDir)
    ) {
      errors.push(
        "Cursor profiles directory not configured in permissions.additionalDirectories",
      );
      errors.push('Run "nori-ai install-cursor" to configure permissions');
      return {
        valid: false,
        message: "Cursor profiles permissions not configured",
        errors,
      };
    }
  } catch {
    errors.push("Could not read or parse Cursor settings.json");
    return {
      valid: false,
      message: "Cursor settings file error",
      errors,
    };
  }

  return {
    valid: true,
    message: "All required Cursor profiles are properly installed",
    errors: null,
  };
};

/**
 * Cursor profiles feature loader
 */
export const cursorProfilesLoader: Loader = {
  name: "cursor-profiles",
  description: "Install Nori profile templates to ~/.cursor/profiles/",
  run: async (args: { config: Config }) => {
    const { config } = args;
    await installProfiles({ config });
  },
  uninstall: async (args: { config: Config }) => {
    const { config } = args;
    await uninstallProfiles({ config });
  },
  validate,
};
