/**
 * Fork skillset command
 *
 * Copies an existing skillset to a new name under ~/.nori/profiles/.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";
import { INSTRUCTIONS_FILE } from "@/cli/features/managedFolder.js";
import { error, info, newline, success } from "@/cli/logger.js";

export const forkSkillsetMain = async (args: {
  baseSkillset: string;
  newSkillset: string;
}): Promise<void> => {
  const { baseSkillset, newSkillset } = args;
  const profilesDir = getNoriProfilesDir();
  const sourcePath = path.join(profilesDir, baseSkillset);
  const destPath = path.join(profilesDir, newSkillset);

  // Validate source exists and is a valid skillset (has CLAUDE.md)
  try {
    await fs.access(path.join(sourcePath, INSTRUCTIONS_FILE));
  } catch {
    error({
      message: `Skillset '${baseSkillset}' not found. Run 'nori-skillsets list-skillsets' to see available skillsets.`,
    });
    process.exit(1);
    return;
  }

  // Validate destination does not already exist
  try {
    await fs.access(destPath);
    error({
      message: `Skillset '${newSkillset}' already exists. Choose a different name.`,
    });
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

  newline();
  success({
    message: `Forked '${baseSkillset}' to '${newSkillset}'`,
  });
  newline();
  info({
    message: `To switch:  nori-skillsets switch-skillset ${newSkillset}`,
  });
  info({
    message: `To edit:    ~/.nori/profiles/${newSkillset}/`,
  });
};
