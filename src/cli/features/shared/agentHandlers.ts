/**
 * Shared agent handler functions
 * Standalone functions that accept AgentConfig and replace per-agent method implementations
 */

import * as fsSync from "fs";
import * as fs from "fs/promises";
import * as path from "path";

import { log, note } from "@clack/prompts";

import { getActiveSkillset, type Config } from "@/cli/config.js";
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
import { installProfiles } from "@/cli/features/shared/profileLoaders/profilesLoader.js";
import { parseSkillset } from "@/cli/features/skillset.js";
import { ensureNoriJson } from "@/cli/features/skillsetMetadata.js";
import { bold } from "@/cli/logger.js";

import type {
  AgentConfig,
  ExistingConfig,
} from "@/cli/features/agentRegistry.js";
import type { ManifestDiff } from "@/cli/features/manifest.js";

/**
 * Get the agent's config directory under the install directory
 * @param args - Handler arguments
 * @param args.agentConfig - The agent configuration
 * @param args.installDir - The installation directory
 *
 * @returns Absolute path to the agent's config directory
 */
export const getAgentDir = (args: {
  agentConfig: AgentConfig;
  installDir: string;
}): string => {
  const { agentConfig, installDir } = args;
  return path.join(installDir, agentConfig.agentDirName);
};

/**
 * Get the agent's skills directory under the install directory
 * @param args - Handler arguments
 * @param args.agentConfig - The agent configuration
 * @param args.installDir - The installation directory
 *
 * @returns Absolute path to the agent's skills directory
 */
export const getSkillsDir = (args: {
  agentConfig: AgentConfig;
  installDir: string;
}): string => {
  const { agentConfig, installDir } = args;
  return path.join(
    installDir,
    agentConfig.agentDirName,
    agentConfig.skillsPath,
  );
};

/**
 * Get the root-level filenames this agent manages
 * @param args - Handler arguments
 * @param args.agentConfig - The agent configuration
 *
 * @returns Array of managed file basenames
 */
export const getManagedFiles = (args: {
  agentConfig: AgentConfig;
}): ReadonlyArray<string> => {
  const { agentConfig } = args;
  const instructionBasename = path.basename(agentConfig.instructionFilePath);
  const files: Array<string> = [instructionBasename];
  if (agentConfig.extraManagedFiles != null) {
    files.push(...agentConfig.extraManagedFiles);
  }
  return files;
};

/**
 * Get the directory names this agent manages recursively
 * @param args - Handler arguments
 * @param args.agentConfig - The agent configuration
 *
 * @returns Array of managed directory names
 */
export const getManagedDirs = (args: {
  agentConfig: AgentConfig;
}): ReadonlyArray<string> => {
  const { agentConfig } = args;
  const dirs: Array<string> = [
    agentConfig.skillsPath,
    agentConfig.slashcommandsPath,
    agentConfig.subagentsPath,
  ];
  if (agentConfig.extraManagedDirs != null) {
    dirs.push(...agentConfig.extraManagedDirs);
  }
  return dirs;
};

/**
 * Check if this agent is installed at the given directory
 * @param args - Handler arguments
 * @param args.agentConfig - The agent configuration
 * @param args.path - The directory to check
 *
 * @returns True if the agent is installed at the directory
 */
export const isInstalledAtDir = (args: {
  agentConfig: AgentConfig;
  path: string;
}): boolean => {
  const { agentConfig } = args;
  const agentDir = path.join(args.path, agentConfig.agentDirName);

  // Check for .nori-managed marker file
  const markerPath = path.join(agentDir, ".nori-managed");
  if (fsSync.existsSync(markerPath)) {
    return true;
  }

  // Check legacy marker detection if available
  if (agentConfig.legacyMarkerDetection != null) {
    return agentConfig.legacyMarkerDetection({ agentDir });
  }

  return false;
};

/**
 * Mark a directory as having this agent installed
 * @param args - Handler arguments
 * @param args.agentConfig - The agent configuration
 * @param args.path - The directory to mark
 * @param args.skillsetName - Optional skillset name to write in the marker
 */
