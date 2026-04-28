/**
 * Shared agent operations
 * Functions parameterized by AgentConfig that replace duplicated agent methods
 */

import * as fsSync from "fs";
import * as fs from "fs/promises";
import * as path from "path";

import { log, note } from "@clack/prompts";

import { getActiveSkillset, type Config } from "@/cli/config.js";
import { checkRequiredEnv } from "@/cli/features/envCheck.js";
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
import { bold } from "@/cli/logger.js";
import { ensureNoriJson } from "@/norijson/nori.js";
import {
  MANIFEST_FILE,
  getNoriSkillsetsDir,
  parseSkillset,
} from "@/norijson/skillset.js";

import type {
  AgentConfig,
  ExistingConfig,
} from "@/cli/features/agentRegistry.js";
import type { ManifestDiff } from "@/cli/features/manifest.js";

// Managed block markers
const BEGIN_MARKER = "# BEGIN NORI-AI MANAGED BLOCK";
const END_MARKER = "# END NORI-AI MANAGED BLOCK";

/**
 * Remove the entire managed block (markers included) from a file in place.
 * Preserves any user content above and below the block. If the file doesn't
 * exist or doesn't contain the block, this is a no-op.
 * @param args - Configuration arguments
 * @param args.filePath - Absolute path to the file to clear
 */
const clearManagedBlock = async (args: { filePath: string }): Promise<void> => {
  const { filePath } = args;
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return;
  }

  if (!content.includes(BEGIN_MARKER)) {
    return;
  }

  const regex = new RegExp(
    `\\n?${BEGIN_MARKER}\\n[\\s\\S]*?\\n${END_MARKER}\\n?`,
    "g",
  );
  const cleared = content.replace(regex, "");
  await fs.writeFile(filePath, cleared);
};

export const getManagedFiles = (args: {
  agent: AgentConfig;
}): ReadonlyArray<string> => {
  const { agent } = args;
  const files = new Set<string>();
  for (const loader of agent.getLoaders()) {
    if (loader.managedFiles != null) {
      for (const file of loader.managedFiles) {
        files.add(file);
      }
    }
  }
  return Array.from(files);
};

export const getManagedDirs = (args: {
  agent: AgentConfig;
}): ReadonlyArray<string> => {
  const { agent } = args;
  const dirs = new Set<string>();
  for (const loader of agent.getLoaders()) {
    if (loader.managedDirs != null) {
      for (const dir of loader.managedDirs) {
        dirs.add(dir);
      }
    }
  }
  return Array.from(dirs);
};

export const isInstalledAtDir = (args: {
  agent: AgentConfig;
  path: string;
}): boolean => {
  const { agent } = args;
  const agentDir = agent.getAgentDir({ installDir: args.path });

  // Check for .nori-managed marker file
  const markerPath = path.join(agentDir, ".nori-managed");
  if (fsSync.existsSync(markerPath)) {
    return true;
  }

  // Backwards compatibility: check for NORI-AI MANAGED BLOCK in instructions file
  const instructionsPath = agent.getInstructionsFilePath({
    installDir: args.path,
  });
  if (fsSync.existsSync(instructionsPath)) {
    try {
      const content = fsSync.readFileSync(instructionsPath, "utf-8");
      if (content.includes("NORI-AI MANAGED BLOCK")) {
        return true;
      }
    } catch {
      // Ignore read errors
    }
  }

  return false;
};

export const markInstall = (args: {
  agent: AgentConfig;
  path: string;
  skillsetName?: string | null;
}): void => {
  const { agent } = args;
  const agentDir = agent.getAgentDir({ installDir: args.path });
  fsSync.mkdirSync(agentDir, { recursive: true });
  const markerPath = path.join(agentDir, ".nori-managed");
  fsSync.writeFileSync(markerPath, args.skillsetName ?? "", "utf-8");
};

