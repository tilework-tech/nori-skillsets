/**
 * Shared slash commands loader
 * Replaces both claude-code and cursor-agent slash commands loaders
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log, note } from "@clack/prompts";

import { resetManagedDir } from "@/cli/features/shared/managedDirOps.js";
import { substituteTemplatePaths } from "@/cli/features/template.js";
import { bold } from "@/cli/logger.js";

import type { AgentLoader } from "@/cli/features/agentRegistry.js";

export const createSlashCommandsLoader = (args: {
  managedDirs: ReadonlyArray<string>;
}): AgentLoader => {
  const { managedDirs } = args;

  return {
    name: "slashcommands",
    description: "Register all Nori slash commands",
    managedDirs,
    run: async ({ agent, config, skillset }) => {
      if (skillset == null) {
        return;
      }

      const configDir = skillset.slashcommandsDir;
      const destCommandsDir = agent.getSlashcommandsDir({
        installDir: config.installDir,
      });
      const agentDir = agent.getAgentDir({ installDir: config.installDir });
      const skillsDir = agent.getSkillsDir({ installDir: config.installDir });

      // Reset the destination, preserving any external dotfile entries.
      await resetManagedDir({ dir: destCommandsDir });

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
        const commandDest = path.join(destCommandsDir, file);
        const commandName = file.replace(/\.md$/, "");

        try {
          await fs.access(commandSrc);
          const content = await fs.readFile(commandSrc, "utf-8");
          const substituted = substituteTemplatePaths({
            content,
            commandsDir: destCommandsDir,
            installDir: agentDir,
            skillsDir,
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
    },
  };
};
