/**
 * Slash commands feature loader
 * Registers all Nori slash commands with Claude Code
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { getAgentProfile, type Config } from "@/cli/config.js";
import {
  getClaudeDir,
  getClaudeCommandsDir,
} from "@/cli/features/claude-code/paths.js";
import { substituteTemplatePaths } from "@/cli/features/claude-code/template.js";
import { success, info, warn } from "@/cli/logger.js";

import type { ValidationResult } from "@/cli/features/agentRegistry.js";
import type { ProfileLoader } from "@/cli/features/claude-code/profiles/profileLoaderRegistry.js";

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get config directory for slash commands based on selected profile
 *
 * @param args - Configuration arguments
 * @param args.profileName - Name of the profile to load slash commands from
 * @param args.installDir - Installation directory
 *
 * @returns Path to the slashcommands config directory for the profile
 */
const getConfigDir = (args: {
  profileName: string;
  installDir: string;
}): string => {
  const { profileName, installDir } = args;
  const claudeDir = getClaudeDir({ installDir });
  return path.join(claudeDir, "profiles", profileName, "slashcommands");
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
  info({ message: "Registering Nori slash commands..." });

  // Get profile name from config - error if not configured
  const profileName = getAgentProfile({
    config,
    agentName: "claude-code",
  })?.baseProfile;
  if (profileName == null) {
    throw new Error(
      "No profile configured for claude-code. Run 'nori-ai install' to configure a profile.",
    );
  }
  const configDir = getConfigDir({
    profileName,
    installDir: config.installDir,
  });
  const claudeCommandsDir = getClaudeCommandsDir({
    installDir: config.installDir,
  });

  // Create commands directory if it doesn't exist
  await fs.mkdir(claudeCommandsDir, { recursive: true });

  let registeredCount = 0;
  let skippedCount = 0;

  // Read all .md files from the profile's slashcommands directory
  const files = await fs.readdir(configDir);
  const mdFiles = files.filter(
    (file) => file.endsWith(".md") && file !== "docs.md",
  );

  for (const file of mdFiles) {
    const commandSrc = path.join(configDir, file);
    const commandDest = path.join(claudeCommandsDir, file);

    try {
      await fs.access(commandSrc);
      // Read content and apply template substitution for markdown files
      const content = await fs.readFile(commandSrc, "utf-8");
      const claudeDir = getClaudeDir({ installDir: config.installDir });
      const substituted = substituteTemplatePaths({
        content,
        installDir: claudeDir,
      });
      await fs.writeFile(commandDest, substituted);
      const commandName = file.replace(/\.md$/, "");
      success({ message: `✓ /${commandName} slash command registered` });
      registeredCount++;
    } catch {
      warn({
        message: `Slash command definition not found at ${commandSrc}, skipping`,
      });
      skippedCount++;
    }
  }

  if (registeredCount > 0) {
    success({
      message: `Successfully registered ${registeredCount} slash command${
        registeredCount === 1 ? "" : "s"
      }`,
    });
  }
  if (skippedCount > 0) {
    warn({
      message: `Skipped ${skippedCount} slash command${
        skippedCount === 1 ? "" : "s"
      } (not found)`,
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
  info({ message: "Removing Nori slash commands..." });

  let removedCount = 0;

  // Get profile name from config - skip gracefully if not configured
  // (uninstall should be permissive and clean up whatever is possible)
  const profileName = getAgentProfile({
    config,
    agentName: "claude-code",
  })?.baseProfile;
  if (profileName == null) {
    info({
      message:
        "No profile configured for claude-code, skipping slash commands cleanup",
    });
    return;
  }
  const configDir = getConfigDir({
    profileName,
    installDir: config.installDir,
  });
  const claudeCommandsDir = getClaudeCommandsDir({
    installDir: config.installDir,
  });

  // Read all .md files from the profile's slashcommands directory
  try {
    const files = await fs.readdir(configDir);
    const mdFiles = files.filter(
      (file) => file.endsWith(".md") && file !== "docs.md",
    );

    for (const file of mdFiles) {
      const commandPath = path.join(claudeCommandsDir, file);

      try {
        await fs.access(commandPath);
        await fs.unlink(commandPath);
        const commandName = file.replace(/\.md$/, "");
        success({ message: `✓ /${commandName} slash command removed` });
        removedCount++;
      } catch {
        const commandName = file.replace(/\.md$/, "");
        info({
          message: `/${commandName} slash command not found (may not be installed)`,
        });
      }
    }
  } catch {
    info({ message: "Profile slashcommands directory not found" });
  }

  if (removedCount > 0) {
    success({
      message: `Successfully removed ${removedCount} slash command${
        removedCount === 1 ? "" : "s"
      }`,
    });
  }

  // Remove parent directory if empty
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

  // Get profile name from config - error if not configured
  const profileName = getAgentProfile({
    config,
    agentName: "claude-code",
  })?.baseProfile;
  if (profileName == null) {
    errors.push("No profile configured for claude-code");
    errors.push("Run 'nori-ai install' to configure a profile");
    return {
      valid: false,
      message: "No profile configured",
      errors,
    };
  }
  const configDir = getConfigDir({
    profileName,
    installDir: config.installDir,
  });

  // Check if all expected slash commands are present
  const missingCommands: Array<string> = [];
  let expectedCount = 0;

  try {
    const files = await fs.readdir(configDir);
    const mdFiles = files.filter(
      (file) => file.endsWith(".md") && file !== "docs.md",
    );
    expectedCount = mdFiles.length;

    for (const file of mdFiles) {
      const commandPath = path.join(claudeCommandsDir, file);
      try {
        await fs.access(commandPath);
      } catch {
        missingCommands.push(file.replace(/\.md$/, ""));
      }
    }
  } catch {
    errors.push(`Profile slashcommands directory not found at ${configDir}`);
    return {
      valid: false,
      message: "Profile slashcommands directory not found",
      errors,
    };
  }

  if (missingCommands.length > 0) {
    errors.push(
      `Missing ${
        missingCommands.length
      } slash command(s): ${missingCommands.join(", ")}`,
    );
    errors.push('Run "nori-ai install" to register missing commands');
    return {
      valid: false,
      message: "Some slash commands are not installed",
      errors,
    };
  }

  return {
    valid: true,
    message: `All ${expectedCount} slash commands are properly installed`,
    errors: null,
  };
};

/**
 * Slash commands feature loader
 */
export const slashCommandsLoader: ProfileLoader = {
  name: "slashcommands",
  description: "Register all Nori slash commands with Claude Code",
  install: async (args: { config: Config }) => {
    const { config } = args;
    await registerSlashCommands({ config });
  },
  uninstall: async (args: { config: Config }) => {
    const { config } = args;
    await unregisterSlashCommands({ config });
  },
  validate,
};
