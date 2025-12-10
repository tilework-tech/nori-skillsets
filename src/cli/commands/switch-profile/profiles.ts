/**
 * Profile management for Nori Profiles
 * Handles profile listing, loading, and switching
 */

import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { error, info } from "@/cli/logger.js";
import { normalizeInstallDir } from "@/utils/path.js";

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
      const installDir = normalizeInstallDir({
        installDir: globalOpts.installDir || null,
      });
      const agentName = globalOpts.agent || "claude-code";
      const agent = AgentRegistry.getInstance().get({ name: agentName });

      try {
        // Delegate to agent's switchProfile method
        await agent.switchProfile({ installDir, profileName: name });
      } catch (err) {
        // On failure, show available profiles
        const profiles = await agent.listProfiles({ installDir });
        if (profiles.length > 0) {
          error({ message: `Available profiles: ${profiles.join(", ")}` });
        }
        throw err;
      }

      // Run install in non-interactive mode with skipUninstall
      // This preserves custom user profiles during the profile switch
      info({ message: "Applying profile configuration..." });
      const { main: installMain } =
        await import("@/cli/commands/install/install.js");
      await installMain({
        nonInteractive: true,
        skipUninstall: true,
        installDir: globalOpts.installDir || null,
        agent: globalOpts.agent || null,
      });
    });
};
