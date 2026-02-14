/**
 * Generic install pipeline for nori-skillsets multi-agent architecture.
 * Installs a canonical Nori profile into any supported agent's dot directory.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { glob } from "glob";

import { substituteTemplatePaths } from "@/cli/features/claude-code/template.js";
import { compileContent } from "@/cli/features/compiler/contentCompiler.js";

type AgentPaths = {
  dotDirName: string;
  instructionsFileName: string;
  skillsDirName: string;
  agentsDirName: string;
  commandsDirName: string;
};

const agentPathsMap: Record<string, AgentPaths> = {
  "claude-code": {
    dotDirName: ".claude",
    instructionsFileName: "CLAUDE.md",
    skillsDirName: "skills",
    agentsDirName: "agents",
    commandsDirName: "commands",
  },
  codex: {
    dotDirName: ".codex",
    instructionsFileName: "AGENTS.md",
    skillsDirName: "skills",
    agentsDirName: "agents",
    commandsDirName: "commands",
  },
};

const BEGIN_MARKER = "# BEGIN NORI-AI MANAGED BLOCK";
const END_MARKER = "# END NORI-AI MANAGED BLOCK";

/**
 * Extract YAML front matter from markdown content
 *
 * @param args - Function arguments
 * @param args.content - The markdown content to parse
 *
 * @returns Parsed front matter key-value pairs, or null if no front matter found
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
 * Generate skills list section for the instructions file
 *
 * @param args - Function arguments
 * @param args.profileSkillsDir - Path to the profile's skills directory
 * @param args.agentDotDir - Path to the agent's dot directory
 *
 * @returns Formatted skills list markdown, or empty string if no skills found
 */
