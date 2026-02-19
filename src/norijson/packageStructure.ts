/**
 * Skillset package type definitions
 *
 * Defines the in-memory representation of a loaded skillset package.
 * This is the type contract that loaders consume — if you add a new
 * component to a skillset, TypeScript will flag every place that needs
 * updating.
 */

import * as fs from "fs/promises";
import * as path from "path";

/**
 * A skill directory entry within a skillset.
 */
export type SkillEntry = {
  /** Skill directory name (e.g., "systematic-debugging") */
  id: string;
  /** Absolute path to the skill directory on disk */
  sourceDir: string;
};

/**
 * A markdown file entry (used for subagents and slash commands).
 */
export type MdFileEntry = {
  /** Filename (e.g., "nori-code-reviewer.md") */
  filename: string;
  /** Raw file content */
  content: string;
};

/**
 * The in-memory representation of a loaded skillset package.
 *
 * This type represents everything a skillset contains after being read
 * from disk. Loaders receive this type (or slices of it) instead of
 * reading from the filesystem themselves.
 */
export type SkillsetPackage = {
  /** Raw CLAUDE.md content, or null if the profile has no CLAUDE.md */
  claudeMd: string | null;
  /** Skill directories found in skills/ */
  skills: Array<SkillEntry>;
  /** Subagent .md files found in subagents/ (excludes docs.md) */
  subagents: Array<MdFileEntry>;
  /** Slash command .md files found in slashcommands/ (excludes docs.md) */
  slashcommands: Array<MdFileEntry>;
};

/**
 * Read .md files from a directory, excluding docs.md.
 *
 * @param args - Function arguments
 * @param args.dirPath - Absolute path to the directory
 *
 * @returns Array of MdFileEntry objects, or empty array if directory is missing
 */
const readMdFiles = async (args: {
  dirPath: string;
}): Promise<Array<MdFileEntry>> => {
  const { dirPath } = args;

  let files: Array<string>;
  try {
    files = await fs.readdir(dirPath);
  } catch {
    return [];
  }

  const mdFiles = files.filter(
    (file) => file.endsWith(".md") && file !== "docs.md",
  );

  const entries: Array<MdFileEntry> = [];
  for (const filename of mdFiles) {
    const content = await fs.readFile(path.join(dirPath, filename), "utf-8");
    entries.push({ filename, content });
  }

  return entries;
};

/**
 * Load a skillset package from a profile directory.
 *
 * Reads the profile directory structure and returns an in-memory
 * representation of the skillset contents.
 *
 * @param args - Function arguments
 * @param args.profileDir - Absolute path to the profile directory
 *
 * @returns The loaded skillset package
 */
export const loadSkillsetPackage = async (args: {
  profileDir: string;
}): Promise<SkillsetPackage> => {
  const { profileDir } = args;

  // Read CLAUDE.md
  let claudeMd: string | null = null;
  try {
    claudeMd = await fs.readFile(path.join(profileDir, "CLAUDE.md"), "utf-8");
  } catch {
    // No CLAUDE.md in this profile
  }

  // Read skills directories
  const skills: Array<SkillEntry> = [];
  const skillsDir = path.join(profileDir, "skills");
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        skills.push({
          id: entry.name,
          sourceDir: path.join(skillsDir, entry.name),
        });
      }
    }
  } catch {
    // No skills directory
  }

  // Read subagents
  const subagents = await readMdFiles({
    dirPath: path.join(profileDir, "subagents"),
  });

  // Read slashcommands
  const slashcommands = await readMdFiles({
    dirPath: path.join(profileDir, "slashcommands"),
  });

  return { claudeMd, skills, subagents, slashcommands };
};
