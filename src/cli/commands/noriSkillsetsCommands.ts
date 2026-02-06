/**
 * Nori Skillsets CLI command registration functions
 *
 * These functions register simplified command names (search, download, install, update, upload)
 * for the nori-skillsets CLI, reusing the existing *Main implementation functions from the registry-* commands.
 *
 * The registry-* prefixed commands are also available as aliases.
 */

import { externalMain } from "@/cli/commands/external/external.js";
import { factoryResetMain } from "@/cli/commands/factory-reset/factoryReset.js";
import { initMain } from "@/cli/commands/init/init.js";
import { installLocationMain } from "@/cli/commands/install-location/installLocation.js";
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
 * Register the 'factory-reset' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsFactoryResetCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("factory-reset <agent-name>")
    .description(
      "Remove all configuration for a given agent (e.g., claude-code)",
    )
    .action(async (agentName: string) => {
      const globalOpts = program.opts();
      await factoryResetMain({
        agentName,
        nonInteractive: globalOpts.nonInteractive || null,
      });
    });
};

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
    .description("Search for skillsets and skills in your org's registry")
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
      "Download and install a skillset package from the Nori registrar",
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
      "Download, install, and activate a skillset from the public registry in one step",
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

  // Primary command: switch-skillset (singular, canonical)
  program
    .command("switch-skillset <name>")
    .description("Switch to a different skillset and reinstall")
    .option("-a, --agent <name>", "AI agent to switch skillset for")
    .action(async (name: string, options: { agent?: string }) => {
      await switchSkillsetAction({ name, options, program });
    });

  // Hidden alias: switch-skillsets (plural)
  program
    .command("switch-skillsets <name>", { hidden: true })
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

  // Primary command: list-skillsets (plural, canonical)
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

  // Hidden alias: list-skillset (singular)
  program.command("list-skillset", { hidden: true }).action(async () => {
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
    .option(
      "--set-destination",
      "Re-configure transcript upload destination organization",
    )
    .option("--_background", "Internal: run as background daemon")
    .action(
      async (options: {
        agent: string;
        setDestination?: boolean;
        _background?: boolean;
      }) => {
        await watchMain({
          agent: options.agent,
          setDestination: options.setDestination ?? false,
          _background: options._background ?? false,
        });
      },
    );

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
    .option("-g, --google", "Sign in with Google SSO")
    .option(
      "--no-localhost",
      "Use hosted callback page instead of localhost (for headless/SSH)",
    )
    .action(
      async (options: {
        email?: string;
        password?: string;
        google?: boolean;
        localhost?: boolean;
      }) => {
        const globalOpts = program.opts();
        await loginMain({
          installDir: globalOpts.installDir || null,
          nonInteractive: globalOpts.nonInteractive || null,
          experimentalUi: globalOpts.experimentalUi || null,
          email: options.email || null,
          password: options.password || null,
          google: options.google || null,
          noLocalhost: options.localhost === false ? true : null,
        });
      },
    );
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

/**
 * Register the 'external' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsExternalCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("external <source>")
    .description("Install skills from an external GitHub repository")
    .option(
      "--skillset <name>",
      "Add skill to the specified skillset's manifest (defaults to active skillset)",
    )
    .option(
      "--skill <name>",
      "Install only the named skill from the repository",
    )
    .option("--all", "Install all discovered skills from the repository")
    .option("--ref <ref>", "Branch or tag to checkout")
    .action(
      async (
        source: string,
        options: {
          skillset?: string;
          skill?: string;
          all?: boolean;
          ref?: string;
        },
      ) => {
        const globalOpts = program.opts();

        await externalMain({
          source,
          installDir: globalOpts.installDir || null,
          skillset: options.skillset || null,
          skill: options.skill || null,
          all: options.all || null,
          ref: options.ref || null,
          cliName: "nori-skillsets",
        });
      },
    );
};

/**
 * Register the 'install-location' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsInstallLocationCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("install-location")
    .description("Display Nori installation directories")
    .option(
      "--installation-source",
      "Show only installation source directories (containing .nori-config.json)",
    )
    .option(
      "--installation-managed",
      "Show only managed installation directories (containing CLAUDE.md with managed block)",
    )
    .action(
      async (options: {
        installationSource?: boolean;
        managedInstallation?: boolean;
      }) => {
        const globalOpts = program.opts();
        await installLocationMain({
          currentDir: process.cwd(),
          installationSource: options.installationSource || null,
          managedInstallation: options.managedInstallation || null,
          nonInteractive: globalOpts.nonInteractive || null,
        });
      },
    );
};