const generateSkillsList = async (args: {
  profileSkillsDir: string;
  agentDotDir: string;
}): Promise<string> => {
  const { profileSkillsDir, agentDotDir } = args;

  try {
    await fs.access(profileSkillsDir);
  } catch {
    return "";
  }

  const skillFiles = await glob("**/SKILL.md", {
    cwd: profileSkillsDir,
    absolute: true,
    nodir: true,
  });

  if (skillFiles.length === 0) {
    return "";
  }

  const formattedSkills: Array<string> = [];

  for (const skillPath of skillFiles) {
    try {
      const content = await fs.readFile(skillPath, "utf-8");
      const frontMatter = extractFrontMatter({ content });

      const pathParts = skillPath.split(path.sep);
      const skillMdIndex = pathParts.lastIndexOf("SKILL.md");
      if (skillMdIndex === -1 || skillMdIndex === 0) {
        continue;
      }

      const skillName = pathParts[skillMdIndex - 1];
      const installedPath = path.join(
        agentDotDir,
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

      formattedSkills.push(output);
    } catch {
      continue;
    }
  }

  if (formattedSkills.length === 0) {
    return "";
  }

  const usingSkillsPath = path.join(
    agentDotDir,
    "skills",
    "using-skills",
    "SKILL.md",
  );

  return `
# Nori Skills System

You have access to the Nori skills system. Read the full instructions at: ${usingSkillsPath}

## Available Skills

Found ${formattedSkills.length} skills:${formattedSkills.join("")}

Check if any of these skills are relevant to the user's task. If relevant, use the Read tool to load the skill before proceeding.
`;
};

/**
 * Compile and substitute template paths in markdown content
 *
 * @param args - Function arguments
 * @param args.content - The markdown content to process
 * @param args.agentName - The target agent name for vocabulary translation
 * @param args.agentDotDir - Path to the agent's dot directory for template substitution
 *
 * @returns Content with vocabulary translated and template paths substituted
 */
const compileAndSubstitute = (args: {
  content: string;
  agentName: string;
  agentDotDir: string;
}): string => {
  const { content, agentName, agentDotDir } = args;

  const compiled = compileContent({
    content,
    agentName,
    strategy: "minimal",
  });

  return substituteTemplatePaths({
    content: compiled,
    installDir: agentDotDir,
  });
};

/**
 * Install instructions with managed block into the agent's instructions file
 *
 * @param args - Function arguments
 * @param args.profileDir - Path to the profile directory containing CLAUDE.md
 * @param args.agentDotDir - Path to the agent's dot directory
 * @param args.instructionsFilePath - Full path to the agent's instructions file
 * @param args.agentName - The target agent name for vocabulary translation
 * @param args.profileSkillsDir - Path to the profile's skills directory for skills list
 */
const installInstructions = async (args: {
  profileDir: string;
  agentDotDir: string;
  instructionsFilePath: string;
  agentName: string;
  profileSkillsDir: string;
}): Promise<void> => {
  const {
    profileDir,
    agentDotDir,
    instructionsFilePath,
    agentName,
    profileSkillsDir,
  } = args;

  let instructions = await fs.readFile(
    path.join(profileDir, "CLAUDE.md"),
    "utf-8",
  );

  // Strip existing managed block markers to prevent double-nesting
  const stripMarkersRegex = new RegExp(
    `^${BEGIN_MARKER}\\n([\\s\\S]*?)\\n${END_MARKER}\\n?$`,
  );
  const markerMatch = instructions.match(stripMarkersRegex);
  if (markerMatch != null) {
    instructions = markerMatch[1];
  }

  // Compile (vocabulary translation) and substitute template paths
  instructions = compileAndSubstitute({
    content: instructions,
    agentName,
    agentDotDir,
  });

  // Generate and append skills list
  const skillsList = await generateSkillsList({
    profileSkillsDir,
    agentDotDir,
  });
  if (skillsList.length > 0) {
    instructions = instructions + skillsList;
  }

  // Read existing instructions file or start empty
  await fs.mkdir(path.dirname(instructionsFilePath), { recursive: true });

  let content = "";
  try {
    content = await fs.readFile(instructionsFilePath, "utf-8");
  } catch {
    // File doesn't exist yet
  }

  // Insert or update managed block
  if (content.includes(BEGIN_MARKER)) {
    const regex = new RegExp(
      `${BEGIN_MARKER}\n[\\s\\S]*?\n${END_MARKER}\n?`,
      "g",
    );
    content = content.replace(
      regex,
      `${BEGIN_MARKER}\n${instructions}\n${END_MARKER}\n`,
    );
  } else {
    const section = `\n${BEGIN_MARKER}\n${instructions}\n${END_MARKER}\n`;
    content = content + section;
  }

  await fs.writeFile(instructionsFilePath, content);
};

/**
 * Check if a directory exists
 *
 * @param args - Function arguments
 * @param args.dirPath - Path to check
 *
 * @returns True if the path exists and is a directory
 */
const dirExists = async (args: { dirPath: string }): Promise<boolean> => {
  const { dirPath } = args;
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
};

/**
 * Install skills from the profile's skills directory into the agent's skills directory
 *
 * @param args - Function arguments
 * @param args.profileSkillsDir - Source skills directory in the profile
 * @param args.agentSkillsDir - Destination skills directory in the agent's dot dir
 * @param args.agentName - The target agent name for vocabulary translation
 * @param args.agentDotDir - Path to the agent's dot directory for template substitution
 */
const installSkills = async (args: {
  profileSkillsDir: string;
  agentSkillsDir: string;
  agentName: string;
  agentDotDir: string;
}): Promise<void> => {
  const { profileSkillsDir, agentSkillsDir, agentName, agentDotDir } = args;

  if (!(await dirExists({ dirPath: profileSkillsDir }))) {
    return;
  }

  // Remove and recreate agent skills dir
  await fs.rm(agentSkillsDir, { recursive: true, force: true });
  await fs.mkdir(agentSkillsDir, { recursive: true });

  // Read all entries in the skills directory
  const skillDirs = await fs.readdir(profileSkillsDir, {
    withFileTypes: true,
  });

  for (const entry of skillDirs) {
    if (!entry.isDirectory()) {
      continue;
    }

    const srcSkillDir = path.join(profileSkillsDir, entry.name);
    const destSkillDir = path.join(agentSkillsDir, entry.name);
    await fs.mkdir(destSkillDir, { recursive: true });

    await copyDirectoryContents({
      srcDir: srcSkillDir,
      destDir: destSkillDir,
      agentName,
      agentDotDir,
    });
  }
};

/**
 * Recursively copy directory contents, compiling .md files
 *
 * @param args - Function arguments
 * @param args.srcDir - Source directory to copy from
 * @param args.destDir - Destination directory to copy to
 * @param args.agentName - The target agent name for vocabulary translation
 * @param args.agentDotDir - Path to the agent's dot directory for template substitution
 */
const copyDirectoryContents = async (args: {
  srcDir: string;
  destDir: string;
  agentName: string;
  agentDotDir: string;
}): Promise<void> => {
  const { srcDir, destDir, agentName, agentDotDir } = args;

  const entries = await fs.readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await copyDirectoryContents({
        srcDir: srcPath,
        destDir: destPath,
        agentName,
        agentDotDir,
      });
    } else if (entry.name.endsWith(".md")) {
      const content = await fs.readFile(srcPath, "utf-8");
      const processed = compileAndSubstitute({
        content,
        agentName,
        agentDotDir,
      });
      await fs.writeFile(destPath, processed);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
};

/**
 * Install .md files from a profile subdirectory (subagents or slashcommands)
 * into the agent's corresponding directory
 *
 * @param args - Function arguments
 * @param args.srcDir - Source directory containing .md files
 * @param args.destDir - Destination directory in the agent's dot dir
 * @param args.agentName - The target agent name for vocabulary translation
 * @param args.agentDotDir - Path to the agent's dot directory for template substitution
 */
const installMdFiles = async (args: {
  srcDir: string;
  destDir: string;
  agentName: string;
  agentDotDir: string;
}): Promise<void> => {
  const { srcDir, destDir, agentName, agentDotDir } = args;

  if (!(await dirExists({ dirPath: srcDir }))) {
    return;
  }

  // Remove and recreate destination dir
  await fs.rm(destDir, { recursive: true, force: true });
  await fs.mkdir(destDir, { recursive: true });

  const entries = await fs.readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }

    // Skip docs.md
    if (entry.name.toLowerCase() === "docs.md") {
      continue;
    }

    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    const content = await fs.readFile(srcPath, "utf-8");
    const processed = compileAndSubstitute({
      content,
      agentName,
      agentDotDir,
    });
    await fs.writeFile(destPath, processed);
  }
};

