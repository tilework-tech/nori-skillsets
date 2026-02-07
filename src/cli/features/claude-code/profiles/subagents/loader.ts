/**
 * Subagents feature loader
 * Registers all Nori subagents with Claude Code
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { getAgentProfile, type Config } from "@/cli/config.js";
import {
  getClaudeDir,
  getClaudeAgentsDir,
  getNoriDir,
} from "@/cli/features/claude-code/paths.js";
import { substituteTemplatePaths } from "@/cli/features/claude-code/template.js";
import { success, info, warn } from "@/cli/logger.js";

import type { ProfileLoader } from "@/cli/features/claude-code/profiles/profileLoaderRegistry.js";

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get config directory for subagents based on selected profile
 *
 * @param args - Configuration arguments
 * @param args.profileName - Name of the profile to load subagents from
 *
 * @returns Path to the subagents config directory for the profile
 */
const getConfigDir = (args: { profileName: string }): string => {
  const { profileName } = args;
  const noriDir = getNoriDir();
  return path.join(noriDir, "profiles", profileName, "subagents");
};

/**
 * Register all subagents
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const registerSubagents = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  info({ message: "Registering Nori subagents..." });

  // Get profile name from config - error if not configured
  const profileName = getAgentProfile({
    config,
    agentName: "claude-code",
  })?.baseProfile;
  if (profileName == null) {
    throw new Error(
      "No profile configured for claude-code. Run 'nori-skillsets init' to configure a profile.",
    );
  }
  const configDir = getConfigDir({
    profileName,
  });
  const claudeAgentsDir = getClaudeAgentsDir({ installDir: config.installDir });

  // Remove existing agents directory if it exists, then recreate
  await fs.rm(claudeAgentsDir, { recursive: true, force: true });
  await fs.mkdir(claudeAgentsDir, { recursive: true });

  let registeredCount = 0;
  let skippedCount = 0;

  // Read all .md files from the profile's subagents directory
  let files: Array<string>;
  try {
    files = await fs.readdir(configDir);
  } catch {
    info({ message: "Profile subagents directory not found, skipping" });
    return;
  }
  const mdFiles = files.filter(
    (file) => file.endsWith(".md") && file !== "docs.md",
  );

  for (const file of mdFiles) {
    const subagentSrc = path.join(configDir, file);
    const subagentDest = path.join(claudeAgentsDir, file);

    try {
      await fs.access(subagentSrc);
      const content = await fs.readFile(subagentSrc, "utf-8");
      const claudeDir = getClaudeDir({ installDir: config.installDir });
      const substituted = substituteTemplatePaths({
        content,
        installDir: claudeDir,
      });
      await fs.writeFile(subagentDest, substituted);
      const subagentName = file.replace(/\.md$/, "");
      success({ message: `✓ ${subagentName} subagent registered` });
      registeredCount++;
    } catch {
      warn({
        message: `Subagent definition not found at ${subagentSrc}, skipping`,
      });
      skippedCount++;
    }
  }

  if (registeredCount > 0) {
    success({
      message: `Successfully registered ${registeredCount} subagent${
        registeredCount === 1 ? "" : "s"
      }`,
    });
  }
  if (skippedCount > 0) {
    warn({
      message: `Skipped ${skippedCount} subagent${
        skippedCount === 1 ? "" : "s"
      } (not found)`,
    });
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
