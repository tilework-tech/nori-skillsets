#!/usr/bin/env node

/**
 * Nori Profiles CLI Router
 *
 * Routes commands to the appropriate installer/uninstaller using commander.js.
 */

import { Command } from "commander";

import { checkMain } from "@/installer/check.js";
import { registerInstallCommand } from "@/installer/install.js";
import { error, success, info } from "@/installer/logger.js";
import { switchProfile } from "@/installer/profiles.js";
import { registerRegistryDownloadCommand } from "@/installer/registryDownload.js";
import { registerRegistrySearchCommand } from "@/installer/registrySearch.js";
import { registerRegistryUploadCommand } from "@/installer/registryUpload.js";
import { registerUninstallCommand } from "@/installer/uninstall.js";
import { getCurrentPackageVersion } from "@/installer/version.js";
import { normalizeInstallDir, getInstallDirs } from "@/utils/path.js";

/**
 * Register the 'check' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
const registerCheckCommand = (args: { program: Command }): void => {
  const { program } = args;

  program
    .command("check")
    .description("Validate Nori installation and configuration")
    .action(async () => {
      // Get global options from parent
      const globalOpts = program.opts();

      await checkMain({
        installDir: globalOpts.installDir || null,
      });
    });
};

/**
 * Register the 'switch-profile' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
const registerSwitchProfileCommand = (args: { program: Command }): void => {
  const { program } = args;

  program
    .command("switch-profile <name>")
    .description("Switch to a different profile and reinstall")
    .action(async (name: string) => {
      // Get global options from parent
      const globalOpts = program.opts();

      // Switch to the profile
      await switchProfile({
        profileName: name,
        installDir: globalOpts.installDir || null,
      });

      // Run install in non-interactive mode with skipUninstall
      // This preserves custom user profiles during the profile switch
      info({ message: "Applying profile configuration..." });
      const { main: installMain } = await import("@/installer/install.js");
      await installMain({
        nonInteractive: true,
        skipUninstall: true,
        installDir: globalOpts.installDir || null,
      });
    });
};

/**
 * Register the 'install-location' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
const registerInstallLocationCommand = (args: { program: Command }): void => {
  const { program } = args;

  program
    .command("install-location")
    .description("Display Nori installation directories")
    .action(async () => {
      const currentDir = process.cwd();
      const installDirs = getInstallDirs({ currentDir });

      if (installDirs.length === 0) {
        error({
          message:
            "No Nori installations found in current directory or parent directories",
        });
        process.exit(1);
      }

      console.log("");
      info({ message: "Nori installation directories:" });
      console.log("");

      for (const dir of installDirs) {
        success({ message: `  ${dir}` });
      }

      console.log("");
    });
};

const program = new Command();
const version = getCurrentPackageVersion() || "unknown";

program
  .name("nori-ai")
  .version(version)
  .description(`Nori Profiles - Claude Code Configuration Manager v${version}`)
  .option(
    "-d, --install-dir <path>",
    "Custom installation directory (default: ~/.claude)",
    (value) => normalizeInstallDir({ installDir: value }),
  )
  .option("-n, --non-interactive", "Run without interactive prompts")
  .addHelpText(
    "after",
    `
Examples:
  $ nori-ai install --install-dir ~/my-dir
  $ nori-ai uninstall
  $ nori-ai check
  $ nori-ai install-location
  $ nori-ai switch-profile senior-swe
  $ nori-ai registry-search typescript
  $ nori-ai registry-download my-profile
  $ nori-ai registry-download my-profile@1.0.0
  $ nori-ai registry-upload my-profile
  $ nori-ai registry-upload my-profile@1.0.0 --registry https://registry.example.com
  $ nori-ai --non-interactive install
`,
  );

// Register all commands
registerInstallCommand({ program });
registerUninstallCommand({ program });
registerCheckCommand({ program });
registerSwitchProfileCommand({ program });
registerInstallLocationCommand({ program });
registerRegistrySearchCommand({ program });
registerRegistryDownloadCommand({ program });
registerRegistryUploadCommand({ program });

program.parse(process.argv);

// Show help if no command provided
if (process.argv.length < 3) {
  program.help();
}
