/**
 * Profile metadata types and utilities
 */

import * as fs from "fs/promises";
import * as path from "path";

/**
 * Per-mixin configuration (empty for now, allows future expansion)
 */
export type MixinConfig = Record<string, never>;

/**
 * Profile metadata from profile.json
 */
export type ProfileMetadata = {
  /** Name of the profile */
  name: string;

  /** Human-readable description */
  description: string;

  /** Mixins to compose this profile from */
  mixins: Record<string, MixinConfig>;
};

/**
 * Read and parse profile.json from a profile directory
 * @param args - Function arguments
 * @param args.profileDir - Path to profile directory
 *
 * @returns Parsed profile metadata
 */
export const readProfileMetadata = async (args: {
  profileDir: string;
}): Promise<ProfileMetadata> => {
  const { profileDir } = args;
  const profileJsonPath = path.join(profileDir, "profile.json");

  const content = await fs.readFile(profileJsonPath, "utf-8");
  const metadata = JSON.parse(content) as ProfileMetadata;

  return metadata;
};
