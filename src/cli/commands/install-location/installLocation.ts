/**
 * Install Location Command
 *
 * Displays Nori installation directories found in the current directory and parent directories.
 */

import { log, note, outro } from "@clack/prompts";

import { getInstallDirs } from "@/utils/path.js";

import type { Command } from "commander";

/**
 * Main function for install-location command
 * Displays Nori installation directories
 *
 * @param args - Configuration arguments
 * @param args.currentDir - Directory to start searching from (defaults to process.cwd())
 * @param args.nonInteractive - If true, output plain paths without formatting
 */
export const installLocationMain = async (args?: {
  currentDir?: string | null;
  nonInteractive?: boolean | null;
}): Promise<void> => {
  const { currentDir, nonInteractive } = args ?? {};

  const searchDir = currentDir ?? process.cwd();
  const installDirs = getInstallDirs({ currentDir: searchDir });

  if (installDirs.length === 0) {
    log.error(
      "No Nori installations found in current directory or parent directories",
    );
    process.exit(1);
  }

  // Non-interactive output: plain paths, one per line
  if (nonInteractive) {
    for (const dir of installDirs) {
      process.stdout.write(dir + "\n");
    }
    return;
  }

  const pathsList = installDirs.join("\n");
  note(pathsList, "Nori installation directories");
  outro("Done");
};

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
        log.error(
          "No Nori installations found in current directory or parent directories",
        );
        process.exit(1);
      }

      const pathsList = installDirs.join("\n");
      note(pathsList, "Nori installation directories");
      outro("Done");
    });
};