export const installSkillset = async (args: {
  agent: AgentConfig;
  config: Config;
  skipManifest?: boolean | null;
}): Promise<void> => {
  const { agent, config, skipManifest } = args;

  // Parse active skillset
  const skillsetName = getActiveSkillset({ config });
  let skillset = null;
  if (skillsetName != null) {
    try {
      skillset = await parseSkillset({ skillsetName });
    } catch {
      // Non-fatal
    }
  }

  // Run all feature loaders, collecting settings labels
  const loaders = agent.getLoaders();
  const settingsResults: Array<string> = [];

  for (const loader of loaders) {
    const result = await loader.run({ agent, config, skillset });
    if (typeof result === "string") {
      settingsResults.push(result);
    }
  }

  if (settingsResults.length > 0) {
    const lines = settingsResults.map((name) => `\u2713 ${name}`);
    note(lines.join("\n"), `${agent.displayName} Settings`);
  }

  // Write manifest and emit Skills note for the active skillset
  if (skillsetName != null && skillset != null) {
    const agentDir = agent.getAgentDir({ installDir: config.installDir });

    if (!skipManifest) {
      const manifestPath = getManifestPath({ agentName: agent.name });

      try {
        const manifest = await computeDirectoryManifest({
          dir: agentDir,
          skillsetName,
          managedFiles: getManagedFiles({ agent }),
          managedDirs: getManagedDirs({ agent }),
        });
        await writeManifest({ manifestPath, manifest });
      } catch {
        // Non-fatal
      }
    }

    // Emit Skills note from the skillset's skills directory
    try {
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
      // Non-fatal
    }

    // Surface missing required environment variables (e.g., for MCP servers)
    const missingEnv = checkRequiredEnv({
      skillset,
      env: process.env,
    });
    if (missingEnv.length > 0) {
      const lines = missingEnv.map((name) => `× ${name}`);
      lines.push(
        "",
        `Set these in your shell profile before launching ${agent.displayName}.`,
      );
      note(lines.join("\n"), "Missing environment variables");
    }
  }
};

export const switchSkillset = async (args: {
  agent: AgentConfig;
  installDir: string;
  skillsetName: string;
}): Promise<void> => {
  const { agent, skillsetName } = args;
  const skillsetsDir = getNoriSkillsetsDir();

  // Verify profile exists
  const skillsetDir = path.join(skillsetsDir, skillsetName);
  await ensureNoriJson({ skillsetDir });
  const instructionsPath = path.join(skillsetDir, MANIFEST_FILE);

  try {
    await fs.access(instructionsPath);
  } catch {
    throw new Error(`Profile "${skillsetName}" not found in ${skillsetsDir}`);
  }

  log.success(`Switched to "${skillsetName}" profile for ${agent.displayName}`);
};

export const removeSkillset = async (args: {
  agent: AgentConfig;
  installDir: string;
}): Promise<void> => {
  const { agent, installDir } = args;
  const agentDir = agent.getAgentDir({ installDir });
  const manifestPath = getManifestPath({ agentName: agent.name });
  const instructionsFilePath = agent.getInstructionsFilePath({ installDir });

  // Always clear the managed block in-place so user-authored content around it
  // is preserved, regardless of whether the file is inside or outside agentDir.
  await clearManagedBlock({ filePath: instructionsFilePath });

  // If the instructions file lives inside agentDir, exclude it from the
  // manifest-based deletion below so the cleared file is preserved.
  const instructionsRelative = path.relative(agentDir, instructionsFilePath);
  const isInsideAgentDir =
    !instructionsRelative.startsWith("..") &&
    !path.isAbsolute(instructionsRelative);
  const excludePaths = isInsideAgentDir ? [instructionsRelative] : [];

  await removeManagedFiles({
    agentDir,
    manifestPath,
    managedDirs: getManagedDirs({ agent }),
    excludePaths,
  });

  // Also clean up legacy manifest for claude-code
  if (agent.name === "claude-code") {
    const legacyPath = getLegacyManifestPath();
    await removeManagedFiles({
      agentDir,
      manifestPath: legacyPath,
      managedDirs: getManagedDirs({ agent }),
      excludePaths,
    });
  }
};

