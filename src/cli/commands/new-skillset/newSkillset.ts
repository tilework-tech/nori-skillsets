/**
 * New skillset command
 *
 * Creates a new empty skillset folder under ~/.nori/profiles/ with nori.json.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log, note } from "@clack/prompts";

import { loadConfig } from "@/cli/config.js";
import { bold } from "@/cli/logger.js";
import { newSkillsetFlow } from "@/cli/prompts/flows/newSkillset.js";
import { namespaceCreateSkillsetName } from "@/cli/skillsetResolution.js";
import { writeSkillsetMetadata, type NoriJson } from "@/norijson/nori.js";
import {
  resolveSkillsetDir,
  skillsetCreateDir,
  skillsetIdentity,
} from "@/norijson/skillset.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";

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
  await writeSkillsetMetadata({
    skillsetDir: destPath,
    metadata: {
      name: path.basename(name),
      version: "1.0.0",
      type: "skillset",
    },
  });
};

export const newSkillsetMain = async (): Promise<CommandStatus> => {
  // Collect metadata from user
  const flowResult = await newSkillsetFlow();

  if (flowResult == null) {
    // User cancelled
    return { success: false, cancelled: true, message: "" };
  }

  const { name, description, license, keywords, version, repository } =
    flowResult;

  // A bare name lands under the configured default org.
  const config = await loadConfig();
  const localName = namespaceCreateSkillsetName({
    name,
    defaultOrg: config?.defaultOrg,
  });
  const destPath = skillsetCreateDir({ name: localName });

  // Validate the name does not already resolve to an existing skillset
  // (in any bucket or the legacy flat location).
  if ((await resolveSkillsetDir({ name: localName })) != null) {
    log.error(
      `Skillset '${localName}' already exists. Choose a different name.`,
    );
    return {
      success: false,
      cancelled: false,
      message: `Skillset "${localName}" already exists`,
    };
  }

  // Build metadata object
  const metadata: NoriJson = {
    name: path.basename(localName),
    version: version ?? "1.0.0",
    type: "skillset",
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
    metadata.repository = repository;
  }

  // Create parent directory if needed (for namespaced profiles like org/name)
  const parentDir = path.dirname(destPath);
  await fs.mkdir(parentDir, { recursive: true });

  // Create the skillset directory
  await fs.mkdir(destPath);

  // Write nori.json
  await writeSkillsetMetadata({
    skillsetDir: destPath,
    metadata,
  });

  const relLocation = skillsetIdentity({ dir: destPath });
  const nextSteps = [
    `To switch:  nori-skillsets switch ${relLocation}`,
    `To edit:    ~/.nori/profiles/${relLocation}/`,
  ].join("\n");
  note(nextSteps, "Next Steps");

  return {
    success: true,
    cancelled: false,
    message: `Created new skillset "${bold({ text: localName })}"`,
  };
};
