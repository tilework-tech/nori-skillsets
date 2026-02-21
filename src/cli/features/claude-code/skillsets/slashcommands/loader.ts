/**
 * Slash commands feature loader
 * Registers all Nori slash commands with Claude Code
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { log, note } from "@clack/prompts";

import { getActiveSkillset, type Config } from "@/cli/config.js";
import {
  getClaudeDir,
  getClaudeCommandsDir,
  getNoriDir,
} from "@/cli/features/claude-code/paths.js";
import { substituteTemplatePaths } from "@/cli/features/claude-code/template.js";
import { bold } from "@/cli/logger.js";

import type { ProfileLoader } from "@/cli/features/claude-code/skillsets/skillsetLoaderRegistry.js";

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get config directory for slash commands based on selected profile
 *
 * @param args - Configuration arguments
 * @param args.skillsetName - Name of the profile to load slash commands from
 *
 * @returns Path to the slashcommands config directory for the profile
 */
const getConfigDir = (args: { skillsetName: string }): string => {
  const { skillsetName } = args;
  const noriDir = getNoriDir();
  return path.join(noriDir, "profiles", skillsetName, "slashcommands");
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

  // Get profile name from config - error if not configured
  const skillsetName = getActiveSkillset({ config });
  if (skillsetName == null) {
    throw new Error(
      "No skillset configured for claude-code. Run 'nori-skillsets init' to configure a skillset.",
    );
  }
  const configDir = getConfigDir({
    skillsetName,
  });
  const claudeCommandsDir = getClaudeCommandsDir({
    installDir: config.installDir,
  });

  // Remove existing commands directory if it exists, then recreate
  await fs.rm(claudeCommandsDir, { recursive: true, force: true });
  await fs.mkdir(claudeCommandsDir, { recursive: true });

  const registered: Array<string> = [];
  const skipped: Array<string> = [];

  // Read all .md files from the profile's slashcommands directory
  let files: Array<string>;
  try {
    files = await fs.readdir(configDir);
  } catch {
    log.warn("Profile slashcommands directory not found, skipping");
    return;
  }
  const mdFiles = files.filter(
    (file) => file.endsWith(".md") && file !== "docs.md",
  );

  for (const file of mdFiles) {
    const commandSrc = path.join(configDir, file);
    const commandDest = path.join(claudeCommandsDir, file);
    const commandName = file.replace(/\.md$/, "");

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
      registered.push(commandName);
    } catch {
      skipped.push(commandName);
    }
  }

  if (registered.length > 0) {
    const lines = registered.map((name) => `✓ /${name}`);
    const summary = bold({
      text: `Registered ${registered.length} slash command${registered.length === 1 ? "" : "s"}`,
    });
    lines.push("", summary);
    note(lines.join("\n"), "Slash Commands");
  }
  if (skipped.length > 0) {
    log.warn(
      `Skipped ${skipped.length} slash command${
        skipped.length === 1 ? "" : "s"
      } (not found): ${skipped.join(", ")}`,
    );
  }
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
};
