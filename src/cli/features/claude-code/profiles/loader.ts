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
import { success, info } from "@/cli/logger.js";

import type { Loader } from "@/cli/features/agentRegistry.js";

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

  const noriProfilesDir = getNoriProfilesDir();

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
  const noriProfilesDir = getNoriProfilesDir();

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
};

/**
 * Export internal functions for testing
 * Note: injectConditionalMixins and getMixinPaths removed - profiles are now self-contained
 */
export const _testing = {
  injectConditionalMixins: undefined,
  getMixinPaths: undefined,
};