export const detectLocalChanges = async (args: {
  agent: AgentConfig;
  installDir: string;
}): Promise<ManifestDiff | null> => {
  const { agent, installDir } = args;

  const manifestPath = getManifestPath({ agentName: agent.name });
  const legacyManifestPath =
    agent.name === "claude-code" ? getLegacyManifestPath() : null;
  const manifest = await readManifest({
    manifestPath,
    legacyManifestPath,
  });

  if (manifest == null) {
    return null;
  }

  const agentDir = agent.getAgentDir({ installDir });
  const diff = await compareManifest({
    manifest,
    currentDir: agentDir,
    managedFiles: getManagedFiles({ agent }),
    managedDirs: getManagedDirs({ agent }),
  });

  return hasChanges(diff) ? diff : null;
};

export const detectExistingConfig = async (args: {
  agent: AgentConfig;
  installDir: string;
}): Promise<ExistingConfig | null> => {
  const { agent, installDir } = args;

  const agentDir = agent.getAgentDir({ installDir });

  // Check if agent directory exists
  try {
    await fs.access(agentDir);
  } catch {
    return null;
  }

  const instructionsPath = agent.getInstructionsFilePath({ installDir });
  const skillsDir = agent.getSkillsDir({ installDir });
  const subagentsDir = agent.getSubagentsDir({ installDir });
  const slashcommandsDir = agent.getSlashcommandsDir({ installDir });

  // Check instructions file
  let hasConfigFile = false;
  let hasManagedBlock = false;

  try {
    await fs.access(instructionsPath);
    hasConfigFile = true;
    try {
      const content = await fs.readFile(instructionsPath, "utf-8");
      hasManagedBlock = content.includes(BEGIN_MARKER);
    } catch {
      // Ignore read errors
    }
  } catch {
    // File doesn't exist
  }

  // Count skills (directories containing SKILL.md)
  let skillCount = 0;
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
        try {
          await fs.access(skillMdPath);
          skillCount++;
        } catch {
          // No SKILL.md in this directory
        }
      }
    }
  } catch {
    // Skills dir doesn't exist
  }
  const hasSkills = skillCount > 0;

  // Count agents (.md files in subagents dir)
  let agentCount = 0;
  try {
    const entries = await fs.readdir(subagentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        agentCount++;
      }
    }
  } catch {
    // Agents dir doesn't exist
  }
  const hasAgents = agentCount > 0;

  // Count commands (.md files in slashcommands dir)
  let commandCount = 0;
  try {
    const entries = await fs.readdir(slashcommandsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        commandCount++;
      }
    }
  } catch {
    // Commands dir doesn't exist
  }
  const hasCommands = commandCount > 0;

  // Return null if nothing was found
  if (!hasConfigFile && !hasSkills && !hasAgents && !hasCommands) {
    return null;
  }

  return {
    configFileName: path.basename(instructionsPath),
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

export const captureExistingConfig = async (args: {
  agent: AgentConfig;
  installDir: string;
  skillsetName: string;
  config: Config;
}): Promise<void> => {
  const { agent, installDir, skillsetName, config } = args;

  const skillsetsDir = getNoriSkillsetsDir();
  const skillsetDir = path.join(skillsetsDir, skillsetName);

  // Create skillset directory
  await fs.mkdir(skillsetDir, { recursive: true });

  // Get skill names from the source skills directory
  const skillsDir = agent.getSkillsDir({ installDir });
  const skillNames: Array<string> = [];
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
        try {
          await fs.access(skillMdPath);
          skillNames.push(entry.name);
        } catch {
          // No SKILL.md
        }
      }
    }
  } catch {
    // Skills dir doesn't exist
  }

  // Create nori.json with skills map
  const skillsMap: Record<string, string> = {};
  for (const skillName of skillNames) {
    skillsMap[skillName] = "*";
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

  // Copy instructions file to skillset dir as AGENTS.md with managed block markers
  const instructionsPath = agent.getInstructionsFilePath({ installDir });
  try {
    await fs.access(instructionsPath);
    let content = await fs.readFile(instructionsPath, "utf-8");

    // Add managed block markers if not present
    if (!content.includes(BEGIN_MARKER)) {
      content = `${BEGIN_MARKER}\n${content}\n${END_MARKER}\n`;
    }

    await fs.writeFile(path.join(skillsetDir, "AGENTS.md"), content);
  } catch {
    // Create empty AGENTS.md with markers
    await fs.writeFile(
      path.join(skillsetDir, "AGENTS.md"),
      `${BEGIN_MARKER}\n\n${END_MARKER}\n`,
    );
  }

  // Copy skills directory
  try {
    await fs.access(skillsDir);
    const destSkillsDir = path.join(skillsetDir, "skills");
    await fs.cp(skillsDir, destSkillsDir, { recursive: true });
  } catch {
    // Skills dir doesn't exist
  }

  // Copy subagents — if a directory-based subagent already exists in the
  // skillset, update its SUBAGENT.md instead of creating a flat file
  const subagentsDir = agent.getSubagentsDir({ installDir });
  try {
    await fs.access(subagentsDir);
    const destSubagentsDir = path.join(skillsetDir, "subagents");
    await fs.mkdir(destSubagentsDir, { recursive: true });

    const installedEntries = await fs.readdir(subagentsDir, {
      withFileTypes: true,
    });
    for (const entry of installedEntries) {
      if (!entry.isFile()) continue;

      const agentName = entry.name.replace(/\.[^.]+$/, "");
      const existingDirSubagent = path.join(
        destSubagentsDir,
        agentName,
        "SUBAGENT.md",
      );

      let hasDirSubagent = false;
      try {
        await fs.access(existingDirSubagent);
        hasDirSubagent = true;
      } catch {
        // No directory-based subagent exists
      }

      if (hasDirSubagent) {
        // Update SUBAGENT.md in existing directory
        const content = await fs.readFile(
          path.join(subagentsDir, entry.name),
          "utf-8",
        );
        await fs.writeFile(existingDirSubagent, content);
      } else {
        // Copy as flat file
        await fs.cp(
          path.join(subagentsDir, entry.name),
          path.join(destSubagentsDir, entry.name),
        );
      }
    }
  } catch {
    // Subagents dir doesn't exist
  }

  // Copy slashcommands directory
  const slashcommandsDir = agent.getSlashcommandsDir({ installDir });
  try {
    await fs.access(slashcommandsDir);
    const destSlashcommandsDir = path.join(skillsetDir, "slashcommands");
    await fs.cp(slashcommandsDir, destSlashcommandsDir, { recursive: true });
  } catch {
    // Slashcommands dir doesn't exist
  }

  // Delete original instructions file
  try {
    await fs.unlink(instructionsPath);
  } catch {
    // File may not exist
  }

  // Run the shared instructions loader to write fresh managed block
  const skillset = await parseSkillset({ skillsetDir });
  const instructionsLoader = agent
    .getLoaders()
    .find((l) => l.name === "instructions");
  if (instructionsLoader != null) {
    await instructionsLoader.run({ agent, config, skillset });
  }
};

