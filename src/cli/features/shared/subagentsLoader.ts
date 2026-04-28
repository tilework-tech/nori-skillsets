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

import { resetManagedDir } from "@/cli/features/shared/managedDirOps.js";
import {
  emitSubagentContent,
  type SubagentTargetFormat,
} from "@/cli/features/shared/subagentEmitter.js";
import { substituteTemplatePaths } from "@/cli/features/template.js";
import { bold } from "@/cli/logger.js";

import type { AgentLoader } from "@/cli/features/agentRegistry.js";

const SUBAGENT_MD = "SUBAGENT.md";

export const createSubagentsLoader = (args: {
  managedDirs: ReadonlyArray<string>;
  targetFormat?: SubagentTargetFormat | null;
}): AgentLoader => {
  const { managedDirs } = args;
  const targetFormat = args.targetFormat ?? "markdown";

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

      // Reset the destination, preserving any external dotfile entries.
      await resetManagedDir({ dir: destAgentsDir });

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

        try {
          const markdownContent = await fs.readFile(subagentMdPath, "utf-8");
          await writeSubagent({
            agentDir,
            commandsDir: agent.getSlashcommandsDir({
              installDir: config.installDir,
            }),
            destAgentsDir,
            fallbackName: dirName,
            markdownContent,
            skillsDir: agent.getSkillsDir({ installDir: config.installDir }),
            targetFormat,
          });
          registered.push(dirName);
        } catch {
          skipped.push(dirName);
        }
      }

      // Install flat files (skip those that collide with directory-based subagents)
      const flatSubagents = new Map<
        string,
        { markdownContent?: string | null; tomlContent?: string | null }
      >();

      for (const entry of entries) {
        if (entry.isDirectory) continue;
        if (entry.name === "docs.md" || entry.name === "docs.toml") continue;

        const extension = path.extname(entry.name);
        if (extension !== ".md" && extension !== ".toml") continue;

        if (targetFormat === "markdown" && extension !== ".md") continue;

        const subagentName = path.basename(entry.name, extension);

        // Directory-based subagents are single-source only. Temporary flat
        // foo.md + foo.toml backwards compatibility is supported for flat
        // subagents only and will be removed in v0.1.0.
        if (dirSubagentNames.has(subagentName)) {
          log.warn(
            `Skipping flat file ${entry.name} — directory-based subagent ${subagentName}/ takes precedence`,
          );
          continue;
        }

        const subagentSrc = path.join(configDir, entry.name);

        try {
          const content = await fs.readFile(subagentSrc, "utf-8");
          const existing = flatSubagents.get(subagentName) ?? {};
          flatSubagents.set(subagentName, {
            ...existing,
            markdownContent:
              extension === ".md" ? content : existing.markdownContent,
            tomlContent: extension === ".toml" ? content : existing.tomlContent,
          });
        } catch {
          skipped.push(subagentName);
        }
      }

      for (const [subagentName, flatSubagent] of flatSubagents.entries()) {
        try {
          await writeSubagent({
            agentDir,
            commandsDir: agent.getSlashcommandsDir({
              installDir: config.installDir,
            }),
            destAgentsDir,
            fallbackName: subagentName,
            markdownContent: flatSubagent.markdownContent ?? null,
            skillsDir: agent.getSkillsDir({ installDir: config.installDir }),
            targetFormat,
            tomlContent: flatSubagent.tomlContent ?? null,
          });
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

const writeSubagent = async (args: {
  agentDir: string;
  commandsDir: string;
  destAgentsDir: string;
  fallbackName: string;
  markdownContent?: string | null;
  skillsDir: string;
  targetFormat: SubagentTargetFormat;
  tomlContent?: string | null;
}) => {
  const {
    agentDir,
    commandsDir,
    destAgentsDir,
    fallbackName,
    markdownContent,
    skillsDir,
    targetFormat,
    tomlContent,
  } = args;

  if (targetFormat === "markdown") {
    if (markdownContent == null) {
      throw new Error(`Missing markdown content for ${fallbackName}`);
    }

    const substituted = substituteTemplatePaths({
      content: markdownContent,
      commandsDir,
      installDir: agentDir,
      skillsDir,
    });
    await fs.writeFile(
      path.join(destAgentsDir, `${fallbackName}.md`),
      substituted,
    );
    return;
  }

  const emitted = emitSubagentContent({
    fallbackName,
    markdownContent,
    targetFormat,
    tomlContent,
  });
  if (emitted == null) {
    throw new Error(`Missing subagent source for ${fallbackName}`);
  }

  const substituted = substituteTemplatePaths({
    content: emitted.content,
    commandsDir,
    installDir: agentDir,
    skillsDir,
  });
  await fs.writeFile(
    path.join(destAgentsDir, `${fallbackName}${emitted.extension}`),
    substituted,
  );
};
