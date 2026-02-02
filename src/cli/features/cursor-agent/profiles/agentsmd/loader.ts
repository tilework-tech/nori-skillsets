/**
 * AGENTS.md feature loader for cursor-agent
 * Configures AGENTS.md with Nori instructions
 */

import * as fs from "fs/promises";
import * as path from "path";

import { glob } from "glob";

import { getAgentProfile } from "@/cli/config.js";
import {
  getCursorDir,
  getCursorAgentsMdFile,
} from "@/cli/features/cursor-agent/paths.js";
import { substituteTemplatePaths } from "@/cli/features/cursor-agent/template.js";
import { success, info } from "@/cli/logger.js";

import type { Config } from "@/cli/config.js";
import type { ValidationResult } from "@/cli/features/agentRegistry.js";
import type { CursorProfileLoader } from "@/cli/features/cursor-agent/profiles/profileLoaderRegistry.js";

/**
 * Get path to AGENTS.md for a profile
 *
 * @param args - Function arguments
 * @param args.profileName - Name of the profile to load AGENTS.md from
 * @param args.installDir - Installation directory
 *
 * @returns Path to the AGENTS.md file for the profile
 */
const getProfileAgentsMd = (args: {
  profileName: string;
  installDir: string;
}): string => {
  const { profileName, installDir } = args;
  const cursorDir = getCursorDir({ installDir });
  return path.join(cursorDir, "profiles", profileName, "AGENTS.md");
};

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
 * Find all RULE.md files in a directory using glob pattern
 *
 * INVARIANT: All rule files MUST be named "RULE.md"
 * If this naming convention changes, this function must be updated.
 *
 * @param args - Function arguments
 * @param args.dir - Directory to search
 *
 * @returns Array of rule file paths
 */
const findRuleFiles = async (args: { dir: string }): Promise<Array<string>> => {
  const { dir } = args;

  // Use glob to find all RULE.md files recursively
  const files = await glob("**/RULE.md", {
    cwd: dir,
    absolute: true,
    nodir: true,
  });

  return files;
};

/**
 * Format rule information for display in AGENTS.md
 * @param args - Function arguments
 * @param args.rulePath - Path to RULE.md file in installed rules directory
 * @param args.installDir - Custom installation directory (.cursor path)
 *
 * @returns Formatted rule information or null if path doesn't match expected format
 */
const formatRuleInfo = async (args: {
  rulePath: string;
  installDir: string;
}): Promise<string | null> => {
  const { rulePath, installDir } = args;

  try {
    const content = await fs.readFile(rulePath, "utf-8");
    const frontMatter = extractFrontMatter({ content });

    // Extract the rule name from the path
    // Path format: .../rules/{rule-name}/RULE.md
    // The rulePath is an absolute path, so we need to extract just the rule directory name
    const pathParts = rulePath.split(path.sep);
    const ruleMdIndex = pathParts.lastIndexOf("RULE.md");
    if (ruleMdIndex === -1 || ruleMdIndex === 0) {
      return null;
    }

    // The rule name is the directory containing RULE.md
    const ruleName = pathParts[ruleMdIndex - 1];

    // Format the installed path based on install directory
    const installedPath = path.join(installDir, "rules", ruleName, "RULE.md");

    let output = `\n${installedPath}`;

    if (frontMatter != null && frontMatter.description != null) {
      output += `\n  Description: ${frontMatter.description}`;
    }

    return output;
  } catch {
    // If we can't read or parse the rule file, skip it
    return null;
  }
};

/**
 * Generate rules list content to embed in AGENTS.md
 *
 * @param args - Function arguments
 * @param args.installDir - Installation directory
 *
 * @returns Formatted rules list markdown (empty string if rules cannot be found)
 */
const generateRulesList = async (args: {
  installDir: string;
}): Promise<string> => {
  const { installDir } = args;

  try {
    // Get rules directory from installed location
    const cursorDir = getCursorDir({ installDir });
    const rulesDir = path.join(cursorDir, "rules");

    // Find all rule files
    const ruleFiles = await findRuleFiles({ dir: rulesDir });

    if (ruleFiles.length === 0) {
      return "";
    }

    // Format all rules
    const formattedRules: Array<string> = [];
    for (const file of ruleFiles) {
      const formatted = await formatRuleInfo({
        rulePath: file,
        installDir: cursorDir,
      });
      if (formatted != null) {
        formattedRules.push(formatted);
      }
    }

    if (formattedRules.length === 0) {
      return "";
    }

    // Build rules list message with correct path for the install directory
    const usingRulesPath = path.join(
      cursorDir,
      "rules",
      "using-rules",
      "RULE.md",
    );

    const contextMessage = `
# Nori Rules System

You have access to the Nori rules system. Read the full instructions at: ${usingRulesPath}

## Available Rules

Found ${formattedRules.length} rules:${formattedRules.join("")}

Check if any of these rules are relevant to the user's task. If relevant, use read_file to load the rule before proceeding.
`;

    return contextMessage;
  } catch {
    // If we can't find or read rules, silently return empty string
    // Installation will continue without rules list
    return "";
  }
};

