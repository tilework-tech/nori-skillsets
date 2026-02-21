/**
 * Logout Command
 *
 * Clears stored authentication credentials.
 */

import { log } from "@clack/prompts";

import { loadConfig, saveConfig } from "@/cli/config.js";
import { getHomeDir } from "@/utils/home.js";

import type { Command } from "commander";

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
    log.info("Not currently logged in.");
    return;
  }

  await saveConfig({
    username: null,
    organizationUrl: null,
    sendSessionTranscript: existingConfig.sendSessionTranscript ?? null,
    autoupdate: existingConfig.autoupdate ?? null,
    activeSkillset: existingConfig.activeSkillset ?? null,
    version: existingConfig.version ?? null,
    installDir: installDir ?? getHomeDir(),
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
      });
    });
};
