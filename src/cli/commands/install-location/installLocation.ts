/**
 * Install Location Command
 *
 * Displays the Nori installation directory from config.
 */

import { note, outro } from "@clack/prompts";

import { loadConfig } from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { resolveInstallDir } from "@/utils/path.js";

import type { Command } from "commander";

/**
 * Main function for install-location command
 * Displays the Nori installation directory from config
 *
 * @param args - Configuration arguments
 * @param args.nonInteractive - If true, output plain path without formatting
 */
export const installLocationMain = async (args?: {
  nonInteractive?: boolean | null;
}): Promise<void> => {
  const { nonInteractive } = args ?? {};

  const config = await loadConfig();
  const installDir = resolveInstallDir({
    config,
    agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
  });

  // Non-interactive output: plain path
  if (nonInteractive) {
    process.stdout.write(installDir + "\n");
    return;
  }

  note(installDir, "Nori installation directory");
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
    .description("Display Nori installation directory")
    .action(async () => {
      await installLocationMain({});
    });
};
