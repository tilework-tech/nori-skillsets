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
import { registryUpdateMain } from "@/cli/commands/registry-update/registryUpdate.js";
import { registryUploadMain } from "@/cli/commands/registry-upload/registryUpload.js";

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
    .description("Search for profile packages in your org's registry")
    .action(async (query: string) => {
      const globalOpts = program.opts();
      await registrySearchMain({
        query,
        installDir: globalOpts.installDir || null,
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
 * Register the 'update' command for seaweed CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerSeaweedUpdateCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("update <profile>")
    .description("Update an installed profile package to the latest version")
    .option(
      "--registry <url>",
      "Use a different registry URL instead of the stored one",
    )
    .action(async (profileName: string, options: { registry?: string }) => {
      const globalOpts = program.opts();

      await registryUpdateMain({
        profileName,
        installDir: globalOpts.installDir || null,
        registryUrl: options.registry || null,
      });
    });
};

/**
 * Register the 'upload' command for seaweed CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerSeaweedUploadCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("upload <profile>")
    .description("Upload a profile package to the Nori registrar")
    .option(
      "--registry <url>",
      "Upload to a specific registry URL instead of the default",
    )
    .action(async (profileSpec: string, options: { registry?: string }) => {
      const globalOpts = program.opts();

      await registryUploadMain({
        profileSpec,
        installDir: globalOpts.installDir || null,
        registryUrl: options.registry || null,
      });
    });
};
