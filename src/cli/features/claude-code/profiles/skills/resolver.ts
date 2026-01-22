/**
 * Skill resolution functionality
 * Handles parsing skills.json and resolving skill versions
 */

import * as fs from "fs/promises";
import * as path from "path";

import * as semver from "semver";

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
 * Write skills.json to a profile directory
 *
 * @param args - Arguments
 * @param args.profileDir - Path to the profile directory
 * @param args.dependencies - Array of skill dependencies to write
 */
export const writeSkillsJson = async (args: {
  profileDir: string;
  dependencies: Array<ParsedSkillDependency>;
}): Promise<void> => {
  const { profileDir, dependencies } = args;
  const skillsJsonPath = path.join(profileDir, "skills.json");

  // Convert array back to SkillsJson object format
  const skillsJson: SkillsJson = {};
  for (const dep of dependencies) {
    skillsJson[dep.name] = dep.versionRange;
  }

  await fs.writeFile(skillsJsonPath, JSON.stringify(skillsJson, null, 2));
};

/**
 * Add or update a skill dependency in a profile's skills.json
 *
 * @param args - Arguments
 * @param args.profileDir - Path to the profile directory
 * @param args.skillName - Name of the skill to add
 * @param args.version - Version string (e.g., "*", "^1.0.0", "1.2.3")
 */
export const addSkillDependency = async (args: {
  profileDir: string;
  skillName: string;
  version: string;
}): Promise<void> => {
  const { profileDir, skillName, version } = args;

  // Read existing skills.json or start with empty array
  let dependencies = await readSkillsJson({ profileDir });
  if (dependencies == null) {
    dependencies = [];
  }

  // Check if skill already exists
  const existingIndex = dependencies.findIndex((dep) => dep.name === skillName);
  if (existingIndex >= 0) {
    // Update existing entry
    dependencies[existingIndex].versionRange = version;
  } else {
    // Add new entry
    dependencies.push({ name: skillName, versionRange: version });
  }

  await writeSkillsJson({ profileDir, dependencies });
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
