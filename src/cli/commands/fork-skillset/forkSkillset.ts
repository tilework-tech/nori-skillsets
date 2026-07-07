/**
 * Fork skillset command
 *
 * Copies an existing skillset to a new name under ~/.nori/profiles/.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log, note } from "@clack/prompts";

import { bold } from "@/cli/logger.js";
import { isReservedSkillsetName } from "@/cli/prompts/validators.js";
import {
  ensureNoriJson,
  readSkillsetMetadata,
  writeSkillsetMetadata,
} from "@/norijson/nori.js";
import {
  MANIFEST_FILE,
  getNoriSkillsetsDir,
  resolveSkillsetDir,
  skillsetCreateDir,
} from "@/norijson/skillset.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";

const hasManifest = async (args: { skillsetDir: string }): Promise<boolean> => {
  try {
    await fs.access(path.join(args.skillsetDir, MANIFEST_FILE));
    return true;
  } catch {
    return false;
  }
};

export const forkSkillsetMain = async (args: {
  baseSkillset: string;
  newSkillset: string;
}): Promise<CommandStatus> => {
  const { baseSkillset, newSkillset } = args;

  if (isReservedSkillsetName({ value: newSkillset })) {
    log.error(`'${newSkillset}' is a reserved name. Choose a different name.`);
    return {
      success: false,
      cancelled: false,
      message: `Skillset "${newSkillset}" uses a reserved name`,
    };
  }

  const sourcePath = await resolveSkillsetDir({ name: baseSkillset });
  const destPath = skillsetCreateDir({ name: newSkillset });

  // Validate source exists and is a valid skillset (has nori.json)
  if (sourcePath != null) {
    await ensureNoriJson({ skillsetDir: sourcePath });
  }
  if (sourcePath == null || !(await hasManifest({ skillsetDir: sourcePath }))) {
    log.error(
      `Skillset '${baseSkillset}' not found. Run 'nori-skillsets list' to see available skillsets.`,
    );
    return {
      success: false,
      cancelled: false,
      message: `Skillset "${baseSkillset}" not found`,
    };
  }

  // Validate destination does not already resolve to an existing skillset
  if ((await resolveSkillsetDir({ name: newSkillset })) != null) {
    log.error(
      `Skillset '${newSkillset}' already exists. Choose a different name.`,
    );
    return {
      success: false,
      cancelled: false,
      message: `Skillset "${newSkillset}" already exists`,
    };
  }

  // Create parent directory if needed (for namespaced profiles like org/name)
  const parentDir = path.dirname(destPath);
  await fs.mkdir(parentDir, { recursive: true });

  // Copy the skillset
  await fs.cp(sourcePath, destPath, { recursive: true });

  // Update the name in nori.json to match the new skillset name
  const metadata = await readSkillsetMetadata({ skillsetDir: destPath });
  metadata.name = newSkillset;
  await writeSkillsetMetadata({ skillsetDir: destPath, metadata });

  const relLocation = path.relative(getNoriSkillsetsDir(), destPath);
  const nextSteps = [
    `To switch:  nori-skillsets switch ${relLocation}`,
    `To edit:    ~/.nori/profiles/${relLocation}/`,
  ].join("\n");
  note(nextSteps, "Next Steps");

  return {
    success: true,
    cancelled: false,
    message: `Forked "${bold({ text: baseSkillset })}" to "${bold({ text: newSkillset })}"`,
  };
};
