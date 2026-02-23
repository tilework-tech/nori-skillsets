/**
 * Logout Command
 *
 * Clears stored authentication credentials.
 */

import { log } from "@clack/prompts";

import { loadConfig, updateConfig } from "@/cli/config.js";

import type { Command } from "commander";

/**
 * Main logout function
 */
export const logoutMain = async (): Promise<void> => {
  const existingConfig = await loadConfig();

  if (existingConfig?.auth == null) {
    log.info("Not currently logged in.");
    return;
  }

  await updateConfig({ auth: null });
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
      await logoutMain();
    });
};
