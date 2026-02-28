/**
 * Claude Code agent implementation
 * Implements the Agent interface for Claude Code
 */

import * as fsSync from "fs";
import * as fs from "fs/promises";
import * as path from "path";

import { log, note } from "@clack/prompts";

import { getActiveSkillset, type Config } from "@/cli/config.js";
import { announcementsLoader } from "@/cli/features/claude-code/announcements/loader.js";
import {
  detectExistingConfig,
  captureExistingConfigAsSkillset,
} from "@/cli/features/claude-code/existingConfigCapture.js";
import {
  factoryResetClaudeCode,
  findClaudeCodeArtifacts,
} from "@/cli/features/claude-code/factoryReset.js";
import { hooksLoader } from "@/cli/features/claude-code/hooks/loader.js";
import { LoaderRegistry } from "@/cli/features/claude-code/loaderRegistry.js";
import { getClaudeMdFile } from "@/cli/features/claude-code/paths.js";
import { permissionsLoader } from "@/cli/features/claude-code/permissionsLoader.js";
import { claudeMdLoader } from "@/cli/features/claude-code/skillsets/claudemd/loader.js";
import { statuslineLoader } from "@/cli/features/claude-code/statusline/loader.js";
import { configLoader } from "@/cli/features/config/loader.js";
import { MANIFEST_FILE } from "@/cli/features/managedFolder.js";
import {
  readManifest,
  compareManifest,
  hasChanges,
  computeDirectoryManifest,
  writeManifest,
  getManifestPath,
  getLegacyManifestPath,
  removeManagedFiles,
} from "@/cli/features/manifest.js";
import { getNoriSkillsetsDir } from "@/cli/features/paths.js";
import { createInstructionsLoader } from "@/cli/features/shared/instructionsLoader.js";
import { skillsLoader } from "@/cli/features/shared/skillsLoader.js";
import { createSlashCommandsLoader } from "@/cli/features/shared/slashCommandsLoader.js";
import { createSubagentsLoader } from "@/cli/features/shared/subagentsLoader.js";
import { parseSkillset } from "@/cli/features/skillset.js";
import { ensureNoriJson } from "@/cli/features/skillsetMetadata.js";
import { bold } from "@/cli/logger.js";
import { getHomeDir } from "@/utils/home.js";

import type {
  Agent,
  AgentConfig,
  AgentLoader,
  Loader,
} from "@/cli/features/agentRegistry.js";

/** The root config filename for Claude Code skillsets */
const CONFIG_FILE_NAME = "CLAUDE.md";

/**
 * Claude Code agent implementation
 */
export const claudeCodeAgent: Agent = {
  name: "claude-code",
  displayName: "Claude Code",
  description:
    "Instructions, skills, subagents, commands, hooks, statusline, watch",

  getAgentDir: (args: { installDir: string }): string => {
    const { installDir } = args;
    return path.join(installDir, ".claude");
  },

  getSkillsDir: (args: { installDir: string }): string => {
    const { installDir } = args;
    return path.join(installDir, ".claude", "skills");
  },

  getManagedFiles: () => ["CLAUDE.md", "settings.json", "nori-statusline.sh"],
  getManagedDirs: () => ["skills", "commands", "agents"],

  getLoaderRegistry: () => {
    return LoaderRegistry.getInstance();
  },

  getTranscriptDirectory: (): string => {
    return path.join(getHomeDir(), ".claude", "projects");
  },

  findArtifacts: findClaudeCodeArtifacts,

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
    const skillset = await parseSkillset({
      skillsetName,
      configFileName: CONFIG_FILE_NAME,
    });
    await claudeMdLoader.install({ config, skillset });
  },

  detectLocalChanges: async (args: { installDir: string }) => {
    const { installDir } = args;

    const manifestPath = getManifestPath({ agentName: "claude-code" });
    const legacyManifestPath = getLegacyManifestPath();
    const manifest = await readManifest({ manifestPath, legacyManifestPath });

    if (manifest == null) {
      return null;
    }

    const agentDir = path.join(installDir, ".claude");
    const diff = await compareManifest({
      manifest,
      currentDir: agentDir,
      managedFiles: claudeCodeAgent.getManagedFiles(),
      managedDirs: claudeCodeAgent.getManagedDirs(),
    });

    return hasChanges(diff) ? diff : null;
  },

  removeSkillset: async (args: { installDir: string }) => {
    const { installDir } = args;
    const agentDir = path.join(installDir, ".claude");
    const manifestPath = getManifestPath({ agentName: "claude-code" });

    await removeManagedFiles({
      agentDir,
      manifestPath,
      managedDirs: claudeCodeAgent.getManagedDirs(),
    });

    // Also clean up legacy manifest
    const legacyPath = getLegacyManifestPath();
    await removeManagedFiles({
      agentDir,
      manifestPath: legacyPath,
      managedDirs: claudeCodeAgent.getManagedDirs(),
    });
  },

  installSkillset: async (args: {
    config: Config;
    skipManifest?: boolean | null;
  }): Promise<void> => {
    const { config, skipManifest } = args;

    // Run all feature loaders, collecting settings labels
    const registry = claudeCodeAgent.getLoaderRegistry();
    const loaders = registry.getAll();

    const settingsResults: Array<string> = [];

    for (const loader of loaders) {
      const result = await loader.run({ config });
      if (typeof result === "string") {
        settingsResults.push(result);
      }
    }

    if (settingsResults.length > 0) {
      const lines = settingsResults.map((name) => `✓ ${name}`);
      note(lines.join("\n"), "Settings");
    }

    // Write manifest and emit Skills note for the active skillset
    const skillsetName = getActiveSkillset({ config });
    if (skillsetName != null) {
      const agentDir = claudeCodeAgent.getAgentDir({
        installDir: config.installDir,
      });

      if (!skipManifest) {
        const manifestPath = getManifestPath({
          agentName: claudeCodeAgent.name,
        });

        try {
          const manifest = await computeDirectoryManifest({
            dir: agentDir,
            skillsetName,
            managedFiles: claudeCodeAgent.getManagedFiles(),
            managedDirs: claudeCodeAgent.getManagedDirs(),
          });
          await writeManifest({ manifestPath, manifest });
        } catch {
          // Non-fatal — manifest writing failure shouldn't block installation
        }
      }

      // Emit Skills note from the skillset's skills directory
      try {
        const skillset = await parseSkillset({
          skillsetName,
          configFileName: CONFIG_FILE_NAME,
        });
        if (skillset.skillsDir != null) {
          const entries = await fs.readdir(skillset.skillsDir, {
            withFileTypes: true,
          });
          const skillNames = entries
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .sort();
          if (skillNames.length > 0) {
            const skillLines = skillNames.map((name) => `$ ${name}`);
            const summary = bold({
              text: `Registered ${skillNames.length} agent skill${skillNames.length === 1 ? "" : "s"}`,
            });
            skillLines.push("", summary);
            note(skillLines.join("\n"), "Skills");
          }
        }
      } catch {
        // Non-fatal — skill listing failure shouldn't block installation
      }
    }

    // Mark install directory
    claudeCodeAgent.markInstall({
      path: config.installDir,
      skillsetName,
    });
  },

  switchSkillset: async (args: {
    installDir: string;
    skillsetName: string;
  }): Promise<void> => {
    const { skillsetName } = args;
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

    log.success(`Switched to "${skillsetName}" profile for Claude Code`);
  },
};

