/**
 * Shared instructions MD loader
 * Configures the agent's instruction file (CLAUDE.md / AGENTS.md) with managed block
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log } from "@clack/prompts";
import { glob } from "glob";

import { type Config } from "@/cli/config.js";
import { getBundledSkillsDir } from "@/cli/features/bundled-skillsets/installer.js";
import { getAgentDir } from "@/cli/features/shared/agentHandlers.js";
import { substituteTemplatePaths } from "@/cli/features/template.js";

import type { AgentConfig } from "@/cli/features/agentRegistry.js";
import type { Skillset } from "@/cli/features/skillset.js";

/**
 * Extract front matter from markdown file content
 * @param args - Function arguments
 * @param args.content - The markdown content to parse
 *
 * @returns Parsed front matter key-value pairs or null if none found
 */
const extractFrontMatter = (args: {
  content: string;
}): Record<string, string> | null => {
  const { content } = args;

  const frontMatterRegex = /^---\n([\s\S]*?)\n---/;
  const match = content.match(frontMatterRegex);

  if (match == null) {
    return null;
  }

  const frontMatter: Record<string, string> = {};

  if (match[1].trim() === "") {
    return frontMatter;
  }

  const lines = match[1].split("\n");

  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }

    const key = line.substring(0, colonIndex).trim();
    let value = line.substring(colonIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.substring(1, value.length - 1);
    }

    frontMatter[key] = value;
  }

  return frontMatter;
};

/**
 * Find all SKILL.md files in a directory using glob pattern
 * @param args - Function arguments
 * @param args.dir - The directory to search
 *
 * @returns Array of absolute paths to SKILL.md files
 */
const findSkillFiles = async (args: {
  dir: string;
}): Promise<Array<string>> => {
  const { dir } = args;

  const files = await glob("**/SKILL.md", {
    cwd: dir,
    absolute: true,
    nodir: true,
  });

  return files;
};

/**
 * Format skill information for display in the instruction file
 * @param args - Function arguments
 * @param args.skillPath - Absolute path to the SKILL.md file
 * @param args.installDir - The agent directory path for relative path computation
 *
 * @returns Formatted skill info string or null on error
 */
const formatSkillInfo = async (args: {
  skillPath: string;
  installDir: string;
}): Promise<string | null> => {
  const { skillPath, installDir } = args;

  try {
    const content = await fs.readFile(skillPath, "utf-8");
    const frontMatter = extractFrontMatter({ content });

    const pathParts = skillPath.split(path.sep);
    const skillMdIndex = pathParts.lastIndexOf("SKILL.md");
    if (skillMdIndex === -1 || skillMdIndex === 0) {
      return null;
    }

    const skillName = pathParts[skillMdIndex - 1];
    const installedPath = path.join(
      installDir,
      "skills",
      skillName,
      "SKILL.md",
    );

    let output = `\n${installedPath}`;

    if (frontMatter != null) {
      if (frontMatter.name != null) {
        output += `\n  Name: ${frontMatter.name}`;
      }
      if (frontMatter.description != null) {
        output += `\n  Description: ${frontMatter.description}`;
      }
    }

    return output;
  } catch {
    return null;
  }
};

/**
 * Generate skills list content to embed in the instruction file
 * @param args - Function arguments
 * @param args.skillsDir - Path to the skillset's skills directory, or null
 * @param args.installDir - The installation directory (unused, reserved)
 * @param args.agentDirPath - The agent's config directory path
 *
 * @returns Skills list markdown content
 */
const generateSkillsList = async (args: {
  skillsDir: string | null;
  installDir: string;
  agentDirPath: string;
}): Promise<string> => {
  const { skillsDir, agentDirPath } = args;

  try {
    const skillFiles =
      skillsDir != null ? await findSkillFiles({ dir: skillsDir }) : [];

    const bundledDir = getBundledSkillsDir();
    let bundledSkillFiles: Array<string> = [];
    try {
      const bundledFiles = await findSkillFiles({ dir: bundledDir });
      const skillsetSkillNames = new Set(
        skillFiles
          .map((f) => {
            const parts = f.split(path.sep);
            const idx = parts.lastIndexOf("SKILL.md");
            return idx > 0 ? parts[idx - 1] : null;
          })
          .filter((n): n is string => n != null),
      );
      bundledSkillFiles = bundledFiles.filter((f) => {
        const parts = f.split(path.sep);
        const idx = parts.lastIndexOf("SKILL.md");
        const name = idx > 0 ? parts[idx - 1] : null;
        return name != null && !skillsetSkillNames.has(name);
      });
    } catch {
      // Bundled skills directory not found — continue without them
    }

    const allSkillFiles = [...skillFiles, ...bundledSkillFiles];

    if (allSkillFiles.length === 0) {
      return "";
    }

    const formattedSkills: Array<string> = [];
    for (const file of allSkillFiles) {
      const formatted = await formatSkillInfo({
        skillPath: file,
        installDir: agentDirPath,
      });
      if (formatted != null) {
        formattedSkills.push(formatted);
      }
    }

    if (formattedSkills.length === 0) {
      return "";
    }

    const usingSkillsPath = path.join(
      agentDirPath,
      "skills",
      "using-skills",
      "SKILL.md",
    );

    const contextMessage = `
# Nori Skills System

You have access to the Nori skills system. Read the full instructions at: ${usingSkillsPath}

## Available Skills

Found ${formattedSkills.length} skills:${formattedSkills.join("")}

Check if any of these skills are relevant to the user's task. If relevant, use the Read tool to load the skill before proceeding.
`;

    return contextMessage;
  } catch {
    return "";
  }
};

