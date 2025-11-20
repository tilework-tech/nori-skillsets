/**
 * Install command registration for commander.js
 */

import { main as installMain } from "@/installer/install.js";

import type { Command } from "commander";

/**
 * Register the 'install' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerInstallCommand = (args: { program: Command }): void => {
  const { program } = args;

  program
    .command("install")
    .description("Install Nori Profiles (default)")
    .action(async () => {
      // Get global options from parent
      const globalOpts = program.opts();

      await installMain({
        nonInteractive: globalOpts.nonInteractive || null,
        installDir: globalOpts.installDir || null,
      });
    });
};
