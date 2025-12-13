/**
 * Install Location Command
 *
 * Displays Nori installation directories found in the current directory and parent directories.
 */

import { error, success, info, newline } from "@/cli/logger.js";
import { getInstallDirs } from "@/utils/path.js";

import type { Command } from "commander";

/**
 * Register the 'install-location' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerInstallLocationCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("install-location")
    .description("Display Nori installation directories")
    .action(async () => {
      const currentDir = process.cwd();
      const installDirs = getInstallDirs({ currentDir });

      if (installDirs.length === 0) {
        error({
          message:
            "No Nori installations found in current directory or parent directories",
        });
        process.exit(1);
      }

      newline();
      info({ message: "Nori installation directories:" });
      newline();

      for (const dir of installDirs) {
        success({ message: `  ${dir}` });
      }

      newline();
    });
};
