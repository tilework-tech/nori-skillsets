/**
 * Switch-profile command registration for commander.js
 */

import { main as installMain } from "@/installer/install.js";
import { info } from "@/installer/logger.js";
import { switchProfile } from "@/installer/profiles.js";

import type { Command } from "commander";

/**
 * Register the 'switch-profile' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerSwitchProfileCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("switch-profile <name>")
    .description("Switch to a different profile and reinstall")
    .action(async (name: string) => {
      // Get global options from parent
      const globalOpts = program.opts();

      // Switch to the profile
      await switchProfile({
        profileName: name,
        installDir: globalOpts.installDir || null,
      });

      // Run install in non-interactive mode with skipUninstall
      // This preserves custom user profiles during the profile switch
      info({ message: "Applying profile configuration..." });
      await installMain({
        nonInteractive: true,
        skipUninstall: true,
        installDir: globalOpts.installDir || null,
      });
    });
};
