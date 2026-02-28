/**
 * Shared instructions loader
 * Replaces claudeMdLoader and agentsMdLoader
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log } from "@clack/prompts";
import { glob } from "glob";

import { getBundledSkillsDir } from "@/cli/features/bundled-skillsets/installer.js";
import { substituteTemplatePaths } from "@/cli/features/template.js";

import type { AgentLoader } from "@/cli/features/agentRegistry.js";

// Markers for managed block
const BEGIN_MARKER = "# BEGIN NORI-AI MANAGED BLOCK";
const END_MARKER = "# END NORI-AI MANAGED BLOCK";

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

    // Remove quotes if present
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
 *
 * INVARIANT: All skill files MUST be named "SKILL.md"
 * If this naming convention changes, this function must be updated.
 *
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
 * Format skill information for display in instructions file
 * @param args - Function arguments
 * @param args.skillPath - Path to SKILL.md file
 * @param args.agentDir - Agent config directory path for installed path resolution
 *
 * @returns Formatted skill information or null if path doesn't match expected format
 */
const formatSkillInfo = async (args: {
  skillPath: string;
  agentDir: string;
}): Promise<string | null> => {
  const { skillPath, agentDir } = args;

  try {
    const content = await fs.readFile(skillPath, "utf-8");
    const frontMatter = extractFrontMatter({ content });

    const pathParts = skillPath.split(path.sep);
    const skillMdIndex = pathParts.lastIndexOf("SKILL.md");
    if (skillMdIndex === -1 || skillMdIndex === 0) {
      return null;
    }

    const skillName = pathParts[skillMdIndex - 1];
    const installedPath = path.join(agentDir, "skills", skillName, "SKILL.md");

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
 * Generate skills list content to embed in the instructions file
 *
 * @param args - Function arguments
 * @param args.skillsDir - Path to the skills directory (from parsed Skillset), or null
 * @param args.agentDir - Agent config directory path
 *
 * @returns Formatted skills list markdown (empty string if skills cannot be found)
 */
const generateSkillsList = async (args: {
  skillsDir: string | null;
  agentDir: string;
}): Promise<string> => {
  const { skillsDir, agentDir } = args;

  try {
    const skillFiles =
      skillsDir != null ? await findSkillFiles({ dir: skillsDir }) : [];

    // Also find bundled skill files not already in the skillset
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
      // Bundled skills directory not found - continue without them
    }

    const allSkillFiles = [...skillFiles, ...bundledSkillFiles];

    if (allSkillFiles.length === 0) {
      return "";
    }

    const formattedSkills: Array<string> = [];
    for (const file of allSkillFiles) {
      const formatted = await formatSkillInfo({
        skillPath: file,
        agentDir,
      });
      if (formatted != null) {
        formattedSkills.push(formatted);
      }
    }

    if (formattedSkills.length === 0) {
      return "";
    }

    const usingSkillsPath = path.join(
      agentDir,
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

export const createInstructionsLoader = (args: {
  managedFiles?: ReadonlyArray<string> | null;
  managedDirs?: ReadonlyArray<string> | null;
}): AgentLoader => {
  const { managedFiles, managedDirs } = args;

  return {
    name: "instructions",
    description: "Install instructions file with managed block",
    managedFiles: managedFiles ?? undefined,
    managedDirs: managedDirs ?? undefined,
    run: async ({ agent, config, skillset }) => {
      if (skillset == null) {
        return;
      }

      const agentDir = agent.getAgentDir({ installDir: config.installDir });
      const instructionsFilePath = agent.getInstructionsFilePath({
        installDir: config.installDir,
      });

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
        // No profile config - clear the managed block from existing file if present
        let existingContent: string;
        try {
          existingContent = await fs.readFile(instructionsFilePath, "utf-8");
        } catch {
          // No existing file either - nothing to do
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
          await fs.mkdir(path.dirname(instructionsFilePath), {
            recursive: true,
          });
          await fs.writeFile(instructionsFilePath, cleared);
          log.success(`Cleared managed block in ${instructionsFilePath}`);
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

      // Apply template substitution to replace placeholders with actual paths
      instructions = substituteTemplatePaths({
        content: instructions,
        installDir: agentDir,
      });

      // Generate and append skills list
      const skillsList = await generateSkillsList({
        skillsDir: skillset.skillsDir,
        agentDir,
      });
      if (skillsList.length > 0) {
        instructions = instructions + skillsList;
      }

      // Create parent directory if it doesn't exist
      await fs.mkdir(path.dirname(instructionsFilePath), { recursive: true });

      // Read existing content or start with empty string
      let content = "";
      try {
        content = await fs.readFile(instructionsFilePath, "utf-8");
      } catch {
        // File doesn't exist, will create it
      }

      // Check if managed block already exists
      if (content.includes(BEGIN_MARKER)) {
        // Replace existing managed block
        const regex = new RegExp(
          `${BEGIN_MARKER}\n[\\s\\S]*?\n${END_MARKER}\n?`,
          "g",
        );
        content = content.replace(
          regex,
          `${BEGIN_MARKER}\n${instructions}\n${END_MARKER}\n`,
        );
        log.info("Updating existing nori instructions...");
      } else {
        // Append new managed block
        const section = `\n${BEGIN_MARKER}\n${instructions}\n${END_MARKER}\n`;
        content = content + section;
        log.info("Adding nori instructions...");
      }

      await fs.writeFile(instructionsFilePath, content);
      log.success(`Instructions configured at ${instructionsFilePath}`);
    },
  };
};