/**
 * Install a canonical Nori profile into an agent's dot directory.
 *
 * @param args - Installation arguments
 * @param args.agentName - The target agent (e.g., "claude-code", "codex")
 * @param args.profileName - The profile name to install from .nori/profiles/
 * @param args.installDir - The project root directory
 */
export const installProfile = async (args: {
  agentName: string;
  profileName: string;
  installDir: string;
}): Promise<void> => {
  const { agentName, profileName, installDir } = args;

  const agentPaths = agentPathsMap[agentName];
  if (agentPaths == null) {
    throw new Error(
      `Unknown agent '${agentName}'. Supported agents: ${Object.keys(agentPathsMap).join(", ")}`,
    );
  }

  const agentDotDir = path.join(installDir, agentPaths.dotDirName);
  const instructionsFilePath = path.join(
    agentDotDir,
    agentPaths.instructionsFileName,
  );
  const agentSkillsDir = path.join(agentDotDir, agentPaths.skillsDirName);
  const agentAgentsDir = path.join(agentDotDir, agentPaths.agentsDirName);
  const agentCommandsDir = path.join(agentDotDir, agentPaths.commandsDirName);

  const profileDir = path.join(installDir, ".nori", "profiles", profileName);
  const profileSkillsDir = path.join(profileDir, "skills");
  const profileSubagentsDir = path.join(profileDir, "subagents");
  const profileCommandsDir = path.join(profileDir, "slashcommands");

  // Install instructions with managed block
  await installInstructions({
    profileDir,
    agentDotDir,
    instructionsFilePath,
    agentName,
    profileSkillsDir,
  });

  // Install skills
  await installSkills({
    profileSkillsDir,
    agentSkillsDir,
    agentName,
    agentDotDir,
  });

  // Install subagents
  await installMdFiles({
    srcDir: profileSubagentsDir,
    destDir: agentAgentsDir,
    agentName,
    agentDotDir,
  });

  // Install slash commands
  await installMdFiles({
    srcDir: profileCommandsDir,
    destDir: agentCommandsDir,
    agentName,
    agentDotDir,
  });
};
