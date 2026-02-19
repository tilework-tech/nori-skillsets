/**
 * Slash commands feature loader
 * Registers all Nori slash commands with Claude Code
 */

import * as fs from "fs/promises";
import * as path from "path";

import {
  getClaudeDir,
  getClaudeCommandsDir,
} from "@/cli/features/claude-code/paths.js";
import { substituteTemplatePaths } from "@/cli/features/claude-code/template.js";
import { success, info } from "@/cli/logger.js";

import type { Config } from "@/cli/config.js";
import type { ProfileLoader } from "@/cli/features/claude-code/profiles/profileLoaderRegistry.js";
import type { SkillsetPackage } from "@/norijson/packageStructure.js";

/**
 * Register all slash commands
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 * @param args.pkg - The loaded skillset package
 */
const registerSlashCommands = async (args: {
  config: Config;
  pkg: SkillsetPackage;
}): Promise<void> => {
  const { config, pkg } = args;
  info({ message: "Registering Nori slash commands..." });

  const claudeCommandsDir = getClaudeCommandsDir({
    installDir: config.installDir,
  });

  // Remove existing commands directory if it exists, then recreate
  await fs.rm(claudeCommandsDir, { recursive: true, force: true });
  await fs.mkdir(claudeCommandsDir, { recursive: true });

  let registeredCount = 0;

  for (const entry of pkg.slashcommands) {
    const commandDest = path.join(claudeCommandsDir, entry.filename);
    const claudeDir = getClaudeDir({ installDir: config.installDir });
    const substituted = substituteTemplatePaths({
      content: entry.content,
      installDir: claudeDir,
    });
    await fs.writeFile(commandDest, substituted);
    const commandName = entry.filename.replace(/\.md$/, "");
    success({ message: `✓ /${commandName} slash command registered` });
    registeredCount++;
  }

  if (registeredCount > 0) {
    success({
      message: `Successfully registered ${registeredCount} slash command${
        registeredCount === 1 ? "" : "s"
      }`,
    });
  }
};

/**
 * Slash commands feature loader
 */
export const slashCommandsLoader: ProfileLoader = {
  name: "slashcommands",
  description: "Register all Nori slash commands with Claude Code",
  install: async (args: { config: Config; pkg: SkillsetPackage }) => {
    const { config, pkg } = args;
    await registerSlashCommands({ config, pkg });
  },
};
