/**
 * CLI command for installing a profile from the public registry in one step
 * Handles: nori-ai registry-install <package>[@version] [--user]
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { REGISTRAR_URL } from "@/api/registrar.js";
import { main as installMain } from "@/cli/commands/install/install.js";
import { hasExistingInstallation } from "@/cli/commands/install/installState.js";
import { registryDownloadMain } from "@/cli/commands/registry-download/registryDownload.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";
import { error, success, info, warn, newline } from "@/cli/logger.js";
import { normalizeInstallDir } from "@/utils/path.js";

import type { Command } from "commander";

type RegistryInstallArgs = {
  packageSpec: string;
  cwd?: string | null;
  installDir?: string | null;
  useHomeDir?: boolean | null;
  silent?: boolean | null;
  agent?: string | null;
};

const parsePackageName = (args: { packageSpec: string }): string => {
  const { packageSpec } = args;
  const [packageName] = packageSpec.split("@");
  return packageName || packageSpec;
};

const resolveInstallDir = (args: {
  cwd?: string | null;
  installDir?: string | null;
  useHomeDir?: boolean | null;
}): string => {
  const { cwd, installDir, useHomeDir } = args;

  if (installDir) {
    return normalizeInstallDir({ installDir });
  }

  if (useHomeDir) {
    return normalizeInstallDir({ installDir: os.homedir() });
  }

  return normalizeInstallDir({ installDir: cwd ?? process.cwd() });
};

/**
 * Check if a profile exists locally in the profiles directory
 * @param args - Function arguments
 * @param args.installDir - Installation directory
 * @param args.profileName - Name of the profile to check
 *
 * @returns True if the profile directory exists locally
 */
const checkLocalProfileExists = async (args: {
  installDir: string;
  profileName: string;
}): Promise<boolean> => {
  const { installDir, profileName } = args;
  const profilesDir = getNoriProfilesDir({ installDir });
  const profilePath = path.join(profilesDir, profileName);

  try {
    await fs.access(profilePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Result of registry install operation
 */
export type RegistryInstallResult = {
  success: boolean;
};

/**
 * Display success message after installation completes
 * @param args - Function arguments
 * @param args.profileName - Name of the profile that was installed
 */
const displaySuccessMessage = (args: { profileName: string }): void => {
  const { profileName } = args;
  newline();
  success({ message: `Profile "${profileName}" is now active.` });
  info({ message: "Restart Claude Code to apply the new profile." });
};

/**
 * Install a profile from the public registry in one step
 * Downloads the profile, then either performs initial installation or
 * switches to the profile and regenerates files.
 * @param args - The install parameters
 * @param args.packageSpec - Package specification (name or name@version)
 * @param args.cwd - Current working directory
 * @param args.installDir - Optional explicit install directory
 * @param args.useHomeDir - If true, install to user home directory
 * @param args.silent - If true, suppress output
 * @param args.agent - AI agent to use (defaults to claude-code)
 *
 * @returns Result indicating success or failure
 */
export const registryInstallMain = async (
  args: RegistryInstallArgs,
): Promise<RegistryInstallResult> => {
  const { packageSpec, cwd, installDir, useHomeDir, silent, agent } = args;

  const targetInstallDir = resolveInstallDir({
    cwd,
    installDir,
    useHomeDir,
  });

  const profileName = parsePackageName({ packageSpec });
  const agentName = agent ?? "claude-code";

  // Step 1: Download the profile from registry first (so it's available for install)
  const downloadResult = await registryDownloadMain({
    packageSpec,
    installDir: targetInstallDir,
    registryUrl: REGISTRAR_URL,
    listVersions: null,
  });

  // If download failed, check if profile exists locally as fallback
  if (!downloadResult.success) {
    const localExists = await checkLocalProfileExists({
      installDir: targetInstallDir,
      profileName,
    });

    if (!localExists) {
      return { success: false };
    }

    warn({
      message: `Profile "${profileName}" not found in registry. Using locally installed version.`,
    });
  }

  try {
    // Step 2: Run initial install if no existing installation
    if (!hasExistingInstallation({ installDir: targetInstallDir })) {
      await installMain({
        nonInteractive: true,
        installDir: targetInstallDir,
        profile: profileName,
        agent: agentName,
        silent: silent ?? null,
      });
      // Initial install already sets the profile, so we're done
      displaySuccessMessage({ profileName });
      return { success: true };
    }

    // Step 3 (existing installation): Switch to the downloaded profile
    const agentImpl = AgentRegistry.getInstance().get({ name: agentName });
    await agentImpl.switchProfile({
      installDir: targetInstallDir,
      profileName,
    });

    // Step 4: Re-run install in silent mode to regenerate files with new profile
    // skipBuiltinProfiles prevents installing all built-in profiles when user
    // explicitly downloaded a specific profile from the registry
    await installMain({
      nonInteractive: true,
      skipUninstall: true,
      skipBuiltinProfiles: true,
      installDir: targetInstallDir,
      agent: agentName,
      silent: true,
    });

    displaySuccessMessage({ profileName });
    return { success: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error({
      message: `Failed to install profile "${profileName}": ${errorMessage}`,
    });
    return { success: false };
  }
};

/**
 * Register the 'registry-install' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerRegistryInstallCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("registry-install <package>")
    .description(
      "Download, install, and activate a profile from the public registry in one step",
    )
    .option("--user", "Install to the user home directory")
    .action(async (packageSpec: string, options: { user?: boolean }) => {
      const globalOpts = program.opts();

      const result = await registryInstallMain({
        packageSpec,
        useHomeDir: options.user ?? null,
        installDir: globalOpts.installDir || null,
        cwd: process.cwd(),
        silent: globalOpts.silent || null,
        agent: globalOpts.agent || null,
      });

      if (!result.success) {
        process.exit(1);
      }
    });
};
