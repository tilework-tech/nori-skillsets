/**
 * Existing Config Capture (Claude Code)
 *
 * Claude Code-specific functions for detecting and capturing existing
 * configurations as a named skillset during installation.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { type ExistingConfig } from "@/cli/features/agentRegistry.js";
import {
  getClaudeDir,
  getClaudeMdFile,
  getClaudeSkillsDir,
  getClaudeAgentsDir,
  getClaudeCommandsDir,
  getNoriSkillsetsDir,
} from "@/cli/features/claude-code/paths.js";

export type { ExistingConfig };

// Managed block markers
const BEGIN_MARKER = "# BEGIN NORI-AI MANAGED BLOCK";
const END_MARKER = "# END NORI-AI MANAGED BLOCK";

/**
 * Check if a file exists
 *
 * @param filePath - Path to the file to check
 *
 * @returns True if the file exists, false otherwise
 */
const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Get list of valid skill names from a skills directory
 *
 * @param skillsDir - Path to the skills directory
 *
 * @returns Array of skill directory names that contain SKILL.md
 */
const getSkillNames = async (skillsDir: string): Promise<Array<string>> => {
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    const skillNames: Array<string> = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
        if (await fileExists(skillMdPath)) {
          skillNames.push(entry.name);
        }
      }
    }

    return skillNames;
  } catch {
    return [];
  }
};

/**
 * Count SKILL.md files in skills directory
 *
 * @param skillsDir - Path to the skills directory
 *
 * @returns Number of valid skill directories found
 */
const countSkills = async (skillsDir: string): Promise<number> => {
  const names = await getSkillNames(skillsDir);
  return names.length;
};

/**
 * Count .md files in a directory (for agents and commands)
 *
 * @param dir - Path to the directory to scan
 *
 * @returns Number of .md files found
 */
const countMdFiles = async (dir: string): Promise<number> => {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let count = 0;

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        count++;
      }
    }

    return count;
  } catch {
    return 0;
  }
};

/**
 * Detect existing Claude Code configuration
 *
 * Checks for:
 * - CLAUDE.md file (and whether it has a managed block)
 * - skills directory with SKILL.md files
 * - agents directory with .md files
 * - commands directory with .md files
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Detected config info, or null if no config found
 */
export const detectExistingConfig = async (args: {
  installDir: string;
}): Promise<ExistingConfig | null> => {
  const { installDir } = args;

  const claudeDir = getClaudeDir({ installDir });

  // Check if .claude directory exists
  if (!(await fileExists(claudeDir))) {
    return null;
  }

  const claudeMdFile = getClaudeMdFile({ installDir });
  const skillsDir = getClaudeSkillsDir({ installDir });
  const agentsDir = getClaudeAgentsDir({ installDir });
  const commandsDir = getClaudeCommandsDir({ installDir });

  // Check CLAUDE.md
  let hasClaudeMd = false;
  let hasManagedBlock = false;

  if (await fileExists(claudeMdFile)) {
    hasClaudeMd = true;
    try {
      const content = await fs.readFile(claudeMdFile, "utf-8");
      hasManagedBlock = content.includes(BEGIN_MARKER);
    } catch {
      // Ignore read errors
    }
  }

  // Count skills
  const skillCount = await countSkills(skillsDir);
  const hasSkills = skillCount > 0;

  // Count agents
  const agentCount = await countMdFiles(agentsDir);
  const hasAgents = agentCount > 0;

  // Count commands
  const commandCount = await countMdFiles(commandsDir);
  const hasCommands = commandCount > 0;

  // Return null if nothing was found
  if (!hasClaudeMd && !hasSkills && !hasAgents && !hasCommands) {
    return null;
  }

  return {
    hasClaudeMd,
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
 * Capture existing configuration as a named skillset
 *
 * Creates a new skillset in ~/.nori/profiles/<skillsetName>/ containing:
 * - nori.json with metadata
 * - CLAUDE.md with managed block markers added
 * - skills/ directory (copied from ~/.claude/skills/)
 * - subagents/ directory (copied from ~/.claude/agents/)
 * - slashcommands/ directory (copied from ~/.claude/commands/)
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.skillsetName - Name for the new skillset
 */
export const captureExistingConfigAsSkillset = async (args: {
  installDir: string;
  skillsetName: string;
}): Promise<void> => {
  const { installDir, skillsetName } = args;

  const skillsetsDir = getNoriSkillsetsDir();
  const skillsetDir = path.join(skillsetsDir, skillsetName);

  // Create skillset directory
  await fs.mkdir(skillsetDir, { recursive: true });

  // Get skill names from the source skills directory
  const skillsDir = getClaudeSkillsDir({ installDir });
  const skillNames = await getSkillNames(skillsDir);

  // Create nori.json with skills map and description
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

  // Copy CLAUDE.md with managed block markers
  const claudeMdFile = getClaudeMdFile({ installDir });
  if (await fileExists(claudeMdFile)) {
    let content = await fs.readFile(claudeMdFile, "utf-8");

    // Add managed block markers if not present
    if (!content.includes(BEGIN_MARKER)) {
      content = `${BEGIN_MARKER}\n${content}\n${END_MARKER}\n`;
    }

    await fs.writeFile(path.join(skillsetDir, "CLAUDE.md"), content);
  } else {
    // Create empty CLAUDE.md with markers
    await fs.writeFile(
      path.join(skillsetDir, "CLAUDE.md"),
      `${BEGIN_MARKER}\n\n${END_MARKER}\n`,
    );
  }

  // Copy skills directory (skillsDir already defined above for nori.json)
  if (await fileExists(skillsDir)) {
    const destSkillsDir = path.join(skillsetDir, "skills");
    await fs.cp(skillsDir, destSkillsDir, { recursive: true });
  }

  // Copy agents directory as subagents
  const agentsDir = getClaudeAgentsDir({ installDir });
  if (await fileExists(agentsDir)) {
    const destSubagentsDir = path.join(skillsetDir, "subagents");
    await fs.cp(agentsDir, destSubagentsDir, { recursive: true });
  }

  // Copy commands directory as slashcommands
  const commandsDir = getClaudeCommandsDir({ installDir });
  if (await fileExists(commandsDir)) {
    const destSlashcommandsDir = path.join(skillsetDir, "slashcommands");
    await fs.cp(commandsDir, destSlashcommandsDir, { recursive: true });
  }
};
