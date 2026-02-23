/**
 * Slash commands feature loader
 * Registers all Nori slash commands with Claude Code
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log, note } from "@clack/prompts";

import { type Config } from "@/cli/config.js";
import {
  getClaudeDir,
  getClaudeCommandsDir,
} from "@/cli/features/claude-code/paths.js";
import { substituteTemplatePaths } from "@/cli/features/template.js";
import { bold } from "@/cli/logger.js";

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

  const configDir = skillset.slashcommandsDir;
  const claudeCommandsDir = getClaudeCommandsDir({
    installDir: config.installDir,
  });

  // Remove existing commands directory if it exists, then recreate
  await fs.rm(claudeCommandsDir, { recursive: true, force: true });
  await fs.mkdir(claudeCommandsDir, { recursive: true });

  const registered: Array<string> = [];
  const skipped: Array<string> = [];

  // Read all .md files from the profile's slashcommands directory
  if (configDir == null) {
    log.warn("Profile slashcommands directory not found, skipping");
    return;
  }
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
  install: async (args: { config: Config; skillset: Skillset }) => {
    const { config, skillset } = args;
    await registerSlashCommands({ config, skillset });
  },
};
