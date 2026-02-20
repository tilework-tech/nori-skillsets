/**
 * CLI command for installing a skillset from the public registry in one step
 * Handles: nori-skillsets install <package>[@version] [--user]
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log } from "@clack/prompts";

import { main as installMain } from "@/cli/commands/install/install.js";
import { hasExistingInstallation } from "@/cli/commands/install/installState.js";
import { registryDownloadMain } from "@/cli/commands/registry-download/registryDownload.js";
import { loadConfig, getDefaultAgents } from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { getNoriSkillsetsDir } from "@/cli/features/claude-code/paths.js";
import { getHomeDir } from "@/utils/home.js";
import { normalizeInstallDir } from "@/utils/path.js";

import type { Command } from "commander";

type RegistryInstallArgs = {
  packageSpec: string;
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
  installDir?: string | null;
  useHomeDir?: boolean | null;
}): string => {
  const { installDir, useHomeDir } = args;

  if (installDir) {
    return normalizeInstallDir({ installDir });
  }

  if (useHomeDir) {
    return normalizeInstallDir({ installDir: getHomeDir() });
  }

  // Default to home directory when no existing installation is detected
  return normalizeInstallDir({ installDir: getHomeDir() });
};

/**
 * Check if a skillset exists locally in the profiles directory
 * @param args - Function arguments
 * @param args.skillsetName - Name of the skillset to check
 *
 * @returns True if the skillset directory exists locally
 */
const checkLocalSkillsetExists = async (args: {
  skillsetName: string;
}): Promise<boolean> => {
  const { skillsetName } = args;
  const skillsetsDir = getNoriSkillsetsDir();
  const skillsetPath = path.join(skillsetsDir, skillsetName);

  try {
    await fs.access(skillsetPath);
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
 * @param args.skillsetName - Name of the skillset that was installed
 */
const displaySuccessMessage = (args: { skillsetName: string }): void => {
  const { skillsetName } = args;
  log.success(`Skillset "${skillsetName}" is now active.`);
  log.info("Restart Claude Code to apply the new skillset.");
};

/**
 * Install a skillset from the public registry in one step
 * Downloads the skillset, then either performs initial installation or
 * switches to the skillset and regenerates files.
 * @param args - The install parameters
 * @param args.packageSpec - Package specification (name or name@version)
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
  const { packageSpec, installDir, useHomeDir, silent, agent } = args;

  const targetInstallDir = resolveInstallDir({
    installDir,
    useHomeDir,
  });

  const skillsetName = parsePackageName({ packageSpec });

  // Resolve agent name from config defaultAgents, with --agent as override
  const config = await loadConfig();
  const agentName = getDefaultAgents({ config, agentOverride: agent })[0];

  // Step 1: Download the skillset from registry first (so it's available for install)
  // Note: registryUrl is null to let registryDownloadMain determine the correct
  // registry based on the package namespace (e.g., "org/package" -> org's registry)
  const downloadResult = await registryDownloadMain({
    packageSpec,
    installDir: targetInstallDir,
    registryUrl: null,
    listVersions: null,
  });

  // If download failed, check if skillset exists locally as fallback
  if (!downloadResult.success) {
    const localExists = await checkLocalSkillsetExists({
      skillsetName,
    });

    if (!localExists) {
      return { success: false };
    }

    log.warn(
      `Skillset "${skillsetName}" not found in registry. Using locally installed version.`,
    );
  }

  try {
    // Step 2: Run initial install if no existing installation
    if (!hasExistingInstallation()) {
      await installMain({
        nonInteractive: true,
        installDir: targetInstallDir,
        skillset: skillsetName,
        agent: agentName,
        silent: silent ?? null,
      });
      // Initial install already sets the skillset, so we're done
      displaySuccessMessage({ skillsetName });
      return { success: true };
    }

    // Step 3 (existing installation): Switch to the downloaded skillset
    const agentImpl = AgentRegistry.getInstance().get({ name: agentName });
    await agentImpl.switchSkillset({
      installDir: targetInstallDir,
      skillsetName,
    });

    // Step 4: Re-run install in silent mode to regenerate files with new skillset
    await installMain({
      nonInteractive: true,
      installDir: targetInstallDir,
      agent: agentName,
      silent: true,
    });

    displaySuccessMessage({ skillsetName });
    return { success: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error(`Failed to install skillset "${skillsetName}": ${errorMessage}`);
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
      "Download, install, and activate a skillset from the public registry in one step",
    )
    .option("--user", "Install to the user home directory")
    .action(async (packageSpec: string, options: { user?: boolean }) => {
      const globalOpts = program.opts();

      const result = await registryInstallMain({
        packageSpec,
        useHomeDir: options.user ?? null,
        installDir: globalOpts.installDir || null,
        silent: globalOpts.silent || null,
        agent: globalOpts.agent || null,
      });

      if (!result.success) {
        process.exit(1);
      }
    });
};