export const markInstall = (args: {
  agentConfig: AgentConfig;
  path: string;
  skillsetName?: string | null;
}): void => {
  const { agentConfig } = args;
  const agentDir = path.join(args.path, agentConfig.agentDirName);
  fsSync.mkdirSync(agentDir, { recursive: true });
  const markerPath = path.join(agentDir, ".nori-managed");
  fsSync.writeFileSync(markerPath, args.skillsetName ?? "", "utf-8");
};

/**
 * Detect local changes to installed files by comparing against the stored manifest
 * @param args - Handler arguments
 * @param args.agentConfig - The agent configuration
 * @param args.installDir - The installation directory
 *
 * @returns The diff if changes were detected, or null if no changes
 */
export const detectLocalChanges = async (args: {
  agentConfig: AgentConfig;
  installDir: string;
}): Promise<ManifestDiff | null> => {
  const { agentConfig, installDir } = args;

  const manifestPath = getManifestPath({ agentName: agentConfig.name });
  const legacyManifestPath = agentConfig.hasLegacyManifest
    ? getLegacyManifestPath()
    : undefined;
  const manifest = await readManifest({ manifestPath, legacyManifestPath });

  if (manifest == null) {
    return null;
  }

  const agentDir = path.join(installDir, agentConfig.agentDirName);
  const diff = await compareManifest({
    manifest,
    currentDir: agentDir,
    managedFiles: getManagedFiles({ agentConfig }),
    managedDirs: getManagedDirs({ agentConfig }),
  });

  return hasChanges(diff) ? diff : null;
};

/**
 * Remove all Nori-managed files for this agent at the given directory
 * @param args - Handler arguments
 * @param args.agentConfig - The agent configuration
 * @param args.installDir - The installation directory
 */
export const removeSkillset = async (args: {
  agentConfig: AgentConfig;
  installDir: string;
}): Promise<void> => {
  const { agentConfig, installDir } = args;
  const agentDir = path.join(installDir, agentConfig.agentDirName);
  const manifestPath = getManifestPath({ agentName: agentConfig.name });
  const managedDirs = getManagedDirs({ agentConfig });

  await removeManagedFiles({
    agentDir,
    manifestPath,
    managedDirs,
  });

  // Also clean up legacy manifest if applicable
  if (agentConfig.hasLegacyManifest) {
    const legacyPath = getLegacyManifestPath();
    await removeManagedFiles({
      agentDir,
      manifestPath: legacyPath,
      managedDirs,
    });
  }
};

/**
 * Install a skillset: run feature loaders, write manifest, and mark install
 * @param args - Handler arguments
 * @param args.agentConfig - The agent configuration
 * @param args.config - The Nori configuration
 * @param args.skipManifest - Whether to skip manifest read/write operations
 */
