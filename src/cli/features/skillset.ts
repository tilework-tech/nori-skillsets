/**
 * Skillset type and parser
 * Explicitly describes the filesystem structure of a skillset package at ~/.nori/profiles/<name>/
 */

import * as fs from "fs/promises";
import * as path from "path";

import { getNoriSkillsetsDir } from "@/cli/features/paths.js";
import {
  ensureNoriJson,
  readSkillsetMetadata,
} from "@/cli/features/skillsetMetadata.js";

import type { NoriJson } from "@/norijson/nori.js";

/**
 * Represents a parsed skillset directory structure.
 * Content-agnostic: maps to filesystem paths, not file contents.
 */
export type Skillset = {
  /** Skillset name (from nori.json or directory basename) */
  name: string;
  /** Absolute path to the skillset directory */
  dir: string;
  /** Parsed nori.json contents */
  metadata: NoriJson;
  /** Path to skills/ subdirectory, or null if it doesn't exist */
  skillsDir: string | null;
  /** Path to the root config file (e.g. CLAUDE.md), or null if it doesn't exist */
  configFilePath: string | null;
  /** Path to slashcommands/ subdirectory, or null if it doesn't exist */
  slashcommandsDir: string | null;
  /** Path to subagents/ subdirectory, or null if it doesn't exist */
  subagentsDir: string | null;
};

/**
 * Check if a path exists and is a directory
 * @param args - Function arguments
 * @param args.dirPath - Absolute path to check
 *
 * @returns true if the path exists and is a directory
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
 * Check if a file exists
 * @param args - Function arguments
 * @param args.filePath - Absolute path to check
 *
 * @returns true if the file exists
 */
const fileExists = async (args: { filePath: string }): Promise<boolean> => {
  const { filePath } = args;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Parse a skillset directory into a Skillset object.
 *
 * Accepts either a skillsetName (resolved relative to ~/.nori/profiles/)
 * or a direct skillsetDir path.
 *
 * @param args - Either { skillsetName } or { skillsetDir }
 * @param args.skillsetName - Name of the skillset to resolve relative to ~/.nori/profiles/
 * @param args.skillsetDir - Direct absolute path to the skillset directory
 * @param args.configFileName - Override the root config filename (defaults to "CLAUDE.md")
 *
 * @throws Error if the directory doesn't exist or has no nori.json
 *
 * @returns Parsed Skillset object
 *
 */
export const parseSkillset = async (args: {
  skillsetName?: string | null;
  skillsetDir?: string | null;
  configFileName?: string | null;
}): Promise<Skillset> => {
  const { skillsetName, skillsetDir: explicitDir } = args;
  const configFileName = args.configFileName ?? "CLAUDE.md";

  const dir =
    explicitDir != null
      ? explicitDir
      : path.join(getNoriSkillsetsDir(), skillsetName!);

  // Verify the directory exists
  if (!(await dirExists({ dirPath: dir }))) {
    throw new Error(`Skillset directory not found: ${dir}`);
  }

  // Ensure nori.json exists (backwards compat for legacy skillsets)
  await ensureNoriJson({ skillsetDir: dir });

  // Read metadata — throws if nori.json still doesn't exist
  const metadata = await readSkillsetMetadata({ skillsetDir: dir });

  const name = metadata.name ?? path.basename(dir);

  // Check for optional components
  const skillsDirPath = path.join(dir, "skills");
  const configFileFullPath = path.join(dir, configFileName);
  const slashcommandsDirPath = path.join(dir, "slashcommands");
  const subagentsDirPath = path.join(dir, "subagents");

  const [hasSkills, hasConfigFile, hasSlashcommands, hasSubagents] =
    await Promise.all([
      dirExists({ dirPath: skillsDirPath }),
      fileExists({ filePath: configFileFullPath }),
      dirExists({ dirPath: slashcommandsDirPath }),
      dirExists({ dirPath: subagentsDirPath }),
    ]);

  return {
    name,
    dir,
    metadata,
    skillsDir: hasSkills ? skillsDirPath : null,
    configFilePath: hasConfigFile ? configFileFullPath : null,
    slashcommandsDir: hasSlashcommands ? slashcommandsDirPath : null,
    subagentsDir: hasSubagents ? subagentsDirPath : null,
  };
};
