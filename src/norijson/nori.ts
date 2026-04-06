/**
 * Unified manifest types and operations for Nori skillsets and skills
 *
 * The nori.json format is used by both skillsets and skills.
 * This module provides type definitions and read/write utilities.
 */

import * as fs from "fs/promises";
import * as path from "path";

/**
 * Skillset content type definitions
 * These types represent the inlined content discovered from a skillset directory.
 */

export type SkillsetSkill = {
  id: string; // directory name
  name: string; // from SKILL.md frontmatter
  description: string; // from SKILL.md frontmatter
  scripts?: Array<string> | null; // list of script filenames (e.g., ["script.ts", "setup.sh"])
};

export type SkillsetSlashCommand = {
  command: string; // e.g., "nori-debug" (without slash prefix)
  description: string; // from .md frontmatter
};

export type SkillsetSubagent = {
  id: string; // directory name or filename without extension
  name: string; // from frontmatter
  description: string; // from frontmatter
  scripts?: Array<string> | null; // list of script filenames
};

/**
 * The type of package this nori.json represents
 */
export type NoriJsonType =
  | "skillset"
  | "skill"
  | "inlined-skill"
  | "subagent"
  | "inlined-subagent";

/**
 * Dependencies section of nori.json
 */
export type NoriJsonDependencies = {
  skills?: Record<string, string> | null; // skill name -> version range
  subagents?: Record<string, string> | null; // subagent name -> version range
  slashCommands?: Record<string, string> | null; // future use
};

/**
 * The unified nori.json manifest format
 *
 * This type serves as the single manifest type for both skillsets and skills.
 * - name and version are required
 * - Skillset content (skills, subagents, slashcommands) are optional top-level fields
 * - Skill-specific content (scripts) is an optional top-level field
 */
export type NoriJson = {
  name: string;
  version: string;
  author?: string | null;
  description?: string | null;
  license?: string | null;
  keywords?: Array<string> | null;
  repository?: string | null;
  dependencies?: NoriJsonDependencies | null;
  // Skillset content (inlined at top level)
  skills?: Array<SkillsetSkill> | null;
  subagents?: Array<SkillsetSubagent> | null;
  slashcommands?: Array<SkillsetSlashCommand> | null;
  // Skill content
  scripts?: Array<string> | null;
  // Package type
  type?: NoriJsonType | null;
  // Server-set metadata
  registryURL?: string | null;
  [key: string]: unknown; // Allow additional fields
};

/**
 * Read and parse skillset metadata from a skillset directory
 *
 * Reads from nori.json.
 *
 * @param args - Function arguments
 * @param args.skillsetDir - Path to skillset directory
 *
 * @returns Parsed skillset metadata
 */
export const readSkillsetMetadata = async (args: {
  skillsetDir: string;
}): Promise<NoriJson> => {
  const { skillsetDir } = args;

  const noriJsonPath = path.join(skillsetDir, "nori.json");
  const content = await fs.readFile(noriJsonPath, "utf-8");
  const metadata = JSON.parse(content) as NoriJson;
  return metadata;
};

/**
 * Write skillset metadata to nori.json in a skillset directory
 *
 * @param args - Function arguments
 * @param args.skillsetDir - Path to skillset directory
 * @param args.metadata - Skillset metadata to write
 */
export const writeSkillsetMetadata = async (args: {
  skillsetDir: string;
  metadata: NoriJson;
}): Promise<void> => {
  const { skillsetDir, metadata } = args;
  const noriJsonPath = path.join(skillsetDir, "nori.json");
  await fs.writeFile(noriJsonPath, JSON.stringify(metadata, null, 2));
};

/**
 * Add or update a skill dependency in a skillset's nori.json
 *
 * If nori.json does not exist, creates a basic one using the skillset directory
 * name as the skillset name.
 *
 * @param args - Function arguments
 * @param args.skillsetDir - Path to skillset directory
 * @param args.skillName - Name of the skill to add
 * @param args.version - Version string (e.g., "*", "^1.0.0", "1.2.3")
 */
