/**
 * CLI command for installing a skillset from the public registry in one step
 * Handles: nori-skillsets install <package>[@version] [--user]
 */

import { log, note } from "@clack/prompts";

import { registryDownloadMain } from "@/cli/commands/registry-download/registryDownload.js";
import {
  loadConfig,
  updateConfig,
  getActiveSkillset,
  getDefaultAgents,
} from "@/cli/config.js";
import { switchSkillset } from "@/cli/features/agentOperations.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { main as installMain } from "@/cli/features/install/install.js";
import { hasExistingInstallation } from "@/cli/features/install/installState.js";
import { bold, brightCyan, green } from "@/cli/logger.js";
import { resolveSkillsetDir } from "@/norijson/skillset.js";
import { resolveInstallDir } from "@/utils/path.js";
import { namespacedName, parseNamespacedPackage } from "@/utils/url.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";
import type { Command } from "commander";

type RegistryInstallArgs = {
  packageSpec: string;
  installDir?: string | null;
  nonInteractive?: boolean | null;
  silent?: boolean | null;
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
  return (await resolveSkillsetDir({ name: skillsetName })) != null;
};

/**
 * Install a skillset from the public registry in one step
 * Downloads the skillset, then either performs initial installation or
 * switches to the skillset and regenerates files.
 * @param args - The install parameters
 * @param args.packageSpec - Package specification (name or name@version)
 * @param args.installDir - Optional explicit install directory
 * @param args.silent - If true, suppress output
 *
 * @returns Result indicating success or failure
 */
export const registryInstallMain = async (
  args: RegistryInstallArgs,
): Promise<CommandStatus> => {
  const { packageSpec, installDir, nonInteractive, silent } = args;

  const parsed = parseNamespacedPackage({ packageSpec });
  if (parsed == null) {
    log.error(
      `Invalid skillset specification: "${packageSpec}".\nExpected format: skillset-name or org/skillset-name[@version]`,
    );
    return {
      success: false,
      cancelled: false,
      message: `Invalid skillset specification: "${packageSpec}"`,
    };
  }
  const skillsetName = namespacedName({
    orgId: parsed.orgId,
    packageName: parsed.packageName,
  });

  // Load config for auth and install dir resolution
  const config = await loadConfig();
  const resolved = resolveInstallDir({
    cliInstallDir: installDir,
    configInstallDir: config?.installDir,
    agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
  });
  const targetInstallDir = resolved.path;

  const agentNames = getDefaultAgents({ config });

  // Snapshot before download — registryDownloadMain may auto-init and create config,
  // which would make hasExistingInstallation() return true after download completes.
  const isFirstTimeInstall = !hasExistingInstallation();

  // Step 1: Download the skillset from registry first (so it's available for install)
  // Note: registryUrl is null to let registryDownloadMain determine the correct
  // registry based on the package namespace (e.g., "org/package" -> org's registry)
  const downloadResult = await registryDownloadMain({
    packageSpec,
    installDir: targetInstallDir,
    registryUrl: null,
    listVersions: null,
    nonInteractive: nonInteractive ?? null,
    silent: silent ?? null,
  });

  // If download failed, check if skillset exists locally as fallback
  if (!downloadResult.success) {
    const localExists = await checkLocalSkillsetExists({
      skillsetName,
    });

    if (!localExists) {
      return {
        success: false,
        cancelled: false,
        message: `Skillset "${skillsetName}" not found in registry or locally`,
      };
    }

    log.warn(
      `Skillset "${skillsetName}" not found in registry. Using locally installed version.`,
    );
  }

  try {
    // Step 2: Run initial install if no existing installation
    if (isFirstTimeInstall) {
      // Broadcast initial install to all configured agents
      for (const agentName of agentNames) {
        await installMain({
          nonInteractive: true,
          installDir: targetInstallDir,
          skillset: skillsetName,
          agent: agentName,
          silent: silent ?? null,
        });
      }
      // Initial install already sets the skillset and displays its own completion banners
      return {
        success: true,
        cancelled: false,
        message: `Installed and activated skillset "${bold({ text: skillsetName })}"`,
      };
    }

    // Step 3 (existing installation): Broadcast switch to all configured agents

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
      });
    }

    // Persist activeSkillset to config unless this is a transient CLI override
    if (resolved.source !== "cli") {
      await updateConfig({ activeSkillset: skillsetName });
    }

    return {
      success: true,
      cancelled: false,
      message: `Installed and activated skillset "${bold({ text: skillsetName })}"`,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error(`Failed to install skillset "${skillsetName}": ${errorMessage}`);
    return {
      success: false,
      cancelled: false,
      message: `Failed to install skillset "${skillsetName}": ${errorMessage}`,
    };
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
        nonInteractive: globalOpts.nonInteractive || null,
        silent: globalOpts.silent || null,
      });

      if (!result.success) {
        process.exit(1);
      }
    });
};
