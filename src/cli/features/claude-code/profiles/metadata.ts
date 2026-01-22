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
