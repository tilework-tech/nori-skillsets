/**
 * Profile metadata types and utilities
 */

import * as fs from "fs/promises";
import * as path from "path";

/**
 * Profile metadata from nori.json (unified manifest format)
 *
 * nori.json is the primary source of profile metadata.
 * Falls back to profile.json for backward compatibility with legacy profiles.
 */
export type ProfileMetadata = {
  /** Name of the profile */
  name: string;

  /** Semantic version (e.g., "1.0.0") */
  version?: string;

  /** Human-readable description */
  description?: string;

  /** License (e.g., "MIT", "Apache-2.0") */
  license?: string;

  /** Keywords for discoverability */
  keywords?: Array<string>;

  /** Repository information */
  repository?: {
    type: string;
    url: string;
  };

  /** Skill dependencies (skill name -> version range) */
  dependencies?: {
    skills?: Record<string, string>;
  };
};

/**
 * Read and parse profile metadata from a profile directory
 *
 * Reads from nori.json first, falls back to profile.json for backward compatibility.
 *
 * @param args - Function arguments
 * @param args.profileDir - Path to profile directory
 *
 * @returns Parsed profile metadata
 */
export const readProfileMetadata = async (args: {
  profileDir: string;
}): Promise<ProfileMetadata> => {
  const { profileDir } = args;

  // Try nori.json first (new format)
  const noriJsonPath = path.join(profileDir, "nori.json");
  try {
    const content = await fs.readFile(noriJsonPath, "utf-8");
    const metadata = JSON.parse(content) as ProfileMetadata;
    return metadata;
  } catch {
    // Fall back to profile.json (legacy format)
  }

  // Fallback to profile.json for backward compatibility
  const profileJsonPath = path.join(profileDir, "profile.json");
  const content = await fs.readFile(profileJsonPath, "utf-8");
  const metadata = JSON.parse(content) as ProfileMetadata;

  return metadata;
};

/**
 * Write profile metadata to nori.json in a profile directory
 *
 * @param args - Function arguments
 * @param args.profileDir - Path to profile directory
 * @param args.metadata - Profile metadata to write
 */
export const writeProfileMetadata = async (args: {
  profileDir: string;
  metadata: ProfileMetadata;
}): Promise<void> => {
  const { profileDir, metadata } = args;
  const noriJsonPath = path.join(profileDir, "nori.json");
  await fs.writeFile(noriJsonPath, JSON.stringify(metadata, null, 2));
};

/**
 * Add or update a skill dependency in a profile's nori.json
 *
 * If nori.json does not exist, creates a basic one using the profile directory
 * name as the profile name.
 *
 * @param args - Function arguments
 * @param args.profileDir - Path to profile directory
 * @param args.skillName - Name of the skill to add
 * @param args.version - Version string (e.g., "*", "^1.0.0", "1.2.3")
 */
export const addSkillToNoriJson = async (args: {
  profileDir: string;
  skillName: string;
  version: string;
}): Promise<void> => {
  const { profileDir, skillName, version } = args;
  const noriJsonPath = path.join(profileDir, "nori.json");

  let metadata: ProfileMetadata;
  try {
    const content = await fs.readFile(noriJsonPath, "utf-8");
    metadata = JSON.parse(content) as ProfileMetadata;
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      throw new Error(
        `nori.json exists but contains invalid JSON: ${err.message}`,
      );
    }
    // File does not exist -- create a basic one
    metadata = {
      name: path.basename(profileDir),
      version: "1.0.0",
    };
  }

  if (metadata.dependencies == null) {
    metadata.dependencies = {};
  }
  if (metadata.dependencies.skills == null) {
    metadata.dependencies.skills = {};
  }

  metadata.dependencies.skills[skillName] = version;

  await writeProfileMetadata({ profileDir, metadata });
};

/**
 * Check whether a directory looks like a profile (has CLAUDE.md, or both
 * skills/ and subagents/ subdirectories).
 *
 * @param args - Function arguments
 * @param args.profileDir - Path to the directory to check
 *
 * @returns True if the directory has profile markers
 */
const looksLikeProfile = async (args: {
  profileDir: string;
}): Promise<boolean> => {
  const { profileDir } = args;

  try {
    await fs.access(path.join(profileDir, "CLAUDE.md"));
    return true;
  } catch {
    // no CLAUDE.md — check for skills + subagents dirs
  }

  try {
    const [skillsStat, subagentsStat] = await Promise.all([
      fs.stat(path.join(profileDir, "skills")),
      fs.stat(path.join(profileDir, "subagents")),
    ]);
    return skillsStat.isDirectory() && subagentsStat.isDirectory();
  } catch {
    return false;
  }
};

/**
 * Ensure a nori.json manifest exists for a profile directory.
 *
 * If the directory exists and looks like a profile (has CLAUDE.md, or both
 * skills/ and subagents/ subdirectories) but has no nori.json, creates one
 * with the folder name as `name` and version "0.0.1".
 *
 * This is a backwards-compatibility shim for user-created skillsets that
 * were never given a nori.json manifest.
 *
 * @param args - Function arguments
 * @param args.profileDir - Path to profile directory
 */
export const ensureNoriJson = async (args: {
  profileDir: string;
}): Promise<void> => {
  const { profileDir } = args;
  const noriJsonPath = path.join(profileDir, "nori.json");

  try {
    await fs.access(noriJsonPath);
    return;
  } catch {
    // nori.json missing — check if we should create it
  }

  try {
    await fs.access(profileDir);
  } catch {
    return;
  }

  if (!(await looksLikeProfile({ profileDir }))) {
    return;
  }

  const metadata: ProfileMetadata = {
    name: path.basename(profileDir),
    version: "0.0.1",
  };
  await writeProfileMetadata({ profileDir, metadata });
};
