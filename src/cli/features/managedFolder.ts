/**
 * Managed folder utilities for profile discovery
 * Provides agent-agnostic profile listing from the .nori/profiles/ directory
 */

import * as fs from "fs/promises";
import * as path from "path";

import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";

/** Instructions file name used to identify valid profiles */
export const INSTRUCTIONS_FILE = "CLAUDE.md";

/**
 * List installed profiles from the .nori/profiles/ directory
 *
 * Discovers both flat profiles (e.g., "senior-swe") and namespaced profiles
 * (e.g., "myorg/my-profile"). A directory is considered a valid profile if it
 * contains a CLAUDE.md file.
 *
 * @returns Sorted array of profile names
 */
export const listProfiles = async (): Promise<Array<string>> => {
  const profilesDir = getNoriProfilesDir();
  const profiles: Array<string> = [];

  try {
    await fs.access(profilesDir);
    const entries = await fs.readdir(profilesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const instructionsPath = path.join(
          profilesDir,
          entry.name,
          INSTRUCTIONS_FILE,
        );
        try {
          // Check if this is a flat profile (has CLAUDE.md directly)
          await fs.access(instructionsPath);
          profiles.push(entry.name);
        } catch {
          // Not a flat profile - check if it's an org directory with nested profiles
          // Org directories contain subdirectories with CLAUDE.md files
          try {
            const orgDir = path.join(profilesDir, entry.name);
            const subEntries = await fs.readdir(orgDir, {
              withFileTypes: true,
            });

            for (const subEntry of subEntries) {
              if (subEntry.isDirectory()) {
                const nestedInstructionsPath = path.join(
                  orgDir,
                  subEntry.name,
                  INSTRUCTIONS_FILE,
                );
                try {
                  await fs.access(nestedInstructionsPath);
                  // Found a nested profile - use org/profile format
                  profiles.push(`${entry.name}/${subEntry.name}`);
                } catch {
                  // Skip subdirectories without instructions file
                }
              }
            }
          } catch {
            // Skip directories that can't be read
          }
        }
      }
    }
  } catch {
    // Profiles directory doesn't exist
  }

  return profiles.sort();
};
