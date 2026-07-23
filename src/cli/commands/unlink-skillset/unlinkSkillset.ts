import * as fs from "fs/promises";

import {
  loadConfig,
  getActiveSkillset,
  updateConfig,
  type Config,
} from "@/cli/config.js";
import { withInstallLock } from "@/cli/features/install/installLock.js";
import {
  namespaceCreateSkillsetName,
  resolveUserSkillsetRef,
} from "@/cli/skillsetResolution.js";
import { skillsetPath } from "@/norijson/skillset.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";

/**
 * Unlink a symlinked skillset from ~/.nori/profiles/.
 * Only removes symlinks — refuses to delete real directories.
 * @param args - Function arguments
 * @param args.name - Name of the skillset to unlink
 *
 * @returns Command result with success status and message
 */
const unlinkSkillsetMainImpl = async (args: {
  name: string;
}): Promise<CommandStatus> => {
  const { name } = args;

  // Load config for the default org (errors shouldn't block the unlink).
  let config: Config | null = null;
  try {
    config = await loadConfig();
  } catch {
    // Config errors shouldn't block the unlink.
  }

  // Resolve the link across storage buckets, preferring the default org for a
  // bare name (warning once on a deprecated bare name). Fall back to the
  // default-org path so a broken symlink that cannot be followed is still
  // removable.
  const ref = await resolveUserSkillsetRef({
    name,
    defaultOrg: config?.defaultOrg,
    nameWasProvided: true,
  });
  const fallbackName = namespaceCreateSkillsetName({
    name,
    defaultOrg: config?.defaultOrg,
  });
  const linkPath = ref?.dir ?? skillsetPath({ name: fallbackName });
  const identity = ref?.identity ?? fallbackName;

  // Verify the path exists
  let stat;
  try {
    stat = await fs.lstat(linkPath);
  } catch {
    return {
      success: false,
      cancelled: false,
      message: `Skillset "${identity}" not found at: ${linkPath}`,
    };
  }

  // Only remove symlinks — refuse to delete real directories
  if (!stat.isSymbolicLink()) {
    return {
      success: false,
      cancelled: false,
      message: `"${identity}" is not a linked skillset. Use a different command to remove installed skillsets.`,
    };
  }

  // Remove the symlink
  await fs.unlink(linkPath);

  // Clear active skillset if this was the active one. The stored value is the
  // canonical namespaced identity (e.g. personal/foo), so compare against the
  // unlinked skillset's identity — matching the raw name too for any legacy
  // config that still stores it bare.
  if (config != null) {
    const activeSkillset = getActiveSkillset({ config });
    if (activeSkillset === identity || activeSkillset === name) {
      await updateConfig({ activeSkillset: null });
    }
  }

  return {
    success: true,
    cancelled: false,
    message: `Unlinked "${identity}"`,
  };
};

export const unlinkSkillsetMain = async (args: {
  name: string;
}): Promise<CommandStatus> =>
  withInstallLock({ operation: () => unlinkSkillsetMainImpl(args) });
