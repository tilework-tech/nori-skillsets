/**
 * Shared slash commands loader
 * Copies slash command .md files to the agent's commands directory
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log, note } from "@clack/prompts";

import { type Config } from "@/cli/config.js";
import { getAgentDir } from "@/cli/features/shared/agentHandlers.js";
import { substituteTemplatePaths } from "@/cli/features/template.js";
import { bold } from "@/cli/logger.js";

import type { AgentConfig } from "@/cli/features/agentRegistry.js";
import type { Skillset } from "@/cli/features/skillset.js";

/**
 * Register all slash commands from a skillset to the agent's commands directory
 * @param args
 * @param args.agentConfig
 * @param args.config
 * @param args.skillset
 */
export const installSlashCommands = async (args: {
  agentConfig: AgentConfig;
  config: Config;
  skillset: Skillset;
}): Promise<void> => {
  const { agentConfig, config, skillset } = args;

  const configDir = skillset.slashcommandsDir;
  const agentDirPath = getAgentDir({
    agentConfig,
    installDir: config.installDir,
  });
  const commandsDir = path.join(agentDirPath, agentConfig.slashcommandsPath);

  // Remove existing commands directory if it exists, then recreate
  await fs.rm(commandsDir, { recursive: true, force: true });
  await fs.mkdir(commandsDir, { recursive: true });

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
    const commandDest = path.join(commandsDir, file);
    const commandName = file.replace(/\.md$/, "");

    try {
      await fs.access(commandSrc);
      const content = await fs.readFile(commandSrc, "utf-8");
      const substituted = substituteTemplatePaths({
        content,
        installDir: agentDirPath,
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
    const noteTitle =
      agentConfig.name === "claude-code"
        ? "Slash Commands"
        : `${agentConfig.displayName} Slash Commands`;
    note(lines.join("\n"), noteTitle);
  }
  if (skipped.length > 0) {
    log.warn(
      `Skipped ${skipped.length} slash command${
        skipped.length === 1 ? "" : "s"
      } (not found): ${skipped.join(", ")}`,
    );
  }
};