export const addSkillToNoriJson = async (args: {
  skillsetDir: string;
  skillName: string;
  version: string;
}): Promise<void> => {
  const { skillsetDir, skillName, version } = args;
  const noriJsonPath = path.join(skillsetDir, "nori.json");

  let metadata: NoriJson;
  try {
    const content = await fs.readFile(noriJsonPath, "utf-8");
    metadata = JSON.parse(content) as NoriJson;
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      throw new Error(
        `nori.json exists but contains invalid JSON: ${err.message}`,
      );
    }
    // File does not exist -- create a basic one
    metadata = {
      name: path.basename(skillsetDir),
      version: "1.0.0",
      type: "skillset",
    };
  }

  if (metadata.dependencies == null) {
    metadata.dependencies = {};
  }
  if (metadata.dependencies.skills == null) {
    metadata.dependencies.skills = {};
  }

  metadata.dependencies.skills[skillName] = version;

  await writeSkillsetMetadata({ skillsetDir, metadata });
};

/**
 * Add or update a subagent dependency in a skillset's nori.json
 *
 * If nori.json does not exist, creates a basic one using the skillset directory
 * name as the skillset name.
 *
 * @param args - Function arguments
 * @param args.skillsetDir - Path to skillset directory
 * @param args.subagentName - Name of the subagent to add
 * @param args.version - Version string (e.g., "*", "^1.0.0", "1.2.3")
 */
export const addSubagentToNoriJson = async (args: {
  skillsetDir: string;
  subagentName: string;
  version: string;
}): Promise<void> => {
  const { skillsetDir, subagentName, version } = args;
  const noriJsonPath = path.join(skillsetDir, "nori.json");

  let metadata: NoriJson;
  try {
    const content = await fs.readFile(noriJsonPath, "utf-8");
    metadata = JSON.parse(content) as NoriJson;
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      throw new Error(
        `nori.json exists but contains invalid JSON: ${err.message}`,
      );
    }
    metadata = {
      name: path.basename(skillsetDir),
      version: "1.0.0",
      type: "skillset",
    };
  }

  if (metadata.dependencies == null) {
    metadata.dependencies = {};
  }
  if (metadata.dependencies.subagents == null) {
    metadata.dependencies.subagents = {};
  }

  metadata.dependencies.subagents[subagentName] = version;

  await writeSkillsetMetadata({ skillsetDir, metadata });
};

/**
 * Check whether a directory looks like a skillset (has a known config file, or both
 * skills/ and subagents/ subdirectories).
 *
 * @param args - Function arguments
 * @param args.skillsetDir - Path to the directory to check
 * @param args.configFileNames - Config file names to look for (defaults to ["CLAUDE.md"])
 *
 * @returns True if the directory has skillset markers
 */
const looksLikeSkillset = async (args: {
  skillsetDir: string;
  configFileNames?: Array<string> | null;
}): Promise<boolean> => {
  const { skillsetDir } = args;
  const configFileNames = args.configFileNames ?? ["CLAUDE.md"];

  for (const fileName of configFileNames) {
    try {
      await fs.access(path.join(skillsetDir, fileName));
      return true;
    } catch {
      // file not found — try next
    }
  }

  try {
    const [skillsStat, subagentsStat] = await Promise.all([
      fs.stat(path.join(skillsetDir, "skills")),
      fs.stat(path.join(skillsetDir, "subagents")),
    ]);
    return skillsStat.isDirectory() && subagentsStat.isDirectory();
  } catch {
    return false;
  }
};

/**
 * Ensure a nori.json manifest exists for a skillset directory.
 *
 * If the directory exists and looks like a skillset (has a known config file,
 * or both skills/ and subagents/ subdirectories) but has no nori.json, creates
 * one with the folder name as `name` and version "0.0.1".
 *
 * This is a backwards-compatibility shim for user-created skillsets that
 * were never given a nori.json manifest.
 *
 * @param args - Function arguments
 * @param args.skillsetDir - Path to skillset directory
 * @param args.configFileNames - Config file names to look for (defaults to ["CLAUDE.md"])
 */
export const ensureNoriJson = async (args: {
  skillsetDir: string;
  configFileNames?: Array<string> | null;
}): Promise<void> => {
  const { skillsetDir, configFileNames } = args;
  const noriJsonPath = path.join(skillsetDir, "nori.json");

  try {
    await fs.access(noriJsonPath);
    return;
  } catch {
    // nori.json missing — check if we should create it
  }

  try {
    await fs.access(skillsetDir);
  } catch {
    return;
  }

  if (!(await looksLikeSkillset({ skillsetDir, configFileNames }))) {
    return;
  }

  const metadata: NoriJson = {
    name: path.basename(skillsetDir),
    version: "0.0.1",
    type: "skillset",
  };
  await writeSkillsetMetadata({ skillsetDir, metadata });
};
