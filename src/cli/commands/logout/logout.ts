/**
 * Logout Command
 *
 * Clears stored authentication credentials.
 */

import { loadConfig, saveConfig } from "@/cli/config.js";
import { info, success } from "@/cli/logger.js";

import type { Command } from "commander";

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
  const existingConfig = await loadConfig();

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
 */
export const logoutMain = async (args?: {
  installDir?: string | null;
}): Promise<void> => {
  const { installDir } = args ?? {};

  const existingConfig = await loadConfig();

  if (existingConfig?.auth == null) {
    info({ message: "Not currently logged in." });
    return;
  }

  await clearAuthFromConfig({
    installDir: installDir ?? existingConfig.installDir,
  });
  success({ message: "Logged out successfully." });
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
