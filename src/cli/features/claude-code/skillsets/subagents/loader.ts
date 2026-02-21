/**
 * Subagents feature loader
 * Registers all Nori subagents with Claude Code
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { log, note } from "@clack/prompts";

import { getActiveSkillset, type Config } from "@/cli/config.js";
import {
  getClaudeDir,
  getClaudeAgentsDir,
  getNoriDir,
} from "@/cli/features/claude-code/paths.js";
import { substituteTemplatePaths } from "@/cli/features/claude-code/template.js";
import { bold } from "@/cli/logger.js";

import type { ProfileLoader } from "@/cli/features/claude-code/skillsets/skillsetLoaderRegistry.js";

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get config directory for subagents based on selected profile
 *
 * @param args - Configuration arguments
 * @param args.skillsetName - Name of the profile to load subagents from
 *
 * @returns Path to the subagents config directory for the profile
 */
const getConfigDir = (args: { skillsetName: string }): string => {
  const { skillsetName } = args;
  const noriDir = getNoriDir();
  return path.join(noriDir, "profiles", skillsetName, "subagents");
};

/**
 * Register all subagents
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const registerSubagents = async (args: { config: Config }): Promise<void> => {
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
  const claudeAgentsDir = getClaudeAgentsDir({ installDir: config.installDir });

  // Remove existing agents directory if it exists, then recreate
  await fs.rm(claudeAgentsDir, { recursive: true, force: true });
  await fs.mkdir(claudeAgentsDir, { recursive: true });

  const registered: Array<string> = [];
  const skipped: Array<string> = [];

  // Read all .md files from the profile's subagents directory
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
    const subagentDest = path.join(claudeAgentsDir, file);
    const subagentName = file.replace(/\.md$/, "");

    try {
      await fs.access(subagentSrc);
      const content = await fs.readFile(subagentSrc, "utf-8");
      const claudeDir = getClaudeDir({ installDir: config.installDir });
      const substituted = substituteTemplatePaths({
        content,
        installDir: claudeDir,
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
};

/**
 * Subagents feature loader
 */
export const subagentsLoader: ProfileLoader = {
  name: "subagents",
  description: "Register all Nori subagents with Claude Code",
  install: async (args: { config: Config }) => {
    const { config } = args;
    await registerSubagents({ config });
  },
};
