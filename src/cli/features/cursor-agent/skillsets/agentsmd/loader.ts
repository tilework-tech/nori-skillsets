/**
 * AGENTS.md feature loader
 * Configures AGENTS.md with coding task instructions for Cursor
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log } from "@clack/prompts";
import { glob } from "glob";

import { type Config } from "@/cli/config.js";
import {
  getCursorDir,
  getCursorAgentsMdFile,
} from "@/cli/features/cursor-agent/paths.js";
import { substituteTemplatePaths } from "@/cli/features/template.js";

import type { CursorProfileLoader } from "@/cli/features/cursor-agent/skillsets/skillsetLoaderRegistry.js";
import type { Skillset } from "@/cli/features/skillset.js";

/**
 * Extract front matter from markdown file content
 * @param args - Function arguments
 * @param args.content - Markdown file content
 *
 * @returns Front matter object or null
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
 * @param args.dir - Directory to search
 *
 * @returns Array of skill file paths
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
 * Format skill information for display in AGENTS.md
 * @param args - Function arguments
 * @param args.skillPath - Path to SKILL.md file
 * @param args.installDir - Custom installation directory (.cursor path)
 *
 * @returns Formatted skill information or null
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
 * Generate skills list content to embed in AGENTS.md
 * @param args - Function arguments
 * @param args.skillsDir - Path to the skills directory, or null
 * @param args.installDir - Installation directory
 *
 * @returns Formatted skills list markdown
 */
const generateSkillsList = async (args: {
  skillsDir: string | null;
  installDir: string;
}): Promise<string> => {
  const { skillsDir, installDir } = args;

  if (skillsDir == null) {
    return "";
  }

  try {
    const skillFiles = await findSkillFiles({ dir: skillsDir });

    if (skillFiles.length === 0) {
      return "";
    }

    const cursorDir = getCursorDir({ installDir });
    const formattedSkills: Array<string> = [];
    for (const file of skillFiles) {
      const formatted = await formatSkillInfo({
        skillPath: file,
        installDir: cursorDir,
      });
      if (formatted != null) {
        formattedSkills.push(formatted);
      }
    }

    if (formattedSkills.length === 0) {
      return "";
    }

    const usingSkillsPath = path.join(
      cursorDir,
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
 * Insert or update AGENTS.md with nori instructions in a managed block
 * @param args - Configuration arguments
 * @param args.config - Full configuration
 * @param args.skillset - Parsed skillset
 */
const insertAgentsMd = async (args: {
  config: Config;
  skillset: Skillset;
}): Promise<void> => {
  const { config, skillset } = args;

  log.info("Configuring AGENTS.md with coding task instructions...");

  const cursorDir = getCursorDir({ installDir: config.installDir });
  const agentsMdFile = getCursorAgentsMdFile({ installDir: config.installDir });

  // Read instructions from the skillset's config file (CLAUDE.md)
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
    // No profile config — clear the managed block from existing AGENTS.md if present
    let existingContent: string;
    try {
      existingContent = await fs.readFile(agentsMdFile, "utf-8");
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
      await fs.writeFile(agentsMdFile, cleared);
      log.success(`Cleared managed block in ${agentsMdFile}`);
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
    installDir: cursorDir,
  });

  // Generate and append skills list
  const skillsList = await generateSkillsList({
    skillsDir: skillset.skillsDir,
    installDir: config.installDir,
  });
  if (skillsList.length > 0) {
    instructions = instructions + skillsList;
  }

  // Create .cursor/rules directory if it doesn't exist
  const rulesDir = path.join(cursorDir, "rules");
  await fs.mkdir(rulesDir, { recursive: true });

  // Read existing content or start with empty string
  let content = "";
  try {
    content = await fs.readFile(agentsMdFile, "utf-8");
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
    log.info("Updating existing nori instructions in AGENTS.md...");
  } else {
    const section = `\n${BEGIN_MARKER}\n${instructions}\n${END_MARKER}\n`;
    content = content + section;
    log.info("Adding nori instructions to AGENTS.md...");
  }

  await fs.writeFile(agentsMdFile, content);
  log.success(`AGENTS.md configured at ${agentsMdFile}`);
};

/**
 * AGENTS.md feature loader
 */
export const agentsMdLoader: CursorProfileLoader = {
  name: "agentsmd",
  description: "Configure AGENTS.md with coding task instructions",
  install: async (args: { config: Config; skillset: Skillset }) => {
    const { config, skillset } = args;
    await insertAgentsMd({ config, skillset });
  },
};
