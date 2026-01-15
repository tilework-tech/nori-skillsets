/**
 * Skill resolution functionality
 * Handles parsing skills.json and resolving skill versions
 */

import * as fs from "fs/promises";
import * as path from "path";

import * as semver from "semver";

import { getNoriSkillDir } from "@/cli/features/claude-code/paths.js";

/**
 * Skills.json format - maps skill name to version range or object with version
 */
export type SkillsJson = Record<string, string | { version: string }>;

/**
 * Parsed skill dependency with name and version range
 */
export type ParsedSkillDependency = {
  name: string;
  versionRange: string;
};

/**
 * Parse skills.json content into array of skill dependencies
 *
 * @param args - Arguments
 * @param args.skillsJson - The parsed skills.json content
 *
 * @returns Array of parsed skill dependencies
 */
export const parseSkillsJson = (args: {
  skillsJson: SkillsJson;
}): Array<ParsedSkillDependency> => {
  const { skillsJson } = args;
  const result: Array<ParsedSkillDependency> = [];

  for (const [name, value] of Object.entries(skillsJson)) {
    if (typeof value === "string") {
      result.push({ name, versionRange: value });
    } else if (typeof value === "object" && value.version != null) {
      result.push({ name, versionRange: value.version });
    }
  }

  return result;
};

/**
 * Read and parse skills.json from a profile directory
 *
 * @param args - Arguments
 * @param args.profileDir - Path to the profile directory
 *
 * @returns Array of parsed skill dependencies, or null if skills.json doesn't exist
 */
export const readSkillsJson = async (args: {
  profileDir: string;
}): Promise<Array<ParsedSkillDependency> | null> => {
  const { profileDir } = args;
  const skillsJsonPath = path.join(profileDir, "skills.json");

  try {
    const content = await fs.readFile(skillsJsonPath, "utf-8");
    const skillsJson = JSON.parse(content) as SkillsJson;
    return parseSkillsJson({ skillsJson });
  } catch (err) {
    // File doesn't exist - return null
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    // JSON parse error or other error - rethrow
    throw err;
  }
};

/**
 * Resolve a version range to a specific version from available versions
 *
 * @param args - Arguments
 * @param args.versionRange - Semver version range (e.g., "^1.0.0", "~1.0.0", "*")
 * @param args.availableVersions - Array of available version strings
 *
 * @returns The best matching version, or null if no match found
 */
export const resolveSkillVersion = (args: {
  versionRange: string;
  availableVersions: Array<string>;
}): string | null => {
  const { versionRange, availableVersions } = args;

  if (availableVersions.length === 0) {
    return null;
  }

  // Sort versions in descending order to get highest matching version
  const sortedVersions = availableVersions
    .filter((v) => semver.valid(v))
    .sort((a, b) => semver.rcompare(a, b));

  if (sortedVersions.length === 0) {
    return null;
  }

  // Wildcard means latest
  if (versionRange === "*") {
    return sortedVersions[0];
  }

  // Find highest version that satisfies the range
  for (const version of sortedVersions) {
    if (semver.satisfies(version, versionRange)) {
      return version;
    }
  }

  return null;
};

/**
 * Check if a skill is installed in the Nori skills directory
 *
 * @param args - Arguments
 * @param args.installDir - Installation directory
 * @param args.skillName - Name of the skill
 *
 * @returns True if the skill is installed with a valid SKILL.md
 */
export const isSkillInstalled = async (args: {
  installDir: string;
  skillName: string;
}): Promise<boolean> => {
  const { installDir, skillName } = args;
  const skillDir = getNoriSkillDir({ installDir, skillName });
  const skillMdPath = path.join(skillDir, "SKILL.md");

  try {
    await fs.access(skillMdPath);
    return true;
  } catch {
    return false;
  }
};
