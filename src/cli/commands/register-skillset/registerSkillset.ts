/**
 * Register skillset command
 *
 * Creates nori.json for an existing skillset folder under ~/.nori/profiles/.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log, note } from "@clack/prompts";

import { getActiveSkillset, loadConfig } from "@/cli/config.js";
import { bold } from "@/cli/logger.js";
import { registerSkillsetFlow } from "@/cli/prompts/flows/registerSkillset.js";
import { resolveUserSkillsetRef } from "@/cli/skillsetResolution.js";
import { writeSkillsetMetadata, type NoriJson } from "@/norijson/nori.js";
import { skillsetIdentity } from "@/norijson/skillset.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";

/**
 * Main function for register-skillset command
 *
 * @param args - The function arguments
 * @param args.skillsetName - Skillset name (null to use current active skillset)
 *
 * @returns Command status
 */
export const registerSkillsetMain = async (args: {
  skillsetName: string | null;
}): Promise<CommandStatus> => {
  const config = await loadConfig();
  const activeSkillset = config != null ? getActiveSkillset({ config }) : null;

  // If no skillset name provided, use current active skillset
  if (args.skillsetName == null) {
    if (config == null) {
      log.error(
        "No active skillset configured. Use 'nori-skillsets switch <name>' to set one, or specify a skillset name.",
      );
      return {
        success: false,
        cancelled: false,
        message: "No active skillset configured",
      };
    }

    if (activeSkillset == null) {
      log.error(
        "No active skillset configured. Use 'nori-skillsets switch <name>' to set one, or specify a skillset name.",
      );
      return {
        success: false,
        cancelled: false,
        message: "No active skillset configured",
      };
    }
  }
  const skillsetName = args.skillsetName ?? activeSkillset!;

  // Resolve the existing skillset directory across storage buckets, warning
  // once if a deprecated bare name was used.
  const destPath = (
    await resolveUserSkillsetRef({
      name: args.skillsetName,
      activeSkillset,
      defaultOrg: config?.defaultOrg,
      nameWasProvided: args.skillsetName != null,
    })
  )?.dir;

  // Validate that the directory exists
  if (destPath == null) {
    log.error(
      `Skillset '${skillsetName}' does not exist. Please create it first.`,
    );
    return {
      success: false,
      cancelled: false,
      message: `Skillset "${skillsetName}" does not exist`,
    };
  }

  // Validate that nori.json does NOT already exist
  const noriJsonPath = path.join(destPath, "nori.json");
  try {
    await fs.access(noriJsonPath);
    log.error(
      `Skillset '${skillsetName}' already has a nori.json manifest at ${noriJsonPath}.`,
    );
    return {
      success: false,
      cancelled: false,
      message: `Skillset "${skillsetName}" already has a nori.json manifest`,
    };
  } catch {
    // Expected - nori.json should not exist
  }

  // Collect metadata from user
  const flowResult = await registerSkillsetFlow();

  if (flowResult == null) {
    // User cancelled
    return { success: false, cancelled: true, message: "" };
  }

  const { description, license, keywords, version, repository } = flowResult;

  // Build metadata object with name from basename
  const metadata: NoriJson = {
    name: path.basename(skillsetName),
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

  // Write nori.json
  await writeSkillsetMetadata({
    skillsetDir: destPath,
    metadata,
  });

  const relLocation = skillsetIdentity({ dir: destPath });
  const nextSteps = [
    `To edit:    nori-skillsets edit ${skillsetName}`,
    `Location:   ~/.nori/profiles/${relLocation}/nori.json`,
  ].join("\n");
  note(nextSteps, "Next Steps");

  return {
    success: true,
    cancelled: false,
    message: `Registered skillset "${bold({ text: skillsetName })}"`,
  };
};
