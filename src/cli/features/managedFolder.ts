/**
 * Managed folder utilities for skillset discovery
 * Provides agent-agnostic skillset listing from the .nori/profiles/ directory
 */

import * as fs from "fs/promises";
import * as path from "path";

import { getNoriSkillsetsDir } from "@/cli/features/claude-code/paths.js";
import { ensureNoriJson } from "@/cli/features/claude-code/skillsets/metadata.js";

/** Manifest file name used to identify valid skillsets */
export const MANIFEST_FILE = "nori.json";

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
  const skillsetsDir = getNoriSkillsetsDir();
  const skillsets: Array<string> = [];

  try {
    await fs.access(skillsetsDir);
    const entries = await fs.readdir(skillsetsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const entryDir = path.join(skillsetsDir, entry.name);
        await ensureNoriJson({ skillsetDir: entryDir });
        const instructionsPath = path.join(entryDir, MANIFEST_FILE);
        try {
          // Check if this is a flat skillset (has nori.json directly)
          await fs.access(instructionsPath);
          skillsets.push(entry.name);
        } catch {
          // Not a flat skillset - check if it's an org directory with nested skillsets
          // Org directories contain subdirectories with nori.json files
          try {
            const orgDir = path.join(skillsetsDir, entry.name);
            const subEntries = await fs.readdir(orgDir, {
              withFileTypes: true,
            });

            for (const subEntry of subEntries) {
              if (subEntry.isDirectory()) {
                const nestedDir = path.join(orgDir, subEntry.name);
                await ensureNoriJson({ skillsetDir: nestedDir });
                const nestedInstructionsPath = path.join(
                  nestedDir,
                  MANIFEST_FILE,
                );
                try {
                  await fs.access(nestedInstructionsPath);
                  // Found a nested skillset - use org/skillset format
                  skillsets.push(`${entry.name}/${subEntry.name}`);
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
    // Skillsets directory doesn't exist
  }

  return skillsets.sort();
};
