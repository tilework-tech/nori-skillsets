/**
 * Subagents feature loader
 * Registers all Nori subagents with Claude Code
 */

import * as fs from "fs/promises";
import * as path from "path";

import {
  getClaudeDir,
  getClaudeAgentsDir,
} from "@/cli/features/claude-code/paths.js";
import { substituteTemplatePaths } from "@/cli/features/claude-code/template.js";
import { success, info } from "@/cli/logger.js";

import type { Config } from "@/cli/config.js";
import type { ProfileLoader } from "@/cli/features/claude-code/profiles/profileLoaderRegistry.js";
import type { SkillsetPackage } from "@/norijson/packageStructure.js";

/**
 * Register all subagents
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 * @param args.pkg - The loaded skillset package
 */
const registerSubagents = async (args: {
  config: Config;
  pkg: SkillsetPackage;
}): Promise<void> => {
  const { config, pkg } = args;
  info({ message: "Registering Nori subagents..." });

  const claudeAgentsDir = getClaudeAgentsDir({ installDir: config.installDir });

  // Remove existing agents directory if it exists, then recreate
  await fs.rm(claudeAgentsDir, { recursive: true, force: true });
  await fs.mkdir(claudeAgentsDir, { recursive: true });

  let registeredCount = 0;

  for (const entry of pkg.subagents) {
    const subagentDest = path.join(claudeAgentsDir, entry.filename);
    const claudeDir = getClaudeDir({ installDir: config.installDir });
    const substituted = substituteTemplatePaths({
      content: entry.content,
      installDir: claudeDir,
    });
    await fs.writeFile(subagentDest, substituted);
    const subagentName = entry.filename.replace(/\.md$/, "");
    success({ message: `✓ ${subagentName} subagent registered` });
    registeredCount++;
  }

  if (registeredCount > 0) {
    success({
      message: `Successfully registered ${registeredCount} subagent${
        registeredCount === 1 ? "" : "s"
      }`,
    });
  }
};

/**
 * Subagents feature loader
 */
export const subagentsLoader: ProfileLoader = {
  name: "subagents",
  description: "Register all Nori subagents with Claude Code",
  install: async (args: { config: Config; pkg: SkillsetPackage }) => {
    const { config, pkg } = args;
    await registerSubagents({ config, pkg });
  },
};
