/**
 * New skillset command
 *
 * Creates a new empty skillset folder under ~/.nori/profiles/ with nori.json.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";
import { writeProfileMetadata } from "@/cli/features/claude-code/profiles/metadata.js";
import { error, info, newline, success } from "@/cli/logger.js";

/**
 * Create the directory and nori.json for a new skillset.
 *
 * This is the core creation logic shared by `nori-skillsets new` and
 * the `--new` flag on `nori-skillsets external`.  Callers are responsible
 * for validation (e.g. checking the directory does not already exist)
 * and any user-facing messaging beyond what this function does.
 *
 * @param args - The function arguments
 * @param args.destPath - Absolute path to the new skillset directory
 * @param args.name - Skillset name (used as the `name` field in nori.json)
 */
export const createEmptySkillset = async (args: {
  destPath: string;
  name: string;
}): Promise<void> => {
  const { destPath, name } = args;

  // Create parent directory if needed (for namespaced profiles like org/name)
  const parentDir = path.dirname(destPath);
  await fs.mkdir(parentDir, { recursive: true });

  // Create the skillset directory
  await fs.mkdir(destPath);

  // Write nori.json (serves as the skillset marker for list-skillsets)
  await writeProfileMetadata({
    profileDir: destPath,
    metadata: {
      name: path.basename(name),
      version: "1.0.0",
    },
  });
};

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

  await createEmptySkillset({ destPath, name });

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