/**
 * Insert or update AGENTS.md with nori instructions in a managed block
 * @param args - Configuration arguments
 * @param args.config - Full configuration including profile
 */
const insertAgentsMd = async (args: { config: Config }): Promise<void> => {
  const { config } = args;

  info({ message: "Configuring AGENTS.md with Nori instructions..." });

  // Get profile name from config (default to amol for cursor-agent)
  const agentProfile = getAgentProfile({ config, agentName: "cursor-agent" });
  const profileName = agentProfile?.baseProfile || "amol";

  // Get paths using installDir
  const cursorDir = getCursorDir({ installDir: config.installDir });
  const agentsMdFile = getCursorAgentsMdFile({ installDir: config.installDir });

  // Read AGENTS.md from the selected profile
  const profileAgentsMdPath = getProfileAgentsMd({
    profileName,
    installDir: config.installDir,
  });
  let instructions = await fs.readFile(profileAgentsMdPath, "utf-8");

  // Apply template substitution to replace placeholders with actual paths
  instructions = substituteTemplatePaths({
    content: instructions,
    installDir: cursorDir,
  });

  // Generate and append rules list
  const rulesList = await generateRulesList({
    installDir: config.installDir,
  });
  if (rulesList.length > 0) {
    instructions = instructions + rulesList;
  }

  // Create .cursor directory if it doesn't exist
  await fs.mkdir(cursorDir, { recursive: true });

  // Read existing content or start with empty string
  let content = "";
  try {
    content = await fs.readFile(agentsMdFile, "utf-8");
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
    info({ message: "Updating existing nori instructions in AGENTS.md..." });
  } else {
    // Append new managed block
    const section = `\n${BEGIN_MARKER}\n${instructions}\n${END_MARKER}\n`;
    content = content + section;
    info({ message: "Adding nori instructions to AGENTS.md..." });
  }

  await fs.writeFile(agentsMdFile, content);
  success({ message: `✓ AGENTS.md configured at ${agentsMdFile}` });
};

/**
 * Remove nori-managed block from AGENTS.md
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const removeAgentsMd = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  info({ message: "Removing nori instructions from AGENTS.md..." });

  const agentsMdFile = getCursorAgentsMdFile({ installDir: config.installDir });

  try {
    const content = await fs.readFile(agentsMdFile, "utf-8");

    // Check if managed block exists
    if (!content.includes(BEGIN_MARKER)) {
      info({ message: "No nori instructions found in AGENTS.md" });
      return;
    }

    // Remove managed block
    const regex = new RegExp(
      `\n?${BEGIN_MARKER}\n[\\s\\S]*?\n${END_MARKER}\n?`,
      "g",
    );
    const updated = content.replace(regex, "");

    // If file is empty after removal, delete it
    if (updated.trim() === "") {
      await fs.unlink(agentsMdFile);
      success({ message: "✓ AGENTS.md removed (was empty after cleanup)" });
    } else {
      await fs.writeFile(agentsMdFile, updated);
      success({
        message: "✓ Nori instructions removed from AGENTS.md (file preserved)",
      });
    }
  } catch {
    info({ message: "AGENTS.md not found (may not have been installed)" });
  }
};

/**
 * Validate AGENTS.md configuration
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 *
 * @returns Validation result
 */
const validate = async (args: {
  config: Config;
}): Promise<ValidationResult> => {
  const { config } = args;
  const errors: Array<string> = [];

  const agentsMdFile = getCursorAgentsMdFile({ installDir: config.installDir });

  // Check if AGENTS.md exists
  try {
    await fs.access(agentsMdFile);
  } catch {
    errors.push(`AGENTS.md not found at ${agentsMdFile}`);
    errors.push('Run "nori-skillsets init" to create AGENTS.md');
    return {
      valid: false,
      message: "AGENTS.md not found",
      errors,
    };
  }

  // Read and check for managed block
  let content: string;
  try {
    content = await fs.readFile(agentsMdFile, "utf-8");
  } catch (err) {
    errors.push("Failed to read AGENTS.md");
    errors.push(`Error: ${err}`);
    return {
      valid: false,
      message: "Unable to read AGENTS.md",
      errors,
    };
  }

  // Check if managed block exists
  if (!content.includes(BEGIN_MARKER) || !content.includes(END_MARKER)) {
    errors.push("Nori managed block not found in AGENTS.md");
    errors.push('Run "nori-skillsets init" to add managed block');
    return {
      valid: false,
      message: "Nori managed block missing",
      errors,
    };
  }

  return {
    valid: true,
    message: "AGENTS.md is properly configured",
    errors: null,
  };
};

/**
 * AGENTS.md feature loader
 */
export const agentsMdLoader: CursorProfileLoader = {
  name: "agentsmd",
  description: "Configure AGENTS.md with Nori instructions",
  install: async (args: { config: Config }) => {
    const { config } = args;
    await insertAgentsMd({ config });
  },
  uninstall: async (args: { config: Config }) => {
    const { config } = args;
    await removeAgentsMd({ config });
  },
  validate,
};
