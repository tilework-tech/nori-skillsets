import * as fs from "fs/promises";
import * as path from "path";

import { loadConfig, getActiveSkillset, updateConfig } from "@/cli/config.js";
import {
  getNoriSkillsetsDir,
  resolveSkillsetDir,
  skillsetIdentity,
} from "@/norijson/skillset.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";

/**
 * Unlink a symlinked skillset from ~/.nori/profiles/.
 * Only removes symlinks — refuses to delete real directories.
 * @param args - Function arguments
 * @param args.name - Name of the skillset to unlink
 *
 * @returns Command result with success status and message
 */
export const unlinkSkillsetMain = async (args: {
  name: string;
}): Promise<CommandStatus> => {
  const { name } = args;

  // Resolve the link across storage buckets (a bare name reaches personal/foo)
  const skillsetsDir = getNoriSkillsetsDir();
  const linkPath =
    (await resolveSkillsetDir({ name })) ??
    path.join(skillsetsDir, ...name.split("/"));

  // Verify the path exists
  let stat;
  try {
    stat = await fs.lstat(linkPath);
  } catch {
    return {
      success: false,
      cancelled: false,
      message: `Skillset "${name}" not found at: ${linkPath}`,
    };
  }

  // Only remove symlinks — refuse to delete real directories
  if (!stat.isSymbolicLink()) {
    return {
      success: false,
      cancelled: false,
      message: `"${name}" is not a linked skillset. Use a different command to remove installed skillsets.`,
    };
  }

  // Remove the symlink
  await fs.unlink(linkPath);

  // Clear active skillset if this was the active one. The stored value is the
  // canonical namespaced identity (e.g. personal/foo), so compare against the
  // unlinked skillset's identity — matching on the raw bare name too for any
  // legacy config that still stores it bare.
  try {
    const config = await loadConfig();
    if (config != null) {
      const activeSkillset = getActiveSkillset({ config });
      const unlinkedIdentity = skillsetIdentity({ dir: linkPath });
      if (activeSkillset === unlinkedIdentity || activeSkillset === name) {
        await updateConfig({ activeSkillset: null });
      }
    }
  } catch {
    // Config errors shouldn't block the unlink
  }

  return {
    success: true,
    cancelled: false,
    message: `Unlinked "${name}"`,
  };
};
