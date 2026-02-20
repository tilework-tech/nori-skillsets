/**
 * Slash commands feature loader
 * Registers all Nori slash commands with Claude Code
 */

import * as fs from "fs/promises";
import * as path from "path";

import { type Config } from "@/cli/config.js";
import {
  getClaudeDir,
  getClaudeCommandsDir,
} from "@/cli/features/claude-code/paths.js";
import { substituteTemplatePaths } from "@/cli/features/template.js";
import { success, info, warn } from "@/cli/logger.js";

import type { ProfileLoader } from "@/cli/features/claude-code/skillsets/skillsetLoaderRegistry.js";
import type { Skillset } from "@/cli/features/skillset.js";

/**
 * Register all slash commands
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 * @param args.skillset - Parsed skillset
 */
const registerSlashCommands = async (args: {
  config: Config;
  skillset: Skillset;
}): Promise<void> => {
  const { config, skillset } = args;
  info({ message: "Registering Nori slash commands..." });

  const configDir = skillset.slashcommandsDir;
  const claudeCommandsDir = getClaudeCommandsDir({
    installDir: config.installDir,
  });

  // Remove existing commands directory if it exists, then recreate
  await fs.rm(claudeCommandsDir, { recursive: true, force: true });
  await fs.mkdir(claudeCommandsDir, { recursive: true });

  let registeredCount = 0;
  let skippedCount = 0;

  // Read all .md files from the profile's slashcommands directory
  if (configDir == null) {
    info({ message: "Profile slashcommands directory not found, skipping" });
    return;
  }
  let files: Array<string>;
  try {
    files = await fs.readdir(configDir);
  } catch {
    info({ message: "Profile slashcommands directory not found, skipping" });
    return;
  }
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
 * Slash commands feature loader
 */
export const slashCommandsLoader: ProfileLoader = {
  name: "slashcommands",
  description: "Register all Nori slash commands with Claude Code",
  install: async (args: { config: Config; skillset: Skillset }) => {
    const { config, skillset } = args;
    await registerSlashCommands({ config, skillset });
  },
};