export const findArtifacts = async (args: {
  agent: AgentConfig;
  startDir: string;
  stopDir?: string | null;
}): Promise<
  Array<{
    path: string;
    type: "directory" | "file";
  }>
> => {
  const { agent, startDir, stopDir } = args;

  if (agent.getArtifactPatterns == null) {
    return [];
  }

  const patterns = agent.getArtifactPatterns();
  const artifacts: Array<{ path: string; type: "directory" | "file" }> = [];

  let currentDir = path.resolve(startDir);
  const resolvedStopDir = stopDir != null ? path.resolve(stopDir) : null;

  // Walk up from startDir, checking for artifacts at each level
  while (true) {
    // Check for matching directories
    for (const dirPattern of patterns.dirs) {
      const candidatePath = path.join(currentDir, dirPattern);
      try {
        const stat = await fs.stat(candidatePath);
        if (stat.isDirectory()) {
          artifacts.push({ path: candidatePath, type: "directory" });
        }
      } catch {
        // Doesn't exist
      }
    }

    // Check for matching files
    for (const filePattern of patterns.files) {
      const candidatePath = path.join(currentDir, filePattern);
      try {
        const stat = await fs.stat(candidatePath);
        if (stat.isFile()) {
          artifacts.push({ path: candidatePath, type: "file" });
        }
      } catch {
        // Doesn't exist
      }
    }

    // Stop if we've reached the stop dir
    if (resolvedStopDir != null && currentDir === resolvedStopDir) {
      break;
    }

    // Stop if we've reached the filesystem root
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return artifacts;
};
