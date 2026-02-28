/**
 * CLI command for installing a skillset from the public registry in one step
 * Handles: nori-skillsets install <package>[@version] [--user]
 */

import * as fs from "fs/promises";
import * as path from "path";

import { intro, log, note, outro } from "@clack/prompts";

import { main as installMain } from "@/cli/commands/install/install.js";
import { hasExistingInstallation } from "@/cli/commands/install/installState.js";
import { registryDownloadMain } from "@/cli/commands/registry-download/registryDownload.js";
import {
  loadConfig,
  updateConfig,
  getActiveSkillset,
  getDefaultAgents,
} from "@/cli/config.js";
import { switchSkillset } from "@/cli/features/agentOperations.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { getNoriSkillsetsDir } from "@/cli/features/paths.js";
import { bold, brightCyan, green } from "@/cli/logger.js";
import { resolveInstallDir } from "@/utils/path.js";

import type { Command } from "commander";

type RegistryInstallArgs = {
  packageSpec: string;
  installDir?: string | null;
  silent?: boolean | null;
  agent?: string | null;
};

const parsePackageName = (args: { packageSpec: string }): string => {
  const { packageSpec } = args;
  const [packageName] = packageSpec.split("@");
  return packageName || packageSpec;
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
  outro(`Skillset "${skillsetName}" is now active.`);
};

/**
 * Install a skillset from the public registry in one step
 * Downloads the skillset, then either performs initial installation or
 * switches to the skillset and regenerates files.
 * @param args - The install parameters
 * @param args.packageSpec - Package specification (name or name@version)
 * @param args.installDir - Optional explicit install directory
 * @param args.silent - If true, suppress output
 * @param args.agent - AI agent to use (defaults to claude-code)
 *
 * @returns Result indicating success or failure
 */
export const registryInstallMain = async (
  args: RegistryInstallArgs,
): Promise<RegistryInstallResult> => {
  const { packageSpec, installDir, silent, agent } = args;

  const skillsetName = parsePackageName({ packageSpec });

  // Load config for auth and install dir resolution
  const config = await loadConfig();
  const resolved = resolveInstallDir({
    cliInstallDir: installDir,
    configInstallDir: config?.installDir,
    agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
  });
  const targetInstallDir = resolved.path;

  // Skip manifest operations when the install dir comes from a CLI override
  const skipManifest = resolved.source === "cli";
  const agentNames = getDefaultAgents({ config, agentOverride: agent });

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
      // Broadcast initial install to all configured agents
      for (const agentName of agentNames) {
        await installMain({
          nonInteractive: true,
          installDir: targetInstallDir,
          skillset: skillsetName,
          agent: agentName,
          silent: silent ?? null,
          ...(skipManifest ? { skipManifest: true } : {}),
        });
      }
      // Initial install already sets the skillset and displays its own completion banners
      return { success: true };
    }

    // Step 3 (existing installation): Broadcast switch to all configured agents
    intro("Switch Skillset");

    // Show context note with switch details
    const currentSkillset =
      config != null ? (getActiveSkillset({ config }) ?? "(none)") : "(none)";
    const agentDisplay =
      agentNames.length === 1 ? agentNames[0] : agentNames.join(", ");
    const detailLines = [
      `Install directory: ${targetInstallDir}`,
      `Agent: ${agentDisplay}`,
      `Current skillset: ${brightCyan({ text: bold({ text: currentSkillset }) })}`,
      `New skillset: ${green({ text: bold({ text: skillsetName }) })}`,
    ];
    note(detailLines.join("\n"), "Switching Skillset");

    for (const agentName of agentNames) {
      const agentImpl = AgentRegistry.getInstance().get({ name: agentName });
      await switchSkillset({
        agent: agentImpl,
        installDir: targetInstallDir,
        skillsetName,
      });

      // Step 4: Re-run install in silent mode to regenerate files with new skillset
      await installMain({
        nonInteractive: true,
        installDir: targetInstallDir,
        agent: agentName,
        silent: true,
        skillset: skillsetName,
        ...(skipManifest ? { skipManifest: true } : {}),
      });
    }

    // Persist activeSkillset to config unless this is a transient CLI override
    if (resolved.source !== "cli") {
      await updateConfig({ activeSkillset: skillsetName });
    }

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
    .action(async (packageSpec: string) => {
      const globalOpts = program.opts();

      const result = await registryInstallMain({
        packageSpec,
        installDir: globalOpts.installDir || null,
        silent: globalOpts.silent || null,
        agent: globalOpts.agent || null,
      });

      if (!result.success) {
        process.exit(1);
      }
    });
};
