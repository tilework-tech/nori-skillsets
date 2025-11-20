/**
 * Uninstall command registration for commander.js
 */

import { main as uninstallMain } from "@/installer/uninstall.js";

import type { Command } from "commander";

/**
 * Register the 'uninstall' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerUninstallCommand = (args: { program: Command }): void => {
  const { program } = args;

  program
    .command("uninstall")
    .description("Uninstall Nori Profiles")
    .action(async () => {
      // Get global options from parent
      const globalOpts = program.opts();

      await uninstallMain({
        nonInteractive: globalOpts.nonInteractive || null,
        installDir: globalOpts.installDir || null,
      });
    });
};
