/**
 * Claude Code agent configuration
 * Pure data struct — all behavior lives in shared handler functions
 */

import * as fsSync from "fs";
import * as fs from "fs/promises";
import * as path from "path";

import { announcementsLoader } from "@/cli/features/claude-code/announcements/loader.js";
import {
  factoryResetClaudeCode,
  findClaudeCodeArtifacts,
} from "@/cli/features/claude-code/factoryReset.js";
import { hooksLoader } from "@/cli/features/claude-code/hooks/loader.js";
import {
  getClaudeSettingsFile,
  getClaudeSkillsDir,
} from "@/cli/features/claude-code/paths.js";
import { statuslineLoader } from "@/cli/features/claude-code/statusline/loader.js";
import { getNoriSkillsetsDir } from "@/cli/features/paths.js";
import { getHomeDir } from "@/utils/home.js";

import type { Config } from "@/cli/config.js";
import type { AgentConfig } from "@/cli/features/agentRegistry.js";

/**
 * Configure permissions for Claude Code settings.json
 * Adds skills directory and profiles directory to additionalDirectories
 * @param args - Configuration arguments
 * @param args.config - The Nori configuration
 * @param args.installDir - The installation directory
 */
const configureClaudePermissions = async (args: {
  config: Config;
  installDir: string;
}): Promise<void> => {
  const { installDir } = args;

  const claudeSettingsFile = getClaudeSettingsFile({ installDir });
  const claudeSkillsDir = getClaudeSkillsDir({ installDir });
  const noriProfilesDir = getNoriSkillsetsDir();

  // Create .claude directory if it doesn't exist
  await fs.mkdir(path.dirname(claudeSettingsFile), { recursive: true });

  // Read or initialize settings
  let settings: any = {};
  try {
    const content = await fs.readFile(claudeSettingsFile, "utf-8");
    settings = JSON.parse(content);
  } catch {
    settings = {
      $schema: "https://json.schemastore.org/claude-code-settings.json",
    };
  }

  if (settings.permissions == null) {
    settings.permissions = {};
  }

  if (settings.permissions.additionalDirectories == null) {
    settings.permissions.additionalDirectories = [];
  }

  // Add skills directory if not already present
  if (!settings.permissions.additionalDirectories.includes(claudeSkillsDir)) {
    settings.permissions.additionalDirectories.push(claudeSkillsDir);
  }

  // Add profiles directory if not already present
  if (!settings.permissions.additionalDirectories.includes(noriProfilesDir)) {
    settings.permissions.additionalDirectories.push(noriProfilesDir);
  }

  // Write back to file
  await fs.writeFile(claudeSettingsFile, JSON.stringify(settings, null, 2));
};

export const claudeCodeConfig: AgentConfig = {
  name: "claude-code",
  displayName: "Claude Code",
  description:
    "Instructions, skills, subagents, commands, hooks, statusline, watch",

  agentDirName: ".claude",
  instructionFilePath: "CLAUDE.md",
  configFileName: "CLAUDE.md",
  skillsPath: "skills",
  slashcommandsPath: "commands",
  subagentsPath: "agents",

  extraLoaders: [hooksLoader, statuslineLoader, announcementsLoader],
  extraManagedFiles: ["settings.json", "nori-statusline.sh"],
  get transcriptDirectory() {
    return path.join(getHomeDir(), ".claude", "projects");
  },
  hasLegacyManifest: true,

  configurePermissions: configureClaudePermissions,

  findArtifacts: findClaudeCodeArtifacts,
  factoryReset: factoryResetClaudeCode,

  legacyMarkerDetection: (args: { agentDir: string }): boolean => {
    const claudeMdPath = path.join(args.agentDir, "CLAUDE.md");
    if (fsSync.existsSync(claudeMdPath)) {
      try {
        const content = fsSync.readFileSync(claudeMdPath, "utf-8");
        if (content.includes("NORI-AI MANAGED BLOCK")) {
          return true;
        }
      } catch {
        // Ignore read errors
      }
    }
    return false;
  },
};
