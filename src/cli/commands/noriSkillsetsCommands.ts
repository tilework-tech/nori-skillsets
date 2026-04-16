/**
 * Nori Skillsets CLI command registration functions
 *
 * These functions register simplified command names (search, download, install, update, upload)
 * for the nori-skillsets CLI, reusing the existing *Main implementation functions from the registry-* commands.
 *
 * The registry-* prefixed commands are also available as aliases.
 */

import { intro, outro } from "@clack/prompts";

import { AgentRegistry } from "@/cli/features/agentRegistry.js";

import type { Command } from "commander";

/**
 * Wrap a command action with intro/outro framing.
 * The intro is displayed before the command runs, and the outro is displayed
 * after based on the command's returned status.
 *
 * @param args - Wrapper configuration
 * @param args.title - The intro title to display
 * @param args.action - The async action to execute
 * @param args.exitOnFailure - If true, call process.exit(1) when result.success is false
 * @param args.silent - If true, suppress intro/outro framing output
 */
const wrapWithFraming = async <
  T extends { success: boolean; cancelled: boolean; message: string },
>(args: {
  title: string;
  action: () => Promise<T>;
  exitOnFailure?: boolean | null;
  silent?: boolean | null;
}): Promise<void> => {
  const { title, action, exitOnFailure, silent } = args;
  if (!silent) {
    intro(title);
  }
  try {
    const result = await action();
    if (!result.cancelled && !silent) {
      outro(result.message);
    }
    if (exitOnFailure && !result.success && !result.cancelled) {
      process.exit(1);
    }
  } catch (err) {
    if (!silent) {
      outro(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(1);
  }
};

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
      const { factoryResetMain } =
        await import("@/cli/commands/factory-reset/factoryReset.js");
      const globalOpts = program.opts();
      await wrapWithFraming({
        title: `Factory Reset ${agentName}`,
        exitOnFailure: true,
        action: () =>
          factoryResetMain({
            agentName,
            nonInteractive: globalOpts.nonInteractive || null,
          }),
      });
    });
};

