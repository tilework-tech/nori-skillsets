/**
 * Install Location Command
 *
 * Displays the Nori installation directory from config.
 */

import { note } from "@clack/prompts";

import { loadConfig } from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { resolveInstallDir } from "@/utils/path.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";
import type { Command } from "commander";

/**
 * Main function for install-location command
 * Displays the Nori installation directory from config
 *
 * @param args - Configuration arguments
 * @param args.nonInteractive - If true, output plain path without formatting
 *
 * @returns Command status
 */
export const installLocationMain = async (args?: {
  nonInteractive?: boolean | null;
}): Promise<CommandStatus> => {
  const { nonInteractive } = args ?? {};

  const config = await loadConfig();
  const installDir = resolveInstallDir({
    configInstallDir: config?.installDir,
    agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
  }).path;

  // Non-interactive output: plain path
  if (nonInteractive) {
    process.stdout.write(installDir + "\n");
    return {
      success: true,
      cancelled: false,
      message: `Install directory: ${installDir}`,
    };
  }

  note(installDir, "Nori installation directory");
  return {
    success: true,
    cancelled: false,
    message: `Install directory: ${installDir}`,
  };
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