export const installSkillset = async (args: {
  agentConfig: AgentConfig;
  config: Config;
  skipManifest?: boolean | null;
}): Promise<void> => {
  const { agentConfig, config, skipManifest } = args;

  // Run config loader first
  const settingsResults: Array<string> = [];
  const configResult = await configLoader.run({ config });
  if (typeof configResult === "string") {
    settingsResults.push(configResult);
  }

  // Run shared profiles loader
  await installProfiles({ agentConfig, config });

  // Run agent-specific extra loaders (hooks, statusline, announcements)
  if (agentConfig.extraLoaders != null) {
    for (const loader of agentConfig.extraLoaders) {
      const result = await loader.run({ config });
      if (typeof result === "string") {
        settingsResults.push(result);
      }
    }
  }

  if (settingsResults.length > 0) {
    const lines = settingsResults.map((name) => `✓ ${name}`);
    note(lines.join("\n"), `${agentConfig.displayName} Settings`);
  }

  // Write manifest and emit Skills note for the active skillset
  const skillsetName = getActiveSkillset({ config });
  if (skillsetName != null) {
    const agentDir = getAgentDir({
      agentConfig,
      installDir: config.installDir,
    });

    if (!skipManifest) {
      const manifestPath = getManifestPath({ agentName: agentConfig.name });

      try {
        const manifest = await computeDirectoryManifest({
          dir: agentDir,
          skillsetName,
          managedFiles: getManagedFiles({ agentConfig }),
          managedDirs: getManagedDirs({ agentConfig }),
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
        configFileName: agentConfig.configFileName,
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
          const agentLabel =
            agentConfig.name === "claude-code"
              ? ""
              : ` ${agentConfig.displayName}`;
          const summary = bold({
            text: `Registered ${skillNames.length}${agentLabel} skill${skillNames.length === 1 ? "" : "s"}`,
          });
          skillLines.push("", summary);
          note(
            skillLines.join("\n"),
            `${agentConfig.displayName === "Claude Code" ? "" : `${agentConfig.displayName} `}Skills`,
          );
        }
      }
    } catch {
      // Non-fatal — skill listing failure shouldn't block installation
    }
  }

  // Mark install directory
  markInstall({
    agentConfig,
    path: config.installDir,
    skillsetName,
  });
};

/**
 * Switch to a skillset (validates and updates config)
 * @param args - Handler arguments
 * @param args.agentConfig - The agent configuration
 * @param args.installDir - The installation directory
 * @param args.skillsetName - The skillset to switch to
 */
export const switchSkillset = async (args: {
  agentConfig: AgentConfig;
  installDir: string;
  skillsetName: string;
}): Promise<void> => {
  const { agentConfig, skillsetName } = args;
  const skillsetsDir = getNoriSkillsetsDir();

  // Verify profile exists
  const skillsetDir = path.join(skillsetsDir, skillsetName);
  await ensureNoriJson({ skillsetDir });
  const manifestPath = path.join(skillsetDir, MANIFEST_FILE);

  try {
    await fs.access(manifestPath);
  } catch {
    throw new Error(`Profile "${skillsetName}" not found in ${skillsetsDir}`);
  }

  log.success(
    `Switched to "${skillsetName}" profile for ${agentConfig.displayName}`,
  );
};

/**
 * Detect pre-existing unmanaged configuration at the given directory
 * @param args - Handler arguments
 * @param args.agentConfig - The agent configuration
 * @param args.installDir - The installation directory
 *
 * @returns Detected config details or null if none found
 */
export const detectExistingConfig = async (args: {
  agentConfig: AgentConfig;
  installDir: string;
}): Promise<ExistingConfig | null> => {
  const { agentConfig, installDir } = args;
  const agentDir = path.join(installDir, agentConfig.agentDirName);

  // Check if agent directory exists
  try {
    await fs.access(agentDir);
  } catch {
    return null;
  }

  const instructionFile = path.join(agentDir, agentConfig.instructionFilePath);
  const skillsDir = path.join(agentDir, agentConfig.skillsPath);
  const agentsDir = path.join(agentDir, agentConfig.subagentsPath);
  const commandsDir = path.join(agentDir, agentConfig.slashcommandsPath);

  // Check instruction file
  let hasConfigFile = false;
  let hasManagedBlock = false;

  try {
    await fs.access(instructionFile);
    hasConfigFile = true;
    const content = await fs.readFile(instructionFile, "utf-8");
    hasManagedBlock = content.includes("# BEGIN NORI-AI MANAGED BLOCK");
  } catch {
    // File doesn't exist or can't be read
  }

  // Count skills (directories containing SKILL.md)
  let skillCount = 0;
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          await fs.access(path.join(skillsDir, entry.name, "SKILL.md"));
          skillCount++;
        } catch {
          // No SKILL.md in this directory
        }
      }
    }
  } catch {
    // Skills directory doesn't exist
  }

  // Count .md files in agents directory
  let agentCount = 0;
  try {
    const entries = await fs.readdir(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        agentCount++;
      }
    }
  } catch {
    // Agents directory doesn't exist
  }

  // Count .md files in commands directory
  let commandCount = 0;
  try {
    const entries = await fs.readdir(commandsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        commandCount++;
      }
    }
  } catch {
    // Commands directory doesn't exist
  }

  const hasSkills = skillCount > 0;
  const hasAgents = agentCount > 0;
  const hasCommands = commandCount > 0;

  // Return null if nothing was found
  if (!hasConfigFile && !hasSkills && !hasAgents && !hasCommands) {
    return null;
  }

  return {
    configFileName: path.basename(agentConfig.instructionFilePath),
    hasConfigFile,
    hasManagedBlock,
    hasSkills,
    skillCount,
    hasAgents,
    agentCount,
    hasCommands,
    commandCount,
  };
};

