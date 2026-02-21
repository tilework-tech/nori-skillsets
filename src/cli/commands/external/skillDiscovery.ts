/**
 * Skill discovery for cloned GitHub repositories
 *
 * Searches for SKILL.md files and parses their YAML frontmatter
 * to identify valid skills within a cloned repo.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { AgentRegistry } from "@/cli/features/agentRegistry.js";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
]);

const MAX_RECURSIVE_DEPTH = 5;

/**
 * Discovered skill information
 */
export type DiscoveredSkill = {
  name: string;
  description: string;
  dirPath: string;
  rawContent: string;
};

/**
 * Parsed frontmatter from a SKILL.md file
 */
type ParsedFrontmatter = {
  name: string;
  description: string;
};

/**
 * Parse YAML frontmatter from a SKILL.md file to extract name and description.
 *
 * Uses regex parsing to avoid adding a gray-matter dependency.
 * Handles both quoted and unquoted values.
 *
 * @param args - The function arguments
 * @param args.content - The raw SKILL.md content
 *
 * @returns Parsed name and description, or null if invalid
 */
export const parseSkillFrontmatter = (args: {
  content: string;
}): ParsedFrontmatter | null => {
  const { content } = args;

  // Match frontmatter block between --- delimiters
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (frontmatterMatch == null) {
    return null;
  }

  const frontmatter = frontmatterMatch[1];

  // Extract name (handles quoted and unquoted values)
  const nameMatch = frontmatter.match(
    /^name:\s*(?:"([^"]*?)"|'([^']*?)'|(.+?))\s*$/m,
  );
  if (nameMatch == null) {
    return null;
  }
  const name = nameMatch[1] ?? nameMatch[2] ?? nameMatch[3];

  // Extract description (handles quoted and unquoted values)
  const descMatch = frontmatter.match(
    /^description:\s*(?:"([^"]*?)"|'([^']*?)'|(.+?))\s*$/m,
  );
  if (descMatch == null) {
    return null;
  }
  const description = descMatch[1] ?? descMatch[2] ?? descMatch[3];

  if (name == null || description == null) {
    return null;
  }

  return { name: name.trim(), description: description.trim() };
};

/**
 * Check if a directory contains a SKILL.md file
 * @param args - The function arguments
 * @param args.dir - Directory path to check
 *
 * @returns True if the directory contains a SKILL.md file
 */
const hasSkillMd = async (args: { dir: string }): Promise<boolean> => {
  const { dir } = args;
  try {
    const skillPath = path.join(dir, "SKILL.md");
    const stats = await fs.stat(skillPath);
    return stats.isFile();
  } catch {
    return false;
  }
};

/**
 * Parse a SKILL.md file at the given directory path
 * @param args - The function arguments
 * @param args.dir - Directory containing the SKILL.md file
 *
 * @returns Parsed skill or null if invalid
 */
const parseSkillAt = async (args: {
  dir: string;
}): Promise<DiscoveredSkill | null> => {
  const { dir } = args;
  try {
    const skillPath = path.join(dir, "SKILL.md");
    const content = await fs.readFile(skillPath, "utf-8");
    const parsed = parseSkillFrontmatter({ content });
    if (parsed == null) {
      return null;
    }
    return {
      name: parsed.name,
      description: parsed.description,
      dirPath: dir,
      rawContent: content,
    };
  } catch {
    return null;
  }
};

/**
 * Recursively find directories containing SKILL.md files
 * @param args - The function arguments
 * @param args.dir - Directory to search from
 * @param args.depth - Current recursion depth
 *
 * @returns Array of directory paths containing SKILL.md files
 */
const findSkillDirsRecursive = async (args: {
  dir: string;
  depth?: number | null;
}): Promise<Array<string>> => {
  const { dir } = args;
  const depth = args.depth ?? 0;

  if (depth > MAX_RECURSIVE_DEPTH) {
    return [];
  }

  try {
    const results: Array<string> = [];

    if (await hasSkillMd({ dir })) {
      results.push(dir);
    }

    const entries = await fs.readdir(dir, { withFileTypes: true });
    const subResults = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name))
        .map((entry) =>
          findSkillDirsRecursive({
            dir: path.join(dir, entry.name),
            depth: depth + 1,
          }),
        ),
    );

    return [...results, ...subResults.flat()];
  } catch {
    return [];
  }
};

/**
 * Discover skills within a cloned repository
 *
 * Searches in priority order:
 * 1. Root directory (if it has SKILL.md)
 * 2. Standard subdirectories: skills/, .claude/skills/
 * 3. Recursive fallback (up to 5 levels deep)
 *
 * Deduplicates by skill name.
 *
 * @param args - The function arguments
 * @param args.basePath - Root path of the cloned repository
 * @param args.subpath - Optional subpath to search within
 *
 * @returns Array of discovered skills
 */
export const discoverSkills = async (args: {
  basePath: string;
  subpath?: string | null;
}): Promise<Array<DiscoveredSkill>> => {
  const { basePath } = args;
  const searchPath =
    args.subpath != null ? path.join(basePath, args.subpath) : basePath;

  const skills: Array<DiscoveredSkill> = [];
  const seenNames = new Set<string>();

  const addSkill = (skill: DiscoveredSkill): void => {
    if (!seenNames.has(skill.name)) {
      skills.push(skill);
      seenNames.add(skill.name);
    }
  };

  // 1. Check root for SKILL.md
  if (await hasSkillMd({ dir: searchPath })) {
    const skill = await parseSkillAt({ dir: searchPath });
    if (skill != null) {
      addSkill(skill);
      return skills;
    }
  }

  // 2. Search standard directories (skills/ + agent-specific skill directories)
  const agentSkillDirs = AgentRegistry.getInstance()
    .getAll()
    .flatMap((agent) =>
      agent.getSkillDiscoveryDirs().map((dir) => path.join(searchPath, dir)),
    );
  const priorityDirs = [path.join(searchPath, "skills"), ...agentSkillDirs];

  for (const dir of priorityDirs) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillDir = path.join(dir, entry.name);
          if (await hasSkillMd({ dir: skillDir })) {
            const skill = await parseSkillAt({ dir: skillDir });
            if (skill != null) {
              addSkill(skill);
            }
          }
        }
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  // 3. If nothing found, recursive fallback
  if (skills.length === 0) {
    const allDirs = await findSkillDirsRecursive({ dir: searchPath });
    for (const dir of allDirs) {
      const skill = await parseSkillAt({ dir });
      if (skill != null) {
        addSkill(skill);
      }
    }
  }

  return skills;
};
