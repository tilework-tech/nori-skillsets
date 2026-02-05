/**
 * Global slash commands feature loader
 *
 * This loader previously registered profile-agnostic Nori slash commands.
 * Global slash commands have been removed - this loader is now a no-op
 * but kept for backwards compatibility with the loader registry.
 */

import { info } from "@/cli/logger.js";

import type { Config } from "@/cli/config.js";
import type { Loader, ValidationResult } from "@/cli/features/agentRegistry.js";

/**
 * Register all global slash commands (no-op - commands removed)
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const registerSlashCommands = async (args: {
  config: Config;
}): Promise<void> => {
  const { config: _config } = args;
  info({ message: "No global slash commands to register" });
};

/**
 * Unregister all global slash commands (no-op - commands removed)
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const unregisterSlashCommands = async (args: {
  config: Config;
}): Promise<void> => {
  const { config: _config } = args;
  info({ message: "No global slash commands to remove" });
};

/**
 * Validate global slash commands installation
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 *
 * @returns Validation result
 */
const validate = async (args: {
  config: Config;
}): Promise<ValidationResult> => {
  const { config: _config } = args;

  return {
    valid: true,
    message: "No global slash commands configured",
    errors: null,
  };
};

/**
 * Global slash commands feature loader
 */
export const globalSlashCommandsLoader: Loader = {
  name: "slashcommands",
  description: "Global Nori slash commands",
  run: async (args: { config: Config }) => {
    const { config } = args;
    await registerSlashCommands({ config });
  },
  uninstall: async (args: { config: Config }) => {
    const { config } = args;
    await unregisterSlashCommands({ config });
  },
  validate,
};
