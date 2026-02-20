/**
 * Claude Code agent implementation
 * Implements the Agent interface for Claude Code
 */

import * as fsSync from "fs";
import * as fs from "fs/promises";
import * as path from "path";

import { loadConfig, saveConfig, type Config } from "@/cli/config.js";
import {
  detectExistingConfig,
  captureExistingConfigAsSkillset,
} from "@/cli/features/claude-code/existingConfigCapture.js";
import { factoryResetClaudeCode } from "@/cli/features/claude-code/factoryReset.js";
import { LoaderRegistry } from "@/cli/features/claude-code/loaderRegistry.js";
import { getClaudeMdFile } from "@/cli/features/claude-code/paths.js";
import { claudeMdLoader } from "@/cli/features/claude-code/skillsets/claudemd/loader.js";
import { MANIFEST_FILE } from "@/cli/features/managedFolder.js";
import { getNoriSkillsetsDir } from "@/cli/features/paths.js";
import { ensureNoriJson } from "@/cli/features/skillsetMetadata.js";
import { success, info } from "@/cli/logger.js";

import type { Agent } from "@/cli/features/agentRegistry.js";

/**
 * Claude Code agent implementation
 */
export const claudeCodeAgent: Agent = {
  name: "claude-code",
  displayName: "Claude Code",

  getAgentDir: (args: { installDir: string }): string => {
    const { installDir } = args;
    return path.join(installDir, ".claude");
  },

  getManagedFiles: () => ["CLAUDE.md", "settings.json", "nori-statusline.sh"],
  getManagedDirs: () => ["skills", "commands", "agents"],

  getLoaderRegistry: () => {
    return LoaderRegistry.getInstance();
  },

  factoryReset: factoryResetClaudeCode,

  isInstalledAtDir: (args: { path: string }): boolean => {
    const claudeDir = path.join(args.path, ".claude");

    // Check for .nori-managed marker file (new style)
    const markerPath = path.join(claudeDir, ".nori-managed");
    if (fsSync.existsSync(markerPath)) {
      return true;
    }

    // Backwards compatibility: check for NORI-AI MANAGED BLOCK in CLAUDE.md
    const claudeMdPath = path.join(claudeDir, "CLAUDE.md");
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

  markInstall: (args: { path: string; skillsetName?: string | null }): void => {
    const claudeDir = path.join(args.path, ".claude");
    fsSync.mkdirSync(claudeDir, { recursive: true });
    const markerPath = path.join(claudeDir, ".nori-managed");
    fsSync.writeFileSync(markerPath, args.skillsetName ?? "", "utf-8");
  },

  detectExistingConfig: async (args: { installDir: string }) => {
    return detectExistingConfig({ installDir: args.installDir });
  },

  captureExistingConfig: async (args: {
    installDir: string;
    skillsetName: string;
    config: Config;
  }) => {
    const { installDir, skillsetName, config } = args;

    // Capture the existing config as a named profile
    await captureExistingConfigAsSkillset({ installDir, skillsetName });

    // Clear original CLAUDE.md to prevent content duplication
    const claudeMdPath = getClaudeMdFile({ installDir });
    try {
      await fs.unlink(claudeMdPath);
    } catch {
      // File may not exist, which is fine
    }

    // Install the managed CLAUDE.md block so the user isn't left without config
    await claudeMdLoader.install({ config });
  },

  switchSkillset: async (args: {
    installDir: string;
    skillsetName: string;
  }): Promise<void> => {
    const { installDir, skillsetName } = args;
    const skillsetsDir = getNoriSkillsetsDir();

    // Verify profile exists
    // skillsetName can be flat (e.g., "senior-swe") or namespaced (e.g., "myorg/my-profile")
    // path.join handles both cases correctly since it just joins the path components
    const skillsetDir = path.join(skillsetsDir, skillsetName);
    await ensureNoriJson({ skillsetDir });
    const instructionsPath = path.join(skillsetDir, MANIFEST_FILE);

    try {
      await fs.access(instructionsPath);
    } catch {
      throw new Error(`Profile "${skillsetName}" not found in ${skillsetsDir}`);
    }

    // Load current config
    const currentConfig = await loadConfig();

    await saveConfig({
      username: currentConfig?.auth?.username ?? null,
      password: currentConfig?.auth?.password ?? null,
      refreshToken: currentConfig?.auth?.refreshToken ?? null,
      organizationUrl: currentConfig?.auth?.organizationUrl ?? null,
      organizations: currentConfig?.auth?.organizations ?? null,
      isAdmin: currentConfig?.auth?.isAdmin ?? null,
      activeSkillset: skillsetName,
      sendSessionTranscript: currentConfig?.sendSessionTranscript ?? null,
      autoupdate: currentConfig?.autoupdate,
      version: currentConfig?.version ?? null,
      transcriptDestination: currentConfig?.transcriptDestination ?? null,
      installDir,
    });

    success({
      message: `Switched to "${skillsetName}" profile for Claude Code`,
    });
    info({
      message: `Restart Claude Code to load the new profile configuration`,
    });
  },
};
