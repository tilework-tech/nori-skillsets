/**
 * Logout Command
 *
 * Clears stored authentication credentials.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { loadConfig, saveConfig, getConfigPath } from "@/cli/config.js";
import { info, success } from "@/cli/logger.js";

import type { Command } from "commander";

/** Default config directory for login/logout commands */
const DEFAULT_CONFIG_DIR = os.homedir();

/**
 * Check if a file exists
 *
 * @param filePath - Path to check
 *
 * @returns true if file exists, false otherwise
 */
const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Find all config directories that have auth credentials, starting from searchDir
 *
 * @param args - Configuration arguments
 * @param args.searchDir - Directory to start searching from
 *
 * @returns Array of directories containing configs with auth
 */
const findConfigsWithAuth = async (args: {
  searchDir: string;
}): Promise<Array<string>> => {
  const { searchDir } = args;
  const configDirs: Array<string> = [];

  // Check for config at the search directory itself
  const rootConfigPath = getConfigPath({ installDir: searchDir });
  if (await fileExists(rootConfigPath)) {
    const config = await loadConfig({ installDir: searchDir });
    if (config?.auth != null) {
      configDirs.push(searchDir);
    }
  }

  // Check for config in .nori subdirectory (home directory installation pattern)
  const noriSubdir = path.join(searchDir, ".nori");
  const noriConfigPath = getConfigPath({ installDir: noriSubdir });
  if (await fileExists(noriConfigPath)) {
    const config = await loadConfig({ installDir: noriSubdir });
    if (config?.auth != null) {
      configDirs.push(noriSubdir);
    }
  }

  return configDirs;
};

/**
 * Clear auth from a single config directory
 *
 * @param args - Configuration arguments
 * @param args.installDir - Directory containing the config
 */
const clearAuthFromConfig = async (args: {
  installDir: string;
}): Promise<void> => {
  const { installDir } = args;
  const existingConfig = await loadConfig({ installDir });

  if (existingConfig == null) {
    return;
  }

  await saveConfig({
    username: null,
    organizationUrl: null,
    sendSessionTranscript: existingConfig.sendSessionTranscript ?? null,
    autoupdate: existingConfig.autoupdate ?? null,
    agents: existingConfig.agents ?? null,
    version: existingConfig.version ?? null,
    installDir,
  });
};

/**
 * Main logout function
 *
 * @param args - Configuration arguments
 * @param args.installDir - Specific installation directory (when provided, only clears auth from this dir)
 * @param args.searchDir - Directory to search for configs with auth (used when installDir not provided)
 */
export const logoutMain = async (args?: {
  installDir?: string | null;
  searchDir?: string | null;
}): Promise<void> => {
  const { installDir, searchDir } = args ?? {};

  // If specific installDir provided, use original behavior
  if (installDir != null) {
    const existingConfig = await loadConfig({ installDir });

    if (existingConfig?.auth == null) {
      info({ message: "Not currently logged in." });
      return;
    }

    await clearAuthFromConfig({ installDir });
    success({ message: "Logged out successfully." });
    return;
  }

  // Search for configs with auth
  const effectiveSearchDir = searchDir ?? DEFAULT_CONFIG_DIR;
  const configDirs = await findConfigsWithAuth({
    searchDir: effectiveSearchDir,
  });

  if (configDirs.length === 0) {
    info({ message: "Not currently logged in." });
    return;
  }

  // Clear auth from all found configs
  for (const configDir of configDirs) {
    await clearAuthFromConfig({ installDir: configDir });
  }

  if (configDirs.length === 1) {
    success({ message: "Logged out successfully." });
  } else {
    success({
      message: `Logged out from ${configDirs.length} installations.`,
    });
  }
};

/**
 * Register the 'logout' command with commander
 *
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerLogoutCommand = (args: { program: Command }): void => {
  const { program } = args;

  program
    .command("logout")
    .description("Clear stored authentication credentials")
    .action(async () => {
      const globalOpts = program.opts();

      await logoutMain({
        installDir: globalOpts.installDir || null,
      });
    });
};
