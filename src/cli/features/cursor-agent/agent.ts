/**
 * Cursor agent implementation
 * Implements the Agent interface for Cursor IDE
 */

import * as fsSync from "fs";
import * as fs from "fs/promises";
import * as path from "path";

import { log, note } from "@clack/prompts";

import { updateConfig, getActiveSkillset, type Config } from "@/cli/config.js";
import { CursorLoaderRegistry } from "@/cli/features/cursor-agent/loaderRegistry.js";
import { MANIFEST_FILE } from "@/cli/features/managedFolder.js";
import {
  readManifest,
  compareManifest,
  hasChanges,
  computeDirectoryManifest,
  writeManifest,
  getManifestPath,
  removeManagedFiles,
} from "@/cli/features/manifest.js";
import { getNoriSkillsetsDir } from "@/cli/features/paths.js";
import { parseSkillset } from "@/cli/features/skillset.js";
import { ensureNoriJson } from "@/cli/features/skillsetMetadata.js";
import { bold } from "@/cli/logger.js";

import type { Agent } from "@/cli/features/agentRegistry.js";

/** The root config filename for Cursor skillsets */
const CONFIG_FILE_NAME = "AGENTS.md";

/**
 * Cursor agent implementation
 */
export const cursorAgent: Agent = {
  name: "cursor-agent",
  displayName: "Cursor",
  description: "Instructions, skills, subagents, commands",

  getAgentDir: (args: { installDir: string }): string => {
    const { installDir } = args;
    return path.join(installDir, ".cursor");
  },

  getSkillsDir: (args: { installDir: string }): string => {
    const { installDir } = args;
    return path.join(installDir, ".cursor", "skills");
  },

  getManagedFiles: () => [],
  getManagedDirs: () => ["skills", "commands", "agents", "rules"],

  getLoaderRegistry: () => {
    return CursorLoaderRegistry.getInstance();
  },

  isInstalledAtDir: (args: { path: string }): boolean => {
    const cursorDir = path.join(args.path, ".cursor");

    // Check for .nori-managed marker file
    const markerPath = path.join(cursorDir, ".nori-managed");
    if (fsSync.existsSync(markerPath)) {
      return true;
    }

    return false;
  },

  markInstall: (args: { path: string; skillsetName?: string | null }): void => {
    const cursorDir = path.join(args.path, ".cursor");
    fsSync.mkdirSync(cursorDir, { recursive: true });
    const markerPath = path.join(cursorDir, ".nori-managed");
    fsSync.writeFileSync(markerPath, args.skillsetName ?? "", "utf-8");
  },

  detectLocalChanges: async (args: { installDir: string }) => {
    const { installDir } = args;

    const manifestPath = getManifestPath({ agentName: "cursor-agent" });
    const manifest = await readManifest({ manifestPath });

    if (manifest == null) {
      return null;
    }

    const agentDir = path.join(installDir, ".cursor");
    const diff = await compareManifest({
      manifest,
      currentDir: agentDir,
      managedFiles: cursorAgent.getManagedFiles(),
      managedDirs: cursorAgent.getManagedDirs(),
    });

    return hasChanges(diff) ? diff : null;
  },

  removeSkillset: async (args: { installDir: string }) => {
    const { installDir } = args;
    const agentDir = path.join(installDir, ".cursor");
    const manifestPath = getManifestPath({ agentName: "cursor-agent" });

    await removeManagedFiles({
      agentDir,
      manifestPath,
      managedDirs: cursorAgent.getManagedDirs(),
    });
  },

  installSkillset: async (args: {
    config: Config;
    skipManifest?: boolean | null;
  }): Promise<void> => {
    const { config, skipManifest } = args;

    // Run all feature loaders, collecting settings labels
    const registry = cursorAgent.getLoaderRegistry();
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
      note(lines.join("\n"), "Cursor Settings");
    }

    // Write manifest and emit Skills note for the active skillset
    const skillsetName = getActiveSkillset({ config });
    if (skillsetName != null) {
      const agentDir = cursorAgent.getAgentDir({
        installDir: config.installDir,
      });

      if (!skipManifest) {
        const manifestPath = getManifestPath({ agentName: cursorAgent.name });

        try {
          const manifest = await computeDirectoryManifest({
            dir: agentDir,
            skillsetName,
            managedFiles: cursorAgent.getManagedFiles(),
            managedDirs: cursorAgent.getManagedDirs(),
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
              text: `Registered ${skillNames.length} Cursor skill${skillNames.length === 1 ? "" : "s"}`,
            });
            skillLines.push("", summary);
            note(skillLines.join("\n"), "Cursor Skills");
          }
        }
      } catch {
        // Non-fatal — skill listing failure shouldn't block installation
      }
    }

    // Mark install directory
    cursorAgent.markInstall({
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

    // Verify skillset exists
    const skillsetDir = path.join(skillsetsDir, skillsetName);
    await ensureNoriJson({ skillsetDir });
    const instructionsPath = path.join(skillsetDir, MANIFEST_FILE);

    try {
      await fs.access(instructionsPath);
    } catch {
      throw new Error(`Profile "${skillsetName}" not found in ${skillsetsDir}`);
    }

    await updateConfig({ activeSkillset: skillsetName });

    log.success(`Switched to "${skillsetName}" profile for Cursor`);
  },
};
