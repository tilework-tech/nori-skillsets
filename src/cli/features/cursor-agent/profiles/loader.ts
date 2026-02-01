/**
 * Profiles feature loader for cursor-agent
 * Installs profile templates to ~/.cursor/profiles/
 */

import * as fs from "fs/promises";

import { getCursorProfilesDir } from "@/cli/features/cursor-agent/paths.js";
import { CursorProfileLoaderRegistry } from "@/cli/features/cursor-agent/profiles/profileLoaderRegistry.js";
import { info } from "@/cli/logger.js";

import type { Config } from "@/cli/config.js";
import type { Loader, ValidationResult } from "@/cli/features/agentRegistry.js";

/**
 * Install profile templates to ~/.cursor/profiles/
 * Creates the profiles directory. Profiles are managed via the registry.
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