// Markers for managed block
const BEGIN_MARKER = "# BEGIN NORI-AI MANAGED BLOCK";
const END_MARKER = "# END NORI-AI MANAGED BLOCK";

/**
 * Insert or update the agent's instruction file with nori instructions in a managed block
 * @param args - Function arguments
 * @param args.agentConfig - The agent configuration
 * @param args.config - The Nori configuration
 * @param args.skillset - The parsed skillset
 */
export const installInstructionsMd = async (args: {
  agentConfig: AgentConfig;
  config: Config;
  skillset: Skillset;
}): Promise<void> => {
  const { agentConfig, config, skillset } = args;

  const agentDirPath = getAgentDir({
    agentConfig,
    installDir: config.installDir,
  });
  const instructionFile = path.join(
    agentDirPath,
    agentConfig.instructionFilePath,
  );
  const instructionFileName = path.basename(agentConfig.instructionFilePath);

  log.info(
    `Configuring ${instructionFileName} with coding task instructions...`,
  );

  // Read instructions from the skillset's config file
  const profileConfigPath = skillset.configFilePath;

  let instructions: string | null = null;
  if (profileConfigPath != null) {
    try {
      instructions = await fs.readFile(profileConfigPath, "utf-8");
    } catch {
      log.info("Profile config file not found, clearing managed block");
    }
  } else {
    log.info("Profile config file not found, clearing managed block");
  }

  if (instructions == null) {
    // No profile config — clear the managed block from existing file if present
    let existingContent: string;
    try {
      existingContent = await fs.readFile(instructionFile, "utf-8");
    } catch {
      return;
    }

    if (existingContent.includes(BEGIN_MARKER)) {
      const regex = new RegExp(
        `${BEGIN_MARKER}\n[\\s\\S]*?\n${END_MARKER}\n?`,
        "g",
      );
      const cleared = existingContent.replace(
        regex,
        `${BEGIN_MARKER}\n\n${END_MARKER}\n`,
      );
      await fs.writeFile(instructionFile, cleared);
      log.success(`Cleared managed block in ${instructionFile}`);
    }
    return;
  }

  // Strip existing managed block markers from instructions if present
  const stripMarkersRegex = new RegExp(
    `^${BEGIN_MARKER}\\n([\\s\\S]*?)\\n${END_MARKER}\\n?$`,
  );
  const markerMatch = instructions.match(stripMarkersRegex);
  if (markerMatch != null) {
    instructions = markerMatch[1];
  }

  // Apply template substitution
  instructions = substituteTemplatePaths({
    content: instructions,
    installDir: agentDirPath,
  });

  // Generate and append skills list
  const skillsList = await generateSkillsList({
    skillsDir: skillset.skillsDir,
    installDir: config.installDir,
    agentDirPath,
  });
  if (skillsList.length > 0) {
    instructions = instructions + skillsList;
  }

  // Create parent directory for the instruction file (handles nested paths like .cursor/rules/)
  await fs.mkdir(path.dirname(instructionFile), { recursive: true });

  // Read existing content or start with empty string
  let content = "";
  try {
    content = await fs.readFile(instructionFile, "utf-8");
  } catch {
    // File doesn't exist, will create it
  }

  // Check if managed block already exists
  if (content.includes(BEGIN_MARKER)) {
    const regex = new RegExp(
      `${BEGIN_MARKER}\n[\\s\\S]*?\n${END_MARKER}\n?`,
      "g",
    );
    content = content.replace(
      regex,
      `${BEGIN_MARKER}\n${instructions}\n${END_MARKER}\n`,
    );
    log.info(
      `Updating existing nori instructions in ${instructionFileName}...`,
    );
  } else {
    const section = `\n${BEGIN_MARKER}\n${instructions}\n${END_MARKER}\n`;
    content = content + section;
    log.info(`Adding nori instructions to ${instructionFileName}...`);
  }

  await fs.writeFile(instructionFile, content);
  log.success(`${instructionFileName} configured at ${instructionFile}`);
};