/**
 * Register the 'fork' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsForkCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  const forkAction = async (baseSkillset: string, newSkillset: string) => {
    const { forkSkillsetMain } =
      await import("@/cli/commands/fork-skillset/forkSkillset.js");
    await wrapWithFraming({
      title: "Fork Skillset",
      exitOnFailure: true,
      action: () => forkSkillsetMain({ baseSkillset, newSkillset }),
    });
  };

  // Primary command: fork (shorthand, canonical)
  program
    .command("fork <base-skillset> <new-skillset>")
    .description("Fork an existing skillset to a new name")
    .action(forkAction);

  // Hidden alias: fork-skillset (long form)
  program
    .command("fork-skillset <base-skillset> <new-skillset>", { hidden: true })
    .action(forkAction);

  // Hidden alias: fork-skillsets (plural)
  program
    .command("fork-skillsets <base-skillset> <new-skillset>", { hidden: true })
    .action(forkAction);
};

/**
 * Register the 'new' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsNewCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  const newAction = async () => {
    const { newSkillsetMain } =
      await import("@/cli/commands/new-skillset/newSkillset.js");
    await wrapWithFraming({
      title: "Create New Skillset",
      exitOnFailure: true,
      action: () => newSkillsetMain(),
    });
  };

  // Primary command: new
  program
    .command("new")
    .description("Create a new empty skillset")
    .action(newAction);

  // Hidden alias: new-skillset
  program.command("new-skillset", { hidden: true }).action(newAction);
};

/**
 * Register the 'register' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsRegisterCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  const registerAction = async (name: string | undefined) => {
    const { registerSkillsetMain } =
      await import("@/cli/commands/register-skillset/registerSkillset.js");
    await wrapWithFraming({
      title: "Register Skillset",
      exitOnFailure: true,
      action: () => registerSkillsetMain({ skillsetName: name || null }),
    });
  };

  // Primary command: register
  program
    .command("register [name]")
    .description(
      "Create nori.json for an existing skillset (defaults to current active skillset)",
    )
    .action(registerAction);

  // Hidden alias: register-skillset
  program
    .command("register-skillset [name]", { hidden: true })
    .action(registerAction);
};

/**
 * Register the 'edit' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsEditSkillsetCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  const editAction = async (
    name: string | undefined,
    options: { agent?: string },
  ) => {
    const { editSkillsetMain } =
      await import("@/cli/commands/edit-skillset/editSkillset.js");
    const globalOpts = program.opts();
    await wrapWithFraming({
      title: "Edit Skillset",
      exitOnFailure: true,
      action: () =>
        editSkillsetMain({
          name: name || null,
          agent: options.agent || globalOpts.agent || null,
        }),
    });
  };

  // Primary command: edit (shorthand, canonical)
  program
    .command("edit [name]")
    .description(
      "Open the active skillset folder in VS Code (or a specified skillset)",
    )
    .option("-a, --agent <name>", "AI agent to get skillset for")
    .action(editAction);

  // Hidden alias: edit-skillset (long form)
  program
    .command("edit-skillset [name]", { hidden: true })
    .option("-a, --agent <name>", "AI agent to get skillset for")
    .action(editAction);

  // Hidden alias: edit-skillsets (plural)
  program
    .command("edit-skillsets [name]", { hidden: true })
    .option("-a, --agent <name>", "AI agent to get skillset for")
    .action(editAction);
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
      const { initMain } = await import("@/cli/commands/init/init.js");
      const globalOpts = program.opts();
      await wrapWithFraming({
        title: "Initialize Nori",
        action: () =>
          initMain({
            installDir: globalOpts.installDir || null,
            nonInteractive: globalOpts.nonInteractive || null,
          }),
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
    .description(
      "Search for skillsets, skills, and subagents in your org's registry",
    )
    .action(async (query: string) => {
      const { registrySearchMain } =
        await import("@/cli/commands/registry-search/registrySearch.js");
      const globalOpts = program.opts();
      await wrapWithFraming({
        title: "Search Nori Registry",
        action: () =>
          registrySearchMain({
            query,
            installDir: globalOpts.installDir || null,
            cliName: "nori-skillsets",
          }),
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
        const { registryDownloadMain } =
          await import("@/cli/commands/registry-download/registryDownload.js");
        const globalOpts = program.opts();

        await wrapWithFraming({
          title: "Download Skillset",
          exitOnFailure: true,
          silent: globalOpts.silent || null,
          action: () =>
            registryDownloadMain({
              packageSpec,
              installDir: globalOpts.installDir || null,
              registryUrl: options.registry || null,
              listVersions: options.listVersions || null,
              cliName: "nori-skillsets",
              nonInteractive: globalOpts.nonInteractive || null,
              silent: globalOpts.silent || null,
            }),
        });
      },
    );
};

/**
 * Register the 'upload' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsUploadCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("upload <skillset>")
    .description("Upload a skillset to the Nori registry")
    .option("--registry <url>", "Upload to a specific registry URL")
    .option(
      "--list-versions",
      "List available versions for the skillset instead of uploading",
    )
    .option("--dry-run", "Show what would be uploaded without uploading")
    .option("--description <text>", "Description for this version")
    .action(
      async (
        skillsetSpec: string,
        options: {
          registry?: string;
          listVersions?: boolean;
          dryRun?: boolean;
          description?: string;
        },
      ) => {
        const { registryUploadMain } =
          await import("@/cli/commands/registry-upload/registryUpload.js");
        const globalOpts = program.opts();

        await wrapWithFraming({
          title: "Upload Skillset",
          exitOnFailure: true,
          action: () =>
            registryUploadMain({
              profileSpec: skillsetSpec,
              cwd: process.cwd(),
              installDir: globalOpts.installDir || null,
              registryUrl: options.registry || null,
              listVersions: options.listVersions || null,
              nonInteractive: globalOpts.nonInteractive || null,
              silent: globalOpts.silent || null,
              dryRun: options.dryRun || null,
              description: options.description || null,
            }),
        });
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
    .action(async (packageSpec: string) => {
      const { registryInstallMain } =
        await import("@/cli/commands/registry-install/registryInstall.js");
      const globalOpts = program.opts();

      await wrapWithFraming({
        title: "Install Skillset",
        exitOnFailure: true,
        silent: globalOpts.silent || null,
        action: () =>
          registryInstallMain({
            packageSpec,
            installDir: globalOpts.installDir || null,
            nonInteractive: globalOpts.nonInteractive || null,
            silent: globalOpts.silent || null,
            agent: globalOpts.agent || null,
          }),
      });
    });
};

/**
 * Register the 'switch' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsSwitchSkillsetCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  const switchAction = async (
    name: string | undefined,
    options: { agent?: string; force?: boolean },
  ) => {
    const { switchSkillsetAction } =
      await import("@/cli/commands/switch-skillset/switchSkillset.js");
    await wrapWithFraming({
      title: "Switch Skillset",
      action: () =>
        switchSkillsetAction({ name: name ?? null, options, program }),
    });
  };

  // Primary command: switch (shorthand, canonical)
  program
    .command("switch [name]")
    .description("Switch to a different skillset and reinstall")
    .option("-a, --agent <name>", "AI agent to switch skillset for")
    .option("--force", "Force switch even when local changes are detected")
    .action(switchAction);

  // Hidden alias: switch-skillset (long form)
  program
    .command("switch-skillset [name]", { hidden: true })
    .option("-a, --agent <name>", "AI agent to switch skillset for")
    .option("--force", "Force switch even when local changes are detected")
    .action(switchAction);

  // Hidden alias: switch-skillsets (plural)
  program
    .command("switch-skillsets [name]", { hidden: true })
    .option("-a, --agent <name>", "AI agent to switch skillset for")
    .option("--force", "Force switch even when local changes are detected")
    .action(switchAction);

  // Hidden alias: use (semantic shorthand, like nvm use)
  program
    .command("use [name]", { hidden: true })
    .option("-a, --agent <name>", "AI agent to switch skillset for")
    .option("--force", "Force switch even when local changes are detected")
    .action(switchAction);
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
        const { skillDownloadMain } =
          await import("@/cli/commands/skill-download/skillDownload.js");
        const globalOpts = program.opts();

        await wrapWithFraming({
          title: "Download Skill",
          silent: globalOpts.silent || null,
          action: () =>
            skillDownloadMain({
              skillSpec,
              installDir: globalOpts.installDir || null,
              registryUrl: options.registry || null,
              listVersions: options.listVersions || null,
              skillset: options.skillset || null,
              cliName: "nori-skillsets",
              nonInteractive: globalOpts.nonInteractive || null,
              silent: globalOpts.silent || null,
            }),
        });
      },
    );
};

/**
 * Register the 'upload-skill' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsUploadSkillCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("upload-skill <skill>")
    .description(
      "Upload a single skill from ~/.nori/profiles/<skillset>/skills/ to the Nori registry",
    )
    .option(
      "--skillset <name>",
      "Source skillset (defaults to active skillset)",
    )
    .option("--registry <url>", "Upload to a specific registry URL")
    .option("--version <version>", "Explicit version to publish")
    .option("--description <text>", "Description for this version")
    .action(
      async (
        skillSpec: string,
        options: {
          skillset?: string;
          registry?: string;
          version?: string;
          description?: string;
        },
      ) => {
        const { skillUploadMain } =
          await import("@/cli/commands/skill-upload/skillUpload.js");
        const globalOpts = program.opts();

        await wrapWithFraming({
          title: "Upload Skill",
          exitOnFailure: true,
          silent: globalOpts.silent || null,
          action: () =>
            skillUploadMain({
              skillSpec,
              skillset: options.skillset || null,
              registryUrl: options.registry || null,
              version: options.version || null,
              description: options.description || null,
              cliName: "nori-skillsets",
              nonInteractive: globalOpts.nonInteractive || null,
              silent: globalOpts.silent || null,
            }),
        });
      },
    );
};

/**
 * Register the 'download-subagent' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsDownloadSubagentCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("download-subagent <subagent>")
    .description(
      "Download and install a subagent package from the Nori registrar",
    )
    .option(
      "--registry <url>",
      "Download from a specific registry URL instead of searching all registries",
    )
    .option(
      "--list-versions",
      "List available versions for the subagent instead of downloading",
    )
    .option(
      "--skillset <name>",
      "Add subagent to the specified skillset's nori.json (defaults to active skillset)",
    )
    .action(
      async (
        subagentSpec: string,
        options: {
          registry?: string;
          listVersions?: boolean;
          skillset?: string;
        },
      ) => {
        const { subagentDownloadMain } =
          await import("@/cli/commands/subagent-download/subagentDownload.js");
        const globalOpts = program.opts();

        await wrapWithFraming({
          title: "Download Subagent",
          silent: globalOpts.silent || null,
          action: () =>
            subagentDownloadMain({
              subagentSpec,
              installDir: globalOpts.installDir || null,
              registryUrl: options.registry || null,
              listVersions: options.listVersions || null,
              skillset: options.skillset || null,
              cliName: "nori-skillsets",
              nonInteractive: globalOpts.nonInteractive || null,
              silent: globalOpts.silent || null,
            }),
        });
      },
    );
};

/**
 * Register the 'list' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsListSkillsetsCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  const listAction = async () => {
    const { listSkillsetsMain } =
      await import("@/cli/commands/list-skillsets/listSkillsets.js");
    await listSkillsetsMain();
  };

  // Primary command: list (shorthand, canonical)
  program
    .command("list")
    .description("List locally available skillsets (one per line)")
    .action(listAction);

  // Hidden alias: list-skillsets (long form, plural)
  program.command("list-skillsets", { hidden: true }).action(listAction);

  // Hidden alias: list-skillset (long form, singular)
  program.command("list-skillset", { hidden: true }).action(listAction);

  // Hidden alias: ls (Unix convention)
  program.command("ls", { hidden: true }).action(listAction);
};

/**
 * Register the 'list-active' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsListActiveCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  const listActiveAction = async () => {
    const { listActiveMain } =
      await import("@/cli/commands/list-active/listActive.js");
    const installDir = program.opts().installDir as string | undefined;
    await listActiveMain({ dir: installDir });
  };

  program
    .command("list-active")
    .description(
      "List active skillsets in current directory and parent directories (one per line)",
    )
    .action(listActiveAction);

  // Hidden alias: la (shorthand)
  program.command("la", { hidden: true }).action(listActiveAction);
};

/**
 * Register the 'current' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsCurrentCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  const currentAction = async (options: { agent?: string }) => {
    const { currentSkillsetMain } =
      await import("@/cli/commands/current-skillset/currentSkillset.js");
    const globalOpts = program.opts();
    await currentSkillsetMain({
      agent: options.agent || globalOpts.agent || null,
    });
  };

  // Primary command: current (shorthand, canonical)
  program
    .command("current")
    .description("Show the currently active skillset")
    .option("-a, --agent <name>", "AI agent to get skillset for")
    .action(currentAction);

  // Hidden alias: current-skillset (long form)
  program
    .command("current-skillset", { hidden: true })
    .option("-a, --agent <name>", "AI agent to get skillset for")
    .action(currentAction);
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
    .option("-a, --agent <name>", "Agent to watch")
    .option(
      "--set-destination",
      "Re-configure transcript upload destination organization",
    )
    .option("--_background", "Internal: run as background daemon")
    .action(
      async (options: {
        agent?: string;
        setDestination?: boolean;
        _background?: boolean;
      }) => {
        const { watchMain } = await import("@/cli/commands/watch/watch.js");
        await wrapWithFraming({
          title: "nori watch",
          action: () =>
            watchMain({
              agent:
                options.agent ??
                AgentRegistry.getInstance().getDefaultAgentName(),
              setDestination: options.setDestination ?? false,
              _background: options._background ?? false,
            }),
        });
      },
    );

  watchCmd
    .command("stop")
    .description("Stop the watch daemon")
    .action(async () => {
      const { watchStopMain } = await import("@/cli/commands/watch/watch.js");
      await watchStopMain({
        quiet: false,
      });
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
    .option(
      "--token <token>",
      "API token (nori_<orgId>_<64hex>) for non-interactive private-org auth",
    )
    .action(
      async (options: {
        email?: string;
        password?: string;
        google?: boolean;
        localhost?: boolean;
        token?: string;
      }) => {
        const { loginMain } = await import("@/cli/commands/login/login.js");
        const globalOpts = program.opts();
        await wrapWithFraming({
          title: "Login to Nori Skillsets",
          action: () =>
            loginMain({
              installDir: globalOpts.installDir || null,
              nonInteractive: globalOpts.nonInteractive || null,
              email: options.email || null,
              password: options.password || null,
              google: options.google || null,
              noLocalhost: options.localhost === false ? true : null,
              token: options.token || null,
            }),
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
      const { logoutMain } = await import("@/cli/commands/logout/logout.js");
      await logoutMain();
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
    .option("--new <name>", "Create a new skillset and install skills into it")
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
          new?: string;
          skill?: string;
          all?: boolean;
          ref?: string;
        },
      ) => {
        const { externalMain } =
          await import("@/cli/commands/external/external.js");
        const globalOpts = program.opts();

        await wrapWithFraming({
          title: "External Skills",
          action: () =>
            externalMain({
              source,
              installDir: globalOpts.installDir || null,
              skillset: options.skillset || null,
              newSkillset: options.new || null,
              skill: options.skill || null,
              all: options.all || null,
              ref: options.ref || null,
              cliName: "nori-skillsets",
            }),
        });
      },
    );
};

/**
 * Register the 'dir' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsDirCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("dir")
    .description("Open the Nori skillsets directory")
    .action(async () => {
      const { dirMain } = await import("@/cli/commands/dir/dir.js");
      const globalOpts = program.opts();
      await dirMain({
        nonInteractive: globalOpts.nonInteractive || null,
      });
    });
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

  const installLocationAction = async () => {
    const { installLocationMain } =
      await import("@/cli/commands/install-location/installLocation.js");
    const globalOpts = program.opts();
    await installLocationMain({
      nonInteractive: globalOpts.nonInteractive || null,
    });
  };

  program
    .command("install-location")
    .description("Display Nori installation directories")
    .action(installLocationAction);

  // Hidden alias: location (shorthand)
  program.command("location", { hidden: true }).action(installLocationAction);
};

/**
 * Register the 'completion' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsCompletionCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("completion <shell>")
    .description("Generate shell completion script (bash, zsh)")
    .action(async (shell: string) => {
      const { completionMain } =
        await import("@/cli/commands/completion/completion.js");
      completionMain({ shell });
    });
};

/**
 * Register the 'clear' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsClearCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("clear")
    .description(
      "Remove all Nori-managed configuration from the install directory",
    )
    .action(async () => {
      const { clearMain } = await import("@/cli/commands/clear/clear.js");
      const globalOpts = program.opts();
      await clearMain({
        installDir: globalOpts.installDir || null,
        agent: globalOpts.agent || null,
      });
    });
};

/**
 * Register the 'config' command for nori-skillsets CLI
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerNoriSkillsetsConfigCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("config")
    .description("Configure default agent and install directory")
    .option(
      "--agents <agents>",
      "Comma-separated list of agents (e.g., claude-code,cursor)",
    )
    .option(
      "--redownload-on-switch",
      "Enable re-download prompt on skillset switch",
    )
    .option(
      "--no-redownload-on-switch",
      "Disable re-download prompt on skillset switch",
    )
    .action(
      async (options: { agents?: string; redownloadOnSwitch?: boolean }) => {
        const { configMain } = await import("@/cli/commands/config/config.js");
        const globalOpts = program.opts();
        await wrapWithFraming({
          title: "Configure Nori",
          silent: globalOpts.silent || null,
          action: () =>
            configMain({
              agents: options.agents ?? null,
              installDir: globalOpts.installDir || null,
              redownloadOnSwitch: options.redownloadOnSwitch ?? null,
              nonInteractive: globalOpts.nonInteractive || null,
            }),
        });
      },
    );
};
