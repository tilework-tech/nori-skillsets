/**
 * Cursor Agent slash commands feature loader
 * Registers Nori slash commands with Cursor
 * These commands are installed to ~/.cursor/commands/
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import {
  getCursorDir,
  getCursorCommandsDir,
} from "@/cli/features/cursor-agent/paths.js";
import { substituteTemplatePaths } from "@/cli/features/cursor-agent/template.js";
import { success, info } from "@/cli/logger.js";

import type { Config } from "@/cli/config.js";
import type { Loader, ValidationResult } from "@/cli/features/agentRegistry.js";

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Config directory containing slash command markdown files
const CONFIG_DIR = path.join(__dirname, "config");

/**
 * Get list of slash commands by reading the config directory
 * @returns Array of command names (without .md extension)
 */
const getSlashCommands = async (): Promise<Array<string>> => {
  const files = await fs.readdir(CONFIG_DIR);
  return files
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
};

/**
 * Register all slash commands
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const registerSlashCommands = async (args: {
  config: Config;
}): Promise<void> => {
  const { config } = args;
  info({ message: "Registering Cursor slash commands..." });

  const cursorCommandsDir = getCursorCommandsDir({
    installDir: config.installDir,
  });

  // Create commands directory if it doesn't exist
  await fs.mkdir(cursorCommandsDir, { recursive: true });

  const commands = await getSlashCommands();
  let registeredCount = 0;

  for (const commandName of commands) {
    const fileName = `${commandName}.md`;
    const commandSrc = path.join(CONFIG_DIR, fileName);
    const commandDest = path.join(cursorCommandsDir, fileName);

    // Read content and apply template substitution
    const content = await fs.readFile(commandSrc, "utf-8");
    const cursorDir = getCursorDir({ installDir: config.installDir });
    const substituted = substituteTemplatePaths({
      content,
      installDir: cursorDir,
    });
    await fs.writeFile(commandDest, substituted);
    success({ message: `✓ /${commandName} slash command registered` });
    registeredCount++;
  }

  if (registeredCount > 0) {
    success({
      message: `Successfully registered ${registeredCount} Cursor slash command${
        registeredCount === 1 ? "" : "s"
      }`,
    });
  }
};

/**
 * Unregister all slash commands
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const unregisterSlashCommands = async (args: {
  config: Config;
}): Promise<void> => {
  const { config } = args;
  info({ message: "Removing Cursor slash commands..." });

  let removedCount = 0;

  const cursorCommandsDir = getCursorCommandsDir({
    installDir: config.installDir,
  });

  const commands = await getSlashCommands();

  for (const commandName of commands) {
    const fileName = `${commandName}.md`;
    const commandPath = path.join(cursorCommandsDir, fileName);

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
      message: `Successfully removed ${removedCount} Cursor slash command${
        removedCount === 1 ? "" : "s"
      }`,
    });
  }

  // Remove commands directory if empty
  try {
    const files = await fs.readdir(cursorCommandsDir);
    if (files.length === 0) {
      await fs.rmdir(cursorCommandsDir);
      success({ message: `✓ Removed empty directory: ${cursorCommandsDir}` });
    }
  } catch {
    // Directory doesn't exist or couldn't be removed, which is fine
  }
};

/**
 * Validate slash commands installation
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

  const cursorCommandsDir = getCursorCommandsDir({
    installDir: config.installDir,
  });

  // Check if commands directory exists
  try {
    await fs.access(cursorCommandsDir);
  } catch {
    errors.push(`Commands directory not found at ${cursorCommandsDir}`);
    errors.push(
      'Run "nori-ai install --agent cursor-agent" to create the commands directory',
    );
    return {
      valid: false,
      message: "Commands directory not found",
      errors,
    };
  }

  // Check if all expected slash commands are present
  const commands = await getSlashCommands();
  const missingCommands: Array<string> = [];

  for (const commandName of commands) {
    const fileName = `${commandName}.md`;
    const commandPath = path.join(cursorCommandsDir, fileName);

    try {
      await fs.access(commandPath);
    } catch {
      missingCommands.push(commandName);
    }
  }

  if (missingCommands.length > 0) {
    errors.push(
      `Missing ${missingCommands.length} slash command(s): ${missingCommands.join(", ")}`,
    );
    errors.push(
      'Run "nori-ai install --agent cursor-agent" to register missing commands',
    );
    return {
      valid: false,
      message: "Some slash commands are missing",
      errors,
    };
  }

  return {
    valid: true,
    message: `All ${commands.length} Cursor slash commands are properly installed`,
    errors: null,
  };
};

/**
 * Cursor slash commands feature loader
 */
export const cursorSlashCommandsLoader: Loader = {
  name: "slashcommands",
  description: "Register Nori slash commands with Cursor",
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
