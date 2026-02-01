/**
 * Logout Command
 *
 * Clears stored authentication credentials.
 */

import * as os from "os";
import * as path from "path";

import { loadConfig, saveConfig } from "@/cli/config.js";
import { info, success } from "@/cli/logger.js";

import type { Command } from "commander";

/** Default config directory for login/logout commands */
const DEFAULT_CONFIG_DIR = path.join(os.homedir(), ".nori");

/**
 * Main logout function
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 */
export const logoutMain = async (args?: {
  installDir?: string | null;
}): Promise<void> => {
  const { installDir } = args ?? {};
  // Default to ~/.nori for config storage
  const configDir = installDir ?? DEFAULT_CONFIG_DIR;

  // Load existing config
  const existingConfig = await loadConfig({ installDir: configDir });

  // Check if user is logged in
  if (existingConfig?.auth == null) {
    info({ message: "Not currently logged in." });
    return;
  }

  // Save config without auth credentials (preserve other fields)
  await saveConfig({
    username: null,
    organizationUrl: null,
    sendSessionTranscript: existingConfig.sendSessionTranscript ?? null,
    autoupdate: existingConfig.autoupdate ?? null,
    agents: existingConfig.agents ?? null,
    version: existingConfig.version ?? null,
    installDir: configDir,
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
