/**
 * Seaweed CLI command registration functions
 *
 * These functions register simplified command names (search, download, install, update, upload)
 * for the seaweed CLI, reusing the existing *Main implementation functions from the registry-* commands.
 *
 * The nori-ai CLI continues to use the registry-* prefixed commands.
 */

import { registryDownloadMain } from "@/cli/commands/registry-download/registryDownload.js";
import { registryInstallMain } from "@/cli/commands/registry-install/registryInstall.js";
import { registrySearchMain } from "@/cli/commands/registry-search/registrySearch.js";
import { skillDownloadMain } from "@/cli/commands/skill-download/skillDownload.js";
import { switchSkillsetAction } from "@/cli/commands/switch-profile/profiles.js";

import type { Command } from "commander";

/**
 * Register the 'search' command for seaweed CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerSeaweedSearchCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("search <query>")
    .description("Search for profiles and skills in your org's registry")
    .action(async (query: string) => {
      const globalOpts = program.opts();
      await registrySearchMain({
        query,
        installDir: globalOpts.installDir || null,
        cliName: "seaweed",
      });
    });
};

/**
 * Register the 'download' command for seaweed CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerSeaweedDownloadCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("download <package>")
    .description(
      "Download and install a profile package from the Nori registrar",
    )
    .option(
      "--registry <url>",
      "Download from a specific registry URL instead of searching all registries",
    )
    .option(
      "--list-versions",
      "List available versions for the package instead of downloading",
    )
    .action(
      async (
        packageSpec: string,
        options: { registry?: string; listVersions?: boolean },
      ) => {
        const globalOpts = program.opts();

        const result = await registryDownloadMain({
          packageSpec,
          installDir: globalOpts.installDir || null,
          registryUrl: options.registry || null,
          listVersions: options.listVersions || null,
          cliName: "seaweed",
        });

        if (!result.success) {
          process.exit(1);
        }
      },
    );
};

/**
 * Register the 'install' command for seaweed CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerSeaweedInstallCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("install <package>")
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

/**
 * Register the 'switch-skillset' command for seaweed CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerSeaweedSwitchSkillsetCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("switch-skillset <name>")
    .description("Switch to a different skillset and reinstall")
    .option("-a, --agent <name>", "AI agent to switch skillset for")
    .action(async (name: string, options: { agent?: string }) => {
      await switchSkillsetAction({ name, options, program });
    });
};

/**
 * Register the 'download-skill' command for seaweed CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerSeaweedDownloadSkillCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("download-skill <skill>")
    .description("Download and install a skill package from the Nori registrar")
    .option(
      "--registry <url>",
      "Download from a specific registry URL instead of searching all registries",
    )
    .option(
      "--list-versions",
      "List available versions for the skill instead of downloading",
    )
    .action(
      async (
        skillSpec: string,
        options: { registry?: string; listVersions?: boolean },
      ) => {
        const globalOpts = program.opts();

        await skillDownloadMain({
          skillSpec,
          installDir: globalOpts.installDir || null,
          registryUrl: options.registry || null,
          listVersions: options.listVersions || null,
          cliName: "seaweed",
        });
      },
    );
};
