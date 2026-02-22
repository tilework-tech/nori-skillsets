/**
 * Claude Code agent implementation
 * Implements the Agent interface for Claude Code
 */

import * as fsSync from "fs";
import * as fs from "fs/promises";
import * as path from "path";

import { log, note } from "@clack/prompts";

import {
  loadConfig,
  saveConfig,
  getActiveSkillset,
  type Config,
} from "@/cli/config.js";
import {
  detectExistingConfig,
  captureExistingConfigAsSkillset,
} from "@/cli/features/claude-code/existingConfigCapture.js";
import {
  factoryResetClaudeCode,
  findClaudeCodeArtifacts,
} from "@/cli/features/claude-code/factoryReset.js";
import { LoaderRegistry } from "@/cli/features/claude-code/loaderRegistry.js";
import { getClaudeMdFile } from "@/cli/features/claude-code/paths.js";
import { claudeMdLoader } from "@/cli/features/claude-code/skillsets/claudemd/loader.js";
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
import { parseSkillset } from "@/cli/features/skillset.js";
import { ensureNoriJson } from "@/cli/features/skillsetMetadata.js";
import { getHomeDir } from "@/utils/home.js";

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

  getConfigFileName: () => "CLAUDE.md",

  getSkillsDir: (args: { installDir: string }): string => {
    const { installDir } = args;
    return path.join(installDir, ".claude", "skills");
  },

  getManagedFiles: () => ["CLAUDE.md", "settings.json", "nori-statusline.sh"],
  getManagedDirs: () => ["skills", "commands", "agents"],

  getLoaderRegistry: () => {
    return LoaderRegistry.getInstance();
  },

  getSkillDiscoveryDirs: (): ReadonlyArray<string> => {
    return [path.join(".claude", "skills")];
  },

  getProjectDirName: (args: { cwd: string }): string => {
    const { cwd } = args;

    // Resolve symlinks to match Claude Code's behavior
    let resolvedPath: string;
    try {
      resolvedPath = fsSync.realpathSync(cwd);
    } catch {
      // If path doesn't exist, use it as-is
      resolvedPath = cwd;
    }

    // Replace anything that's not alphanumeric or dash with a dash
    let projectDirName = resolvedPath.replace(/[^a-zA-Z0-9-]/g, "-");

    // Ensure leading dash if not already there
    if (!projectDirName.startsWith("-")) {
      projectDirName = "-" + projectDirName;
    }

    return projectDirName;
  },

  getProjectsDir: (): string => {
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
      configFileName: claudeCodeAgent.getConfigFileName(),
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
    await removeManagedFiles({ agentDir, manifestPath: legacyPath });
  },

  installSkillset: async (args: { config: Config }): Promise<void> => {
    const { config } = args;

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

    // Write manifest for the active skillset
    const skillsetName = getActiveSkillset({ config });
    if (skillsetName != null) {
      const agentDir = claudeCodeAgent.getAgentDir({
        installDir: config.installDir,
      });
      const manifestPath = getManifestPath({ agentName: claudeCodeAgent.name });

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

    // Load current config
    const currentConfig = await loadConfig();

    // Preserve the persisted installDir from config (or default to home dir).
    // The installDir argument is a per-invocation override (e.g. --install-dir flag)
    // and should not be written to the config file.
    const persistedInstallDir = currentConfig?.installDir ?? getHomeDir();

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
      installDir: persistedInstallDir,
    });

    log.success(`Switched to "${skillsetName}" profile for Claude Code`);
  },
};
