/**
 * Managed folder utilities for profile discovery
 * Provides agent-agnostic profile listing from the .nori/profiles/ directory
 */

import * as fs from "fs/promises";
import * as path from "path";

import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";
import { ensureNoriJson } from "@/cli/features/claude-code/profiles/metadata.js";

/** Manifest file name used to identify valid profiles */
export const MANIFEST_FILE = "nori.json";

/**
 * List installed profiles from the .nori/profiles/ directory
 *
 * Discovers both flat profiles (e.g., "senior-swe") and namespaced profiles
 * (e.g., "myorg/my-profile"). A directory is considered a valid profile if it
 * contains a nori.json file.
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
        const entryDir = path.join(profilesDir, entry.name);
        await ensureNoriJson({ profileDir: entryDir });
        const instructionsPath = path.join(entryDir, MANIFEST_FILE);
        try {
          // Check if this is a flat profile (has nori.json directly)
          await fs.access(instructionsPath);
          profiles.push(entry.name);
        } catch {
          // Not a flat profile - check if it's an org directory with nested profiles
          // Org directories contain subdirectories with nori.json files
          try {
            const orgDir = path.join(profilesDir, entry.name);
            const subEntries = await fs.readdir(orgDir, {
              withFileTypes: true,
            });

            for (const subEntry of subEntries) {
              if (subEntry.isDirectory()) {
                const nestedDir = path.join(orgDir, subEntry.name);
                await ensureNoriJson({ profileDir: nestedDir });
                const nestedInstructionsPath = path.join(
                  nestedDir,
                  MANIFEST_FILE,
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
