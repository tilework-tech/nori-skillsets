/**
 * New skillset command
 *
 * Creates a new empty skillset folder under ~/.nori/profiles/ with nori.json and CLAUDE.md.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";
import { writeProfileMetadata } from "@/cli/features/claude-code/profiles/metadata.js";
import { INSTRUCTIONS_FILE } from "@/cli/features/managedFolder.js";
import { error, info, newline, success } from "@/cli/logger.js";

export const newSkillsetMain = async (args: {
  name: string;
}): Promise<void> => {
  const { name } = args;
  const profilesDir = getNoriProfilesDir();
  const destPath = path.join(profilesDir, name);

  // Validate destination does not already exist
  try {
    await fs.access(destPath);
    error({
      message: `Skillset '${name}' already exists. Choose a different name.`,
    });
    process.exit(1);
    return;
  } catch {
    // Expected — destination should not exist
  }

  // Create parent directory if needed (for namespaced profiles like org/name)
  const parentDir = path.dirname(destPath);
  await fs.mkdir(parentDir, { recursive: true });

  // Create the skillset directory
  await fs.mkdir(destPath);

  // Write nori.json
  await writeProfileMetadata({
    profileDir: destPath,
    metadata: {
      name: path.basename(name),
      version: "1.0.0",
    },
  });

  // Write empty CLAUDE.md so the skillset is recognized by list-skillsets
  await fs.writeFile(path.join(destPath, INSTRUCTIONS_FILE), "");

  newline();
  success({
    message: `Created new skillset '${name}'`,
  });
  newline();
  info({
    message: `To switch:  nori-skillsets switch-skillset ${name}`,
  });
  info({
    message: `To edit:    ~/.nori/profiles/${name}/`,
  });
};
