/**
 * CLI command for installing a profile from the public registry in one step
 * Handles: nori-ai registry-install <package>[@version] [--user]
 */

import * as os from "os";

import { REGISTRAR_URL } from "@/api/registrar.js";
import { main as installMain } from "@/cli/commands/install/install.js";
import { hasExistingInstallation } from "@/cli/commands/install/installState.js";
import { registryDownloadMain } from "@/cli/commands/registry-download/registryDownload.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
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

export const registryInstallMain = async (
  args: RegistryInstallArgs,
): Promise<void> => {
  const { packageSpec, cwd, installDir, useHomeDir, silent, agent } = args;

  const targetInstallDir = resolveInstallDir({
    cwd,
    installDir,
    useHomeDir,
  });

  const profileName = parsePackageName({ packageSpec });
  const agentName = agent ?? "claude-code";

  // Step 1: Download the profile from registry first (so it's available for install)
  await registryDownloadMain({
    packageSpec,
    installDir: targetInstallDir,
    registryUrl: REGISTRAR_URL,
    listVersions: null,
  });

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
    return;
  }

  // Step 3 (existing installation): Switch to the downloaded profile
  const agentImpl = AgentRegistry.getInstance().get({ name: agentName });
  await agentImpl.switchProfile({
    installDir: targetInstallDir,
    profileName,
  });

  // Step 4: Re-run install in silent mode to regenerate files with new profile
  await installMain({
    nonInteractive: true,
    skipUninstall: true,
    installDir: targetInstallDir,
    agent: agentName,
    silent: true,
  });
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

      await registryInstallMain({
        packageSpec,
        useHomeDir: options.user ?? null,
        installDir: globalOpts.installDir || null,
        cwd: process.cwd(),
        silent: globalOpts.silent || null,
        agent: globalOpts.agent || null,
      });
    });
};
