/**
 * Logout Command
 *
 * Clears stored authentication credentials.
 */

import { loadConfig, saveConfig } from "@/cli/config.js";
import { info, success } from "@/cli/logger.js";
import { normalizeInstallDir } from "@/utils/path.js";

import type { Command } from "commander";

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
  const normalizedInstallDir = normalizeInstallDir({ installDir });

  // Load existing config
  const existingConfig = await loadConfig({ installDir: normalizedInstallDir });

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
    registryAuths: existingConfig.registryAuths ?? null,
    agents: existingConfig.agents ?? null,
    version: existingConfig.version ?? null,
    installDir: normalizedInstallDir,
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
