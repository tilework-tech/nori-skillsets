/**
 * Skillset path utilities, type, parser, and discovery
 *
 * Provides agent-agnostic path helpers, the Skillset type describing a parsed
 * skillset directory, the parseSkillset parser, and listSkillsets for discovery.
 */

import * as fs from "fs/promises";
import * as path from "path";

import {
  ensureNoriJson,
  looksLikeSkillset,
  readSkillsetMetadata,
  type NoriJson,
} from "@/norijson/nori.js";
import { isDirentDirectory } from "@/utils/dirent.js";
import { getHomeDir } from "@/utils/home.js";

/**
 * Get the Nori directory path
 * Always returns ~/.nori (centralized location)
 *
 * @returns Absolute path to the .nori directory
 */
export const getNoriDir = (): string => {
  return path.join(getHomeDir(), ".nori");
};

/**
 * Get the Nori skillsets directory path
 * This is where all skillset templates are stored
 *
 * @returns Absolute path to the skillsets directory (~/.nori/profiles/)
 */
export const getNoriSkillsetsDir = (): string => {
  return path.join(getNoriDir(), "profiles");
};

/** Manifest file name used to identify valid skillsets */
export const MANIFEST_FILE = "nori.json";

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
  /** Path to the root config file (e.g. AGENTS.md), or null if it doesn't exist */
  configFilePath: string | null;
  /** Path to slashcommands/ subdirectory, or null if it doesn't exist */
  slashcommandsDir: string | null;
  /** Path to subagents/ subdirectory, or null if it doesn't exist */
  subagentsDir: string | null;
  /** Path to mcp/ subdirectory, or null if it doesn't exist */
  mcpDir: string | null;
};

/**
 * Check if a path exists and is a directory
 * @param args - Function arguments
 * @param args.dirPath - The path to check
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
 * Check if a file exists
 * @param args - Function arguments
 * @param args.filePath - The path to check
 *
 * @returns True if the file exists
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
 *
 * @throws Error if the directory doesn't exist or has no nori.json
 *
 * @returns Parsed Skillset object
 */
export const parseSkillset = async (args: {
  skillsetName?: string | null;
  skillsetDir?: string | null;
}): Promise<Skillset> => {
  const { skillsetName, skillsetDir: explicitDir } = args;
  const configFileNames = ["AGENTS.md", "CLAUDE.md"];

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
  const slashcommandsDirPath = path.join(dir, "slashcommands");
  const subagentsDirPath = path.join(dir, "subagents");
  const mcpDirPath = path.join(dir, "mcp");

  // Find config file: prefer AGENTS.md, fall back to CLAUDE.md
  let resolvedConfigFilePath: string | null = null;
  for (const fileName of configFileNames) {
    const candidate = path.join(dir, fileName);
    if (await fileExists({ filePath: candidate })) {
      resolvedConfigFilePath = candidate;
      break;
    }
  }

  const [hasSkills, hasSlashcommands, hasSubagents, hasMcp] = await Promise.all(
    [
      dirExists({ dirPath: skillsDirPath }),
      dirExists({ dirPath: slashcommandsDirPath }),
      dirExists({ dirPath: subagentsDirPath }),
      dirExists({ dirPath: mcpDirPath }),
    ],
  );

  return {
    name,
    dir,
    metadata,
    skillsDir: hasSkills ? skillsDirPath : null,
    configFilePath: resolvedConfigFilePath,
    slashcommandsDir: hasSlashcommands ? slashcommandsDirPath : null,
    subagentsDir: hasSubagents ? subagentsDirPath : null,
    mcpDir: hasMcp ? mcpDirPath : null,
  };
};

/**
 * List installed skillsets from the .nori/profiles/ directory
 *
 * Discovers both flat skillsets (e.g., "senior-swe") and namespaced skillsets
 * (e.g., "myorg/my-skillset"). A directory is considered a valid skillset if it
 * contains a nori.json file.
 *
 * @returns Sorted array of skillset names
 */
export type SkillsetEntry = {
  name: string;
  isLinked: boolean;
};

/**
 * Check whether a directory is a skillset without writing to it: it either
 * carries a nori.json or looks like a legacy skillset (config file or
 * skills/+subagents/). Listing is a read and must never mutate profiles.
 *
 * @param args - Function arguments
 * @param args.skillsetDir - Directory to check
 *
 * @returns True when the directory is a skillset
 */
const isSkillsetDir = async (args: {
  skillsetDir: string;
}): Promise<boolean> => {
  const { skillsetDir } = args;
  try {
    await fs.access(path.join(skillsetDir, MANIFEST_FILE));
    return true;
  } catch {
    return looksLikeSkillset({ skillsetDir });
  }
};

/**
 * List installed skillsets with metadata (linked status).
 *
 * Discovers both flat skillsets and namespaced skillsets.
 * Reports whether each entry is a symlink (linked) or a real directory.
 *
 * @returns Sorted array of skillset entries with metadata
 */
export const listSkillsetsWithMetadata = async (): Promise<
  Array<SkillsetEntry>
> => {
  const skillsetsDir = getNoriSkillsetsDir();
  const skillsets: Array<SkillsetEntry> = [];

  try {
    await fs.access(skillsetsDir);
    const entries = await fs.readdir(skillsetsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!(await isDirentDirectory({ parentDir: skillsetsDir, entry })))
        continue;

      const isLinked = entry.isSymbolicLink();
      const entryDir = path.join(skillsetsDir, entry.name);
      if (await isSkillsetDir({ skillsetDir: entryDir })) {
        skillsets.push({ name: entry.name, isLinked });
        continue;
      }

      // Not a skillset itself — treat as an org directory of nested skillsets
      try {
        const subEntries = await fs.readdir(entryDir, {
          withFileTypes: true,
        });

        for (const subEntry of subEntries) {
          if (
            !(await isDirentDirectory({ parentDir: entryDir, entry: subEntry }))
          )
            continue;

          const isSubLinked = subEntry.isSymbolicLink();
          const nestedDir = path.join(entryDir, subEntry.name);
          if (await isSkillsetDir({ skillsetDir: nestedDir })) {
            skillsets.push({
              name: `${entry.name}/${subEntry.name}`,
              isLinked: isLinked || isSubLinked,
            });
          }
        }
      } catch {
        // Skip directories that can't be read
      }
    }
  } catch {
    // Skillsets directory doesn't exist
  }

  return skillsets.sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * List installed skillsets from the .nori/profiles/ directory
 *
 * Discovers both flat skillsets (e.g., "senior-swe") and namespaced skillsets
 * (e.g., "myorg/my-skillset"). A directory is considered a valid skillset if it
 * contains a nori.json file.
 *
 * @returns Sorted array of skillset names
 */
export const listSkillsets = async (): Promise<Array<string>> => {
  const entries = await listSkillsetsWithMetadata();
  return entries.map((e) => e.name);
};
