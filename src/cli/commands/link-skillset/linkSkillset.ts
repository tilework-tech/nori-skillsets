import * as fs from "fs/promises";
import * as path from "path";

import { loadConfig } from "@/cli/config.js";
import { isReservedSkillsetName } from "@/cli/prompts/validators.js";
import { readSkillsetMetadata } from "@/norijson/nori.js";
import {
  namespaceCreateSkillsetName,
  skillsetCreateDir,
} from "@/norijson/skillset.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";

/**
 * Link a local directory as a skillset in ~/.nori/profiles/.
 * Creates a symlink from the profiles directory to the target.
 * @param args - Function arguments
 * @param args.targetDir - Path to the directory to link (absolute or relative)
 * @param args.name - Optional override for the skillset name
 * @param args.cwd - Optional working directory for resolving relative paths
 *
 * @returns Command result with success status and message
 */
export const linkSkillsetMain = async (args: {
  targetDir: string;
  name?: string | null;
  cwd?: string | null;
}): Promise<CommandStatus> => {
  const { targetDir: rawTargetDir, name: explicitName, cwd } = args;

  // Resolve to absolute path
  const resolvedTarget = path.isAbsolute(rawTargetDir)
    ? rawTargetDir
    : path.resolve(cwd ?? process.cwd(), rawTargetDir);

  // Verify target exists and is a directory
  let stat;
  try {
    stat = await fs.stat(resolvedTarget);
  } catch {
    return {
      success: false,
      cancelled: false,
      message: `Target directory not found: ${resolvedTarget}`,
    };
  }

  if (!stat.isDirectory()) {
    return {
      success: false,
      cancelled: false,
      message: `Target is not a directory: ${resolvedTarget}`,
    };
  }

  // Determine skillset name
  let skillsetName = explicitName ?? null;
  if (skillsetName == null) {
    try {
      const metadata = await readSkillsetMetadata({
        skillsetDir: resolvedTarget,
      });
      skillsetName = metadata.name ?? null;
    } catch {
      // No nori.json — fall back to directory basename
    }
  }
  if (skillsetName == null) {
    skillsetName = path.basename(resolvedTarget);
  }

  // A bare name lands under the configured default org, so links share the same
  // namespace every other command uses.
  const config = await loadConfig();
  skillsetName = namespaceCreateSkillsetName({
    name: skillsetName,
    defaultOrg: config?.defaultOrg,
  });

  // A skillset may not take a reserved storage-bucket name (personal/public),
  // matching new/fork/external — otherwise `link --name public` would land at
  // profiles/personal/public.
  if (isReservedSkillsetName({ value: skillsetName })) {
    return {
      success: false,
      cancelled: false,
      message: `"${skillsetName}" is a reserved name and cannot be used for a skillset`,
    };
  }

  // Compute link path: a bare name lands in the personal/ bucket, while an
  // explicitly namespaced name (e.g. an org) is written at that namespace.
  const linkPath = skillsetCreateDir({ name: skillsetName });

  // Ensure parent directory exists (for org-scoped names)
  await fs.mkdir(path.dirname(linkPath), { recursive: true });

  // Check if something already exists at the link path
  try {
    await fs.lstat(linkPath);
    return {
      success: false,
      cancelled: false,
      message: `Skillset "${skillsetName}" already exists at: ${linkPath}`,
    };
  } catch {
    // Good — nothing exists there
  }

  // Create the symlink
  await fs.symlink(resolvedTarget, linkPath);

  return {
    success: true,
    cancelled: false,
    message: `Linked "${skillsetName}" → ${resolvedTarget}`,
  };
};
