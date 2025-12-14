/**
 * Shared validation for registry commands to check cursor-agent support
 *
 * Registry commands download profiles to ~/.claude/profiles/ which requires
 * Claude Code to be installed. If only cursor-agent is installed, these
 * commands should fail with a helpful message.
 */

import { loadConfig, getInstalledAgents } from "@/cli/config.js";
import { error, info, newline } from "@/cli/logger.js";

import type { Config } from "@/cli/config.js";

/**
 * Check if registry commands are supported for the current installation.
 * Returns false if only cursor-agent is installed (no claude-code).
 *
 * @param args - The check arguments
 * @param args.installDir - The installation directory to check
 *
 * @returns Object with supported boolean and optional config
 */
export const checkRegistryAgentSupport = async (args: {
  installDir: string;
}): Promise<{ supported: boolean; config: Config | null }> => {
  const { installDir } = args;

  // Load config to check installed agents
  const config = await loadConfig({ installDir });

  if (config == null) {
    // No config - allow (backwards compatibility with older installs)
    return { supported: true, config: null };
  }

  const installedAgents = getInstalledAgents({ config });

  // If only cursor-agent is installed (and not claude-code), reject
  if (
    installedAgents.includes("cursor-agent") &&
    !installedAgents.includes("claude-code")
  ) {
    return { supported: false, config };
  }

  return { supported: true, config };
};

/**
 * Display error message when cursor-agent-only installation tries to use
 * registry commands.
 */
export const showCursorAgentNotSupportedError = (): void => {
  newline();
  error({
    message:
      "Registry commands are not supported for Cursor-only installations.",
  });
  newline();
  info({
    message:
      "Profile packages downloaded from the registry are installed to ~/.claude/profiles/\nwhich requires Claude Code to be installed.",
  });
  newline();
  info({
    message: "To use registry features, install Claude Code:",
  });
  info({
    message: "  nori-ai install --agent claude-code",
  });
  newline();
};
