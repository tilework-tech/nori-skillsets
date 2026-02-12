/**
 * Fork skillset command
 *
 * Copies an existing skillset to a new name under ~/.nori/profiles/.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log, note, outro } from "@clack/prompts";

import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";
import { ensureNoriJson } from "@/cli/features/claude-code/profiles/metadata.js";
import { MANIFEST_FILE } from "@/cli/features/managedFolder.js";

export const forkSkillsetMain = async (args: {
  baseSkillset: string;
  newSkillset: string;
}): Promise<void> => {
  const { baseSkillset, newSkillset } = args;
  const profilesDir = getNoriProfilesDir();
  const sourcePath = path.join(profilesDir, baseSkillset);
  const destPath = path.join(profilesDir, newSkillset);

  // Validate source exists and is a valid skillset (has nori.json)
  await ensureNoriJson({ profileDir: sourcePath });
  try {
    await fs.access(path.join(sourcePath, MANIFEST_FILE));
  } catch {
    log.error(
      `Skillset '${baseSkillset}' not found. Run 'nori-skillsets list' to see available skillsets.`,
    );
    process.exit(1);
    return;
  }

  // Validate destination does not already exist
  try {
    await fs.access(destPath);
    log.error(
      `Skillset '${newSkillset}' already exists. Choose a different name.`,
    );
    process.exit(1);
    return;
  } catch {
    // Expected — destination should not exist
  }

  // Create parent directory if needed (for namespaced profiles like org/name)
  const parentDir = path.dirname(destPath);
  await fs.mkdir(parentDir, { recursive: true });

  // Copy the skillset
  await fs.cp(sourcePath, destPath, { recursive: true });

  const nextSteps = [
    `To switch:  nori-skillsets switch ${newSkillset}`,
    `To edit:    ~/.nori/profiles/${newSkillset}/`,
  ].join("\n");
  note(nextSteps, "Next Steps");

  outro(`Forked '${baseSkillset}' to '${newSkillset}'`);
};
