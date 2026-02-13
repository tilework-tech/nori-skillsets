/**
 * New skillset command
 *
 * Creates a new empty skillset folder under ~/.nori/profiles/ with nori.json.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log, note, outro } from "@clack/prompts";

import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";
import {
  writeProfileMetadata,
  type ProfileMetadata,
} from "@/cli/features/claude-code/profiles/metadata.js";
import { newSkillsetFlow } from "@/cli/prompts/flows/newSkillset.js";

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

export const newSkillsetMain = async (): Promise<void> => {
  // Collect metadata from user
  const flowResult = await newSkillsetFlow();

  if (flowResult == null) {
    // User cancelled
    return;
  }

  const { name, description, license, keywords, version, repository } =
    flowResult;
  const profilesDir = getNoriProfilesDir();
  const destPath = path.join(profilesDir, name);

  // Validate destination does not already exist
  try {
    await fs.access(destPath);
    log.error(`Skillset '${name}' already exists. Choose a different name.`);
    process.exit(1);
    return;
  } catch {
    // Expected — destination should not exist
  }

  // Build metadata object
  const metadata: ProfileMetadata = {
    name: path.basename(name),
    version: version ?? "1.0.0",
  };

  if (description != null) {
    metadata.description = description;
  }

  if (license != null) {
    metadata.license = license;
  }

  if (keywords != null) {
    metadata.keywords = keywords;
  }

  if (repository != null) {
    metadata.repository = {
      type: "git",
      url: repository,
    };
  }

  // Create parent directory if needed (for namespaced profiles like org/name)
  const parentDir = path.dirname(destPath);
  await fs.mkdir(parentDir, { recursive: true });

  // Create the skillset directory
  await fs.mkdir(destPath);

  // Write nori.json
  await writeProfileMetadata({
    profileDir: destPath,
    metadata,
  });

  const nextSteps = [
    `To switch:  nori-skillsets switch ${name}`,
    `To edit:    ~/.nori/profiles/${name}/`,
  ].join("\n");
  note(nextSteps, "Next Steps");

  outro(`Created new skillset '${name}'`);
};
