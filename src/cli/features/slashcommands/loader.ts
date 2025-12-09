/**
 * Global slash commands feature loader
 * Registers profile-agnostic Nori slash commands with Claude Code
 * These commands are installed to ~/.claude/commands/ independent of profiles
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { getClaudeDir, getClaudeCommandsDir } from "@/cli/env.js";
import { success, info } from "@/cli/logger.js";
import { substituteTemplatePaths } from "@/utils/template.js";

import type { Config } from "@/cli/config.js";
import type {
  Loader,
  ValidationResult,
} from "@/cli/features/loaderRegistry.js";

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Config directory containing global slash command markdown files
const CONFIG_DIR = path.join(__dirname, "config");

/**
 * Get list of global slash commands by reading the config directory
 * @returns Array of command names (without .md extension)
 */
const getGlobalSlashCommands = async (): Promise<Array<string>> => {
  const files = await fs.readdir(CONFIG_DIR);
  return files
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
};

/**
 * Register all global slash commands
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const registerSlashCommands = async (args: {
  config: Config;
}): Promise<void> => {
  const { config } = args;
  info({ message: "Registering global Nori slash commands..." });

  const claudeCommandsDir = getClaudeCommandsDir({
    installDir: config.installDir,
  });

  // Create commands directory if it doesn't exist
  await fs.mkdir(claudeCommandsDir, { recursive: true });

  const commands = await getGlobalSlashCommands();
  let registeredCount = 0;

  for (const commandName of commands) {
    const fileName = `${commandName}.md`;
    const commandSrc = path.join(CONFIG_DIR, fileName);
    const commandDest = path.join(claudeCommandsDir, fileName);

    // Read content and apply template substitution
    const content = await fs.readFile(commandSrc, "utf-8");
    const claudeDir = getClaudeDir({ installDir: config.installDir });
    const substituted = substituteTemplatePaths({
      content,
      installDir: claudeDir,
    });
    await fs.writeFile(commandDest, substituted);
    success({ message: `✓ /${commandName} slash command registered` });
    registeredCount++;
  }

  if (registeredCount > 0) {
    success({
      message: `Successfully registered ${registeredCount} global slash command${
        registeredCount === 1 ? "" : "s"
      }`,
    });
  }
};

/**
 * Unregister all global slash commands
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const unregisterSlashCommands = async (args: {
  config: Config;
}): Promise<void> => {
  const { config } = args;
  info({ message: "Removing global Nori slash commands..." });

  let removedCount = 0;

  const claudeCommandsDir = getClaudeCommandsDir({
    installDir: config.installDir,
  });

  const commands = await getGlobalSlashCommands();

  for (const commandName of commands) {
    const fileName = `${commandName}.md`;
    const commandPath = path.join(claudeCommandsDir, fileName);

    try {
      await fs.access(commandPath);
      await fs.unlink(commandPath);
      success({ message: `✓ /${commandName} slash command removed` });
      removedCount++;
    } catch {
      // Command not found, which is fine
    }
  }

  if (removedCount > 0) {
    success({
      message: `Successfully removed ${removedCount} global slash command${
        removedCount === 1 ? "" : "s"
      }`,
    });
  }

  // Remove commands directory if empty
  try {
    const files = await fs.readdir(claudeCommandsDir);
    if (files.length === 0) {
      await fs.rmdir(claudeCommandsDir);
      success({ message: `✓ Removed empty directory: ${claudeCommandsDir}` });
    }
  } catch {
    // Directory doesn't exist or couldn't be removed, which is fine
  }
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
  const { config } = args;
  const errors: Array<string> = [];

  const claudeCommandsDir = getClaudeCommandsDir({
    installDir: config.installDir,
  });

  // Check if commands directory exists
  try {
    await fs.access(claudeCommandsDir);
  } catch {
    errors.push(`Commands directory not found at ${claudeCommandsDir}`);
    errors.push('Run "nori-ai install" to create the commands directory');
    return {
      valid: false,
      message: "Commands directory not found",
      errors,
    };
  }

  // Check if all expected global slash commands are present
  const commands = await getGlobalSlashCommands();
  const missingCommands: Array<string> = [];

  for (const commandName of commands) {
    const fileName = `${commandName}.md`;
    const commandPath = path.join(claudeCommandsDir, fileName);

    try {
      await fs.access(commandPath);
    } catch {
      missingCommands.push(commandName);
    }
  }

  if (missingCommands.length > 0) {
    errors.push(
      `Missing ${missingCommands.length} global slash command(s): ${missingCommands.join(", ")}`,
    );
    errors.push('Run "nori-ai install" to register missing commands');
    return {
      valid: false,
      message: "Some global slash commands are missing",
      errors,
    };
  }

  return {
    valid: true,
    message: `All ${commands.length} global slash commands are properly installed`,
    errors: null,
  };
};

/**
 * Global slash commands feature loader
 */
export const globalSlashCommandsLoader: Loader = {
  name: "slashcommands",
  description: "Register profile-agnostic Nori slash commands with Claude Code",
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
