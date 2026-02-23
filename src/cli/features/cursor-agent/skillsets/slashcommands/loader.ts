/**
 * Slash commands feature loader for Cursor
 * Registers all Nori slash commands with Cursor
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log, note } from "@clack/prompts";

import { type Config } from "@/cli/config.js";
import {
  getCursorDir,
  getCursorCommandsDir,
} from "@/cli/features/cursor-agent/paths.js";
import { substituteTemplatePaths } from "@/cli/features/template.js";
import { bold } from "@/cli/logger.js";

import type { CursorProfileLoader } from "@/cli/features/cursor-agent/skillsets/skillsetLoaderRegistry.js";
import type { Skillset } from "@/cli/features/skillset.js";

/**
 * Register all slash commands for Cursor
 *
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
  const cursorCommandsDir = getCursorCommandsDir({
    installDir: config.installDir,
  });

  // Remove existing commands directory if it exists, then recreate
  await fs.rm(cursorCommandsDir, { recursive: true, force: true });
  await fs.mkdir(cursorCommandsDir, { recursive: true });

  const registered: Array<string> = [];
  const skipped: Array<string> = [];

  if (configDir == null) {
    log.warn("Skillset slashcommands directory not found, skipping");
    return;
  }
  let files: Array<string>;
  try {
    files = await fs.readdir(configDir);
  } catch {
    log.warn("Skillset slashcommands directory not found, skipping");
    return;
  }
  const mdFiles = files.filter(
    (file) => file.endsWith(".md") && file !== "docs.md",
  );

  for (const file of mdFiles) {
    const commandSrc = path.join(configDir, file);
    const commandDest = path.join(cursorCommandsDir, file);
    const commandName = file.replace(/\.md$/, "");

    try {
      await fs.access(commandSrc);
      const content = await fs.readFile(commandSrc, "utf-8");
      const cursorDir = getCursorDir({ installDir: config.installDir });
      const substituted = substituteTemplatePaths({
        content,
        installDir: cursorDir,
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
    note(lines.join("\n"), "Cursor Slash Commands");
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
 * Slash commands feature loader for Cursor
 */
export const slashCommandsLoader: CursorProfileLoader = {
  name: "slashcommands",
  description: "Register all Nori slash commands with Cursor",
  install: async (args: { config: Config; skillset: Skillset }) => {
    const { config, skillset } = args;
    await registerSlashCommands({ config, skillset });
  },
};