/**
 * Wrap a legacy Loader (takes { config }) into an AgentLoader (takes { agent, config, skillset })
 * @param args - Wrapper arguments
 * @param args.loader - The legacy Loader to wrap
 * @param args.managedFiles - Files this loader manages
 * @param args.managedDirs - Directories this loader manages
 *
 * @returns An AgentLoader that delegates to the legacy loader
 */
const wrapLegacyLoader = (args: {
  loader: Loader;
  managedFiles?: ReadonlyArray<string> | null;
  managedDirs?: ReadonlyArray<string> | null;
}): AgentLoader => {
  const { loader, managedFiles, managedDirs } = args;
  return {
    name: loader.name,
    description: loader.description,
    managedFiles: managedFiles ?? undefined,
    managedDirs: managedDirs ?? undefined,
    run: async ({ config }) => loader.run({ config }),
  };
};

/**
 * Data-oriented Claude Code agent configuration
 */
export const claudeCodeAgentConfig: AgentConfig = {
  name: "claude-code",
  displayName: "Claude Code",
  description:
    "Instructions, skills, subagents, commands, hooks, statusline, watch",

  getAgentDir: ({ installDir }) => path.join(installDir, ".claude"),
  getSkillsDir: ({ installDir }) => path.join(installDir, ".claude", "skills"),
  getSubagentsDir: ({ installDir }) =>
    path.join(installDir, ".claude", "agents"),
  getSlashcommandsDir: ({ installDir }) =>
    path.join(installDir, ".claude", "commands"),
  getInstructionsFilePath: ({ installDir }) =>
    path.join(installDir, ".claude", "CLAUDE.md"),

  getLoaders: () => [
    wrapLegacyLoader({ loader: configLoader }),
    permissionsLoader,
    skillsLoader,
    createInstructionsLoader({ managedFiles: ["CLAUDE.md"] }),
    createSlashCommandsLoader({ managedDirs: ["commands"] }),
    createSubagentsLoader({ managedDirs: ["agents"] }),
    wrapLegacyLoader({
      loader: hooksLoader,
      managedFiles: ["settings.json"],
    }),
    wrapLegacyLoader({
      loader: statuslineLoader,
      managedFiles: ["nori-statusline.sh", "settings.json"],
    }),
    wrapLegacyLoader({
      loader: announcementsLoader,
      managedFiles: ["settings.json"],
    }),
  ],

  getTranscriptDirectory: () => path.join(getHomeDir(), ".claude", "projects"),
  getArtifactPatterns: () => ({
    dirs: [".claude"],
    files: ["CLAUDE.md"],
  }),
};
