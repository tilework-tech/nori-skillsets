/**
 * Shared subagents loader
 * Copies subagent .md files to the agent's agents directory
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
 * Register all subagents from a skillset to the agent's agents directory
 * @param args - Function arguments
 * @param args.agentConfig - The agent configuration
 * @param args.config - The Nori configuration
 * @param args.skillset - The parsed skillset
 */
export const installSubagents = async (args: {
  agentConfig: AgentConfig;
  config: Config;
  skillset: Skillset;
}): Promise<void> => {
  const { agentConfig, config, skillset } = args;

  const configDir = skillset.subagentsDir;
  const agentDirPath = getAgentDir({
    agentConfig,
    installDir: config.installDir,
  });
  const agentsDir = path.join(agentDirPath, agentConfig.subagentsPath);

  // Remove existing agents directory if it exists, then recreate
  await fs.rm(agentsDir, { recursive: true, force: true });
  await fs.mkdir(agentsDir, { recursive: true });

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
    const subagentDest = path.join(agentsDir, file);
    const subagentName = file.replace(/\.md$/, "");

    try {
      await fs.access(subagentSrc);
      const content = await fs.readFile(subagentSrc, "utf-8");
      const substituted = substituteTemplatePaths({
        content,
        installDir: agentDirPath,
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
    const noteTitle =
      agentConfig.name === "claude-code"
        ? "Subagents"
        : `${agentConfig.displayName} Subagents`;
    note(lines.join("\n"), noteTitle);
  }
  if (skipped.length > 0) {
    log.warn(
      `Skipped ${skipped.length} subagent${
        skipped.length === 1 ? "" : "s"
      } (not found): ${skipped.join(", ")}`,
    );
  }
};
