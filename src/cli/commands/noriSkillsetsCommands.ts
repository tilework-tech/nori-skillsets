/**
 * Nori Skillsets CLI command registration functions
 *
 * These functions register simplified command names (search, download, install, update, upload)
 * for the nori-skillsets CLI, reusing the existing *Main implementation functions from the registry-* commands.
 *
 * The nori-ai CLI continues to use the registry-* prefixed commands.
 */

import { initMain } from "@/cli/commands/init/init.js";
import { listSkillsetsMain } from "@/cli/commands/list-skillsets/listSkillsets.js";
import { loginMain } from "@/cli/commands/login/login.js";
import { logoutMain } from "@/cli/commands/logout/logout.js";
import { registryDownloadMain } from "@/cli/commands/registry-download/registryDownload.js";
import { registryInstallMain } from "@/cli/commands/registry-install/registryInstall.js";
import { registrySearchMain } from "@/cli/commands/registry-search/registrySearch.js";
import { skillDownloadMain } from "@/cli/commands/skill-download/skillDownload.js";
import { switchSkillsetAction } from "@/cli/commands/switch-profile/profiles.js";
import { watchMain, watchStopMain } from "@/cli/commands/watch/watch.js";

import type { Command } from "commander";

/**
 * Register the 'init' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsInitCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("init")
    .description("Initialize Nori configuration and directories")
    .action(async () => {
      const globalOpts = program.opts();
      await initMain({
        installDir: globalOpts.installDir || null,
        nonInteractive: globalOpts.nonInteractive || null,
      });
    });
};

/**
 * Register the 'search' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsSearchCommand = (args: {
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
        cliName: "nori-skillsets",
      });
    });
};

/**
 * Register the 'download' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsDownloadCommand = (args: {
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
          cliName: "nori-skillsets",
        });

        if (!result.success) {
          process.exit(1);
        }
      },
    );
};

/**
 * Register the 'install' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsInstallCommand = (args: {
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
 * Register the 'switch-skillset' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsSwitchSkillsetCommand = (args: {
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
 * Register the 'download-skill' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsDownloadSkillCommand = (args: {
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
    .option(
      "--skillset <name>",
      "Add skill to the specified skillset's manifest (defaults to active skillset)",
    )
    .action(
      async (
        skillSpec: string,
        options: {
          registry?: string;
          listVersions?: boolean;
          skillset?: string;
        },
      ) => {
        const globalOpts = program.opts();

        await skillDownloadMain({
          skillSpec,
          installDir: globalOpts.installDir || null,
          registryUrl: options.registry || null,
          listVersions: options.listVersions || null,
          skillset: options.skillset || null,
          cliName: "nori-skillsets",
        });
      },
    );
};

/**
 * Register the 'list-skillsets' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsListSkillsetsCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("list-skillsets")
    .description("List locally available skillsets (one per line)")
    .action(async () => {
      const globalOpts = program.opts();
      await listSkillsetsMain({
        installDir: globalOpts.installDir || null,
        agent: globalOpts.agent || null,
      });
    });
};

/**
 * Register the 'watch' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsWatchCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  const watchCmd = program
    .command("watch")
    .description(
      "Watch Claude Code sessions and save transcripts to ~/.nori/transcripts/",
    )
    .option("-a, --agent <name>", "Agent to watch", "claude-code")
    .action(async (options: { agent: string }) => {
      await watchMain({
        agent: options.agent,
        daemon: true,
      });
    });

  watchCmd
    .command("stop")
    .description("Stop the watch daemon")
    .action(async () => {
      await watchStopMain({ quiet: false });
    });
};

/**
 * Register the 'login' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsLoginCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("login")
    .description("Authenticate with noriskillsets.dev")
    .option("-e, --email <email>", "Email address (for non-interactive mode)")
    .option("-p, --password <password>", "Password (for non-interactive mode)")
    .action(async (options: { email?: string; password?: string }) => {
      const globalOpts = program.opts();
      await loginMain({
        installDir: globalOpts.installDir || null,
        nonInteractive: globalOpts.nonInteractive || null,
        email: options.email || null,
        password: options.password || null,
      });
    });
};

/**
 * Register the 'logout' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsLogoutCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("logout")
    .description("Clear stored authentication credentials")
    .action(async () => {
      const globalOpts = program.opts();
      await logoutMain({
        installDir: globalOpts.installDir || null,
      });
    });
};