/**
 * Capture existing config as a named skillset, clean up originals, and restore working state
 * @param args - Handler arguments
 * @param args.agentConfig - The agent configuration
 * @param args.installDir - The installation directory
 * @param args.skillsetName - The name for the captured skillset
 * @param args.config - The Nori configuration
 */
export const captureExistingConfig = async (args: {
  agentConfig: AgentConfig;
  installDir: string;
  skillsetName: string;
  config: Config;
}): Promise<void> => {
  const { agentConfig, installDir, skillsetName, config } = args;

  const agentDir = path.join(installDir, agentConfig.agentDirName);
  const skillsetsDir = getNoriSkillsetsDir();
  const skillsetDir = path.join(skillsetsDir, skillsetName);

  // Create skillset directory
  await fs.mkdir(skillsetDir, { recursive: true });

  const skillsDir = path.join(agentDir, agentConfig.skillsPath);
  const agentsDir = path.join(agentDir, agentConfig.subagentsPath);
  const commandsDir = path.join(agentDir, agentConfig.slashcommandsPath);
  const instructionFile = path.join(agentDir, agentConfig.instructionFilePath);

  // Get skill names for nori.json
  const skillNames: Array<string> = [];
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          await fs.access(path.join(skillsDir, entry.name, "SKILL.md"));
          skillNames.push(entry.name);
        } catch {
          // No SKILL.md
        }
      }
    }
  } catch {
    // Skills directory doesn't exist
  }

  // Create nori.json
  const skillsMap: Record<string, string> = {};
  for (const name of skillNames) {
    skillsMap[name] = "*";
  }

  const noriJson = {
    name: skillsetName,
    version: "1.0.0",
    type: "skillset",
    description: "Captured from existing configuration",
    dependencies: {
      skills: skillsMap,
    },
  };
  await fs.writeFile(
    path.join(skillsetDir, "nori.json"),
    JSON.stringify(noriJson, null, 2),
  );

  // Copy instruction file with managed block markers
  const BEGIN_MARKER = "# BEGIN NORI-AI MANAGED BLOCK";
  const END_MARKER = "# END NORI-AI MANAGED BLOCK";

  try {
    let content = await fs.readFile(instructionFile, "utf-8");
    if (!content.includes(BEGIN_MARKER)) {
      content = `${BEGIN_MARKER}\n${content}\n${END_MARKER}\n`;
    }
    await fs.writeFile(
      path.join(skillsetDir, agentConfig.configFileName),
      content,
    );
  } catch {
    // Instruction file doesn't exist — create empty
    await fs.writeFile(
      path.join(skillsetDir, agentConfig.configFileName),
      `${BEGIN_MARKER}\n\n${END_MARKER}\n`,
    );
  }

  // Copy skills directory
  try {
    await fs.access(skillsDir);
    await fs.cp(skillsDir, path.join(skillsetDir, "skills"), {
      recursive: true,
    });
  } catch {
    // Skills directory doesn't exist
  }

  // Copy agents directory as subagents
  try {
    await fs.access(agentsDir);
    await fs.cp(agentsDir, path.join(skillsetDir, "subagents"), {
      recursive: true,
    });
  } catch {
    // Agents directory doesn't exist
  }

  // Copy commands directory as slashcommands
  try {
    await fs.access(commandsDir);
    await fs.cp(commandsDir, path.join(skillsetDir, "slashcommands"), {
      recursive: true,
    });
  } catch {
    // Commands directory doesn't exist
  }

  // Clear original instruction file to prevent content duplication
  try {
    await fs.unlink(instructionFile);
  } catch {
    // File may not exist, which is fine
  }

  // Install the managed instruction file block so the user isn't left without config
  const { installInstructionsMd } =
    await import("@/cli/features/shared/profileLoaders/instructionsMdLoader.js");
  const skillset = await parseSkillset({
    skillsetName,
    configFileName: agentConfig.configFileName,
  });
  await installInstructionsMd({ agentConfig, config, skillset });
};
