/**
 * CLAUDE.md feature loader
 * Configures CLAUDE.md with coding task instructions
 */

import * as fs from "fs/promises";
import * as path from "path";

import {
  getClaudeDir,
  getClaudeMdFile,
} from "@/cli/features/claude-code/paths.js";
import { substituteTemplatePaths } from "@/cli/features/claude-code/template.js";
import { success, info } from "@/cli/logger.js";

import type { Config } from "@/cli/config.js";
import type { ProfileLoader } from "@/cli/features/claude-code/profiles/profileLoaderRegistry.js";
import type { SkillsetPackage } from "@/norijson/packageStructure.js";

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
 * Format skill information for display in CLAUDE.md
 * @param args - Function arguments
 * @param args.skillId - Skill directory name (e.g., "systematic-debugging")
 * @param args.sourceDir - Absolute path to the skill directory on disk
 * @param args.installDir - Custom installation directory (.claude path)
 *
 * @returns Formatted skill information or null if skill file cannot be read
 */
const formatSkillInfo = async (args: {
  skillId: string;
  sourceDir: string;
  installDir: string;
}): Promise<string | null> => {
  const { skillId, sourceDir, installDir } = args;

  try {
    const skillPath = path.join(sourceDir, "SKILL.md");
    const content = await fs.readFile(skillPath, "utf-8");
    const frontMatter = extractFrontMatter({ content });

    // Format the installed path based on install directory
    const installedPath = path.join(installDir, "skills", skillId, "SKILL.md");

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
    // If we can't read or parse the skill file, skip it
    return null;
  }
};

/**
 * Generate skills list content to embed in CLAUDE.md
 *
 * @param args - Function arguments
 * @param args.skills - Array of skill entries from the loaded package
 * @param args.installDir - Installation directory
 *
 * @returns Formatted skills list markdown (empty string if no skills)
 */
const generateSkillsList = async (args: {
  skills: Array<{ id: string; sourceDir: string }>;
  installDir: string;
}): Promise<string> => {
  const { skills, installDir } = args;

  if (skills.length === 0) {
    return "";
  }

  const claudeDir = getClaudeDir({ installDir });

  // Format all skills
  const formattedSkills: Array<string> = [];
  for (const skill of skills) {
    const formatted = await formatSkillInfo({
      skillId: skill.id,
      sourceDir: skill.sourceDir,
      installDir: claudeDir,
    });
    if (formatted != null) {
      formattedSkills.push(formatted);
    }
  }

  if (formattedSkills.length === 0) {
    return "";
  }

  // Build skills list message with correct path for the install directory
  const usingSkillsPath = path.join(
    claudeDir,
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
};

// Markers for managed block
const BEGIN_MARKER = "# BEGIN NORI-AI MANAGED BLOCK";
const END_MARKER = "# END NORI-AI MANAGED BLOCK";

/**
 * Insert or update CLAUDE.md with nori instructions in a managed block
 * @param args - Configuration arguments
 * @param args.config - Full configuration including profile
 * @param args.pkg - The loaded skillset package
 */
const insertClaudeMd = async (args: {
  config: Config;
  pkg: SkillsetPackage;
}): Promise<void> => {
  const { config, pkg } = args;

  info({ message: "Configuring CLAUDE.md with coding task instructions..." });

  // Get paths using installDir
  const claudeDir = getClaudeDir({ installDir: config.installDir });
  const claudeMdFile = getClaudeMdFile({ installDir: config.installDir });

  // Use CLAUDE.md from the loaded package
  let instructions = pkg.claudeMd;

  if (instructions == null) {
    // No profile CLAUDE.md — clear the managed block from existing CLAUDE.md if present
    info({
      message: "Profile CLAUDE.md not found, clearing managed block",
    });

    let existingContent: string;
    try {
      existingContent = await fs.readFile(claudeMdFile, "utf-8");
    } catch {
      // No existing CLAUDE.md either — nothing to do
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
      await fs.writeFile(claudeMdFile, cleared);
      success({
        message: `✓ Cleared managed block in ${claudeMdFile}`,
      });
    }
    return;
  }

  // Strip existing managed block markers from instructions if present
  // This handles the case where captureExistingConfigAsProfile wrapped content with markers
  // and prevents double-nesting when we wrap it again below
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
    installDir: claudeDir,
  });

  // Generate and append skills list
  const skillsList = await generateSkillsList({
    skills: pkg.skills,
    installDir: config.installDir,
  });
  if (skillsList.length > 0) {
    instructions = instructions + skillsList;
  }

  // Create .claude directory if it doesn't exist
  await fs.mkdir(claudeDir, { recursive: true });

  // Read existing content or start with empty string
  let content = "";
  try {
    content = await fs.readFile(claudeMdFile, "utf-8");
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
    info({ message: "Updating existing nori instructions in CLAUDE.md..." });
  } else {
    // Append new managed block
    const section = `\n${BEGIN_MARKER}\n${instructions}\n${END_MARKER}\n`;
    content = content + section;
    info({ message: "Adding nori instructions to CLAUDE.md..." });
  }

  await fs.writeFile(claudeMdFile, content);
  success({ message: `✓ CLAUDE.md configured at ${claudeMdFile}` });
};

/**
 * CLAUDE.md feature loader
 */
export const claudeMdLoader: ProfileLoader = {
  name: "claudemd",
  description: "Configure CLAUDE.md with coding task instructions",
  install: async (args: { config: Config; pkg: SkillsetPackage }) => {
    const { config, pkg } = args;
    await insertClaudeMd({ config, pkg });
  },
};
