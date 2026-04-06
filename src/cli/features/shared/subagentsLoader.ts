/**
 * Shared subagents loader
 * Replaces both claude-code and cursor-agent subagents loaders
 *
 * Supports two subagent formats:
 * - Flat files: subagents/foo.md -> agents/foo.md
 * - Directory-based: subagents/foo/SUBAGENT.md -> agents/foo.md (flattened)
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log, note } from "@clack/prompts";

import { substituteTemplatePaths } from "@/cli/features/template.js";
import { bold } from "@/cli/logger.js";

import type { AgentLoader } from "@/cli/features/agentRegistry.js";

const SUBAGENT_MD = "SUBAGENT.md";

export const createSubagentsLoader = (args: {
  managedDirs: ReadonlyArray<string>;
  fileExtension?: string | null;
}): AgentLoader => {
  const { managedDirs } = args;
  const fileExtension = args.fileExtension ?? ".md";

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

      let entries: Array<{ name: string; isDirectory: boolean }>;
      try {
        const dirEntries = await fs.readdir(configDir, { withFileTypes: true });
        entries = dirEntries.map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
        }));
      } catch {
        log.warn("Skillset subagents directory not found, skipping");
        return;
      }

      // Collect directory-based subagents (those with SUBAGENT.md)
      const dirSubagentNames = new Set<string>();
      for (const entry of entries) {
        if (!entry.isDirectory) continue;
        const subagentMdPath = path.join(configDir, entry.name, SUBAGENT_MD);
        try {
          await fs.access(subagentMdPath);
          dirSubagentNames.add(entry.name);
        } catch {
          // No SUBAGENT.md — ignore this directory
        }
      }

      // Install directory-based subagents (flattened: SUBAGENT.md -> name.ext)
      for (const dirName of dirSubagentNames) {
        const subagentMdPath = path.join(configDir, dirName, SUBAGENT_MD);
        const destFile = path.join(destAgentsDir, `${dirName}${fileExtension}`);

        try {
          const content = await fs.readFile(subagentMdPath, "utf-8");
          const substituted = substituteTemplatePaths({
            content,
            installDir: agentDir,
          });
          await fs.writeFile(destFile, substituted);
          registered.push(dirName);
        } catch {
          skipped.push(dirName);
        }
      }

      // Install flat files (skip those that collide with directory-based subagents)
      const docsFile = `docs${fileExtension}`;
      for (const entry of entries) {
        if (entry.isDirectory) continue;
        if (!entry.name.endsWith(fileExtension)) continue;
        if (entry.name === docsFile) continue;

        const subagentName = entry.name.slice(0, -fileExtension.length);

        // Directory-based subagent takes precedence on name collision
        if (dirSubagentNames.has(subagentName)) {
          log.warn(
            `Skipping flat file ${entry.name} — directory-based subagent ${subagentName}/ takes precedence`,
          );
          continue;
        }

        const subagentSrc = path.join(configDir, entry.name);
        const subagentDest = path.join(destAgentsDir, entry.name);

        try {
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
