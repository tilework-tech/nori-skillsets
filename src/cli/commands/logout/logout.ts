/**
 * Logout Command
 *
 * Clears stored authentication credentials.
 */

import * as os from "os";
import * as path from "path";

import { log } from "@clack/prompts";

import { findConfigPath, loadConfig, saveConfig } from "@/cli/config.js";

import type { Command } from "commander";

/**
 * Clear auth from a single config directory
 *
 * @param args - Configuration arguments
 * @param args.installDir - Directory containing the config
 * @param args.startDir - Directory to start config search from
 */
const clearAuthFromConfig = async (args: {
  installDir: string;
  startDir?: string | null;
}): Promise<void> => {
  const { installDir, startDir } = args;
  const existingConfig = await loadConfig({ startDir });

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
 * @param args.installDir - Installation directory (stored as data in config)
 * @param args.startDir - Directory to start config search from (defaults to cwd)
 */
export const logoutMain = async (args?: {
  installDir?: string | null;
  startDir?: string | null;
}): Promise<void> => {
  const { installDir, startDir } = args ?? {};

  const existingConfig = await loadConfig({ startDir });

  if (existingConfig?.auth == null) {
    log.info("Not currently logged in.");
    return;
  }

  // Get the actual config path that was found to determine installDir
  const configPath = await findConfigPath({ startDir });
  const configDir = path.dirname(configPath);

  await clearAuthFromConfig({
    installDir: installDir ?? configDir,
    startDir,
  });
  log.success("Logged out successfully.");
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
        startDir: os.homedir(),
      });
    });
};
