/**
 * Shared subagents loader
 * Replaces both claude-code and cursor-agent subagents loaders
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log, note } from "@clack/prompts";

import { substituteTemplatePaths } from "@/cli/features/template.js";
import { bold } from "@/cli/logger.js";

import type { AgentLoader } from "@/cli/features/agentRegistry.js";

export const createSubagentsLoader = (args: {
  managedDirs: ReadonlyArray<string>;
}): AgentLoader => {
  const { managedDirs } = args;

  return {
    name: "subagents",
    description: "Register all Nori subagents",
    managedDirs,
    run: async ({ agent, config, skillset }) => {
      if (skillset == null) {
        return;
      }

      const configDir = skillset.subagentsDir;
      const destAgentsDir = agent.getSubagentsDir({
        installDir: config.installDir,
      });
      const agentDir = agent.getAgentDir({ installDir: config.installDir });

      // Remove existing agents directory if it exists, then recreate
      await fs.rm(destAgentsDir, { recursive: true, force: true });
      await fs.mkdir(destAgentsDir, { recursive: true });

      const registered: Array<string> = [];
      const skipped: Array<string> = [];

      if (configDir == null) {
        log.warn("Skillset subagents directory not found, skipping");
        return;
      }

      let files: Array<string>;
      try {
        files = await fs.readdir(configDir);
      } catch {
        log.warn("Skillset subagents directory not found, skipping");
        return;
      }

      const mdFiles = files.filter(
        (file) => file.endsWith(".md") && file !== "docs.md",
      );

      for (const file of mdFiles) {
        const subagentSrc = path.join(configDir, file);
        const subagentDest = path.join(destAgentsDir, file);
        const subagentName = file.replace(/\.md$/, "");

        try {
          await fs.access(subagentSrc);
          const content = await fs.readFile(subagentSrc, "utf-8");
          const substituted = substituteTemplatePaths({
            content,
            installDir: agentDir,
          });
          await fs.writeFile(subagentDest, substituted);
          registered.push(subagentName);
        } catch {
          skipped.push(subagentName);
        }
      }

      if (registered.length > 0) {
        const lines = registered.map((name) => `✓ ${name}`);
        const summary = bold({
          text: `Registered ${registered.length} subagent${registered.length === 1 ? "" : "s"}`,
        });
        lines.push("", summary);
        note(lines.join("\n"), "Subagents");
      }
      if (skipped.length > 0) {
        log.warn(
          `Skipped ${skipped.length} subagent${
            skipped.length === 1 ? "" : "s"
          } (not found): ${skipped.join(", ")}`,
        );
      }
    },
  };
};
