/**
 * Profiles feature loader
 * Installs profile templates to ~/.nori/profiles/
 */

import * as fs from "fs/promises";
import * as path from "path";

import { type Config } from "@/cli/config.js";
import {
  getNoriProfilesDir,
  getClaudeSettingsFile,
} from "@/cli/features/claude-code/paths.js";
import { ProfileLoaderRegistry } from "@/cli/features/claude-code/profiles/profileLoaderRegistry.js";
import { success, info, warn } from "@/cli/logger.js";

import type { Loader, ValidationResult } from "@/cli/features/agentRegistry.js";

/**
 * Install profiles directory and configure permissions
 *
 * Creates the profiles directory at ~/.nori/profiles/ if it doesn't exist
 * and configures permissions. Profiles are installed from the registry,
 * not bundled with the package.
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
    errors.push('Run "nori-skillsets init" to create the profiles directory');
    return {
      valid: false,
      message: "Profiles directory not found",
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
      errors.push('Run "nori-skillsets init" to configure permissions');
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
    message: `Profiles directory exists and permissions are configured`,
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
