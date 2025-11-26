#!/usr/bin/env node

/**
 * Nori Profiles CLI Router
 *
 * Routes commands to the appropriate installer/uninstaller using commander.js.
 */

import { Command } from "commander";

import { handshake } from "@/api/index.js";
import {
  loadConfig,
  validateConfig,
  getDefaultProfile,
  isPaidInstall,
} from "@/installer/config.js";
import { LoaderRegistry } from "@/installer/features/loaderRegistry.js";
import { registerInstallCommand } from "@/installer/install.js";
import { error, success, info } from "@/installer/logger.js";
import { switchProfile } from "@/installer/profiles.js";
import { registerUninstallCommand } from "@/installer/uninstall.js";
import { getCurrentPackageVersion } from "@/installer/version.js";
import { normalizeInstallDir, getInstallDirs } from "@/utils/path.js";

/**
 * Run validation checks on Nori installation
 * @param args - Configuration arguments
 * @param args.installDir - Custom installation directory (optional)
 */
const checkMain = async (args?: {
  installDir?: string | null;
}): Promise<void> => {
  // Normalize installDir to a definite string value
  const installDir = normalizeInstallDir({ installDir: args?.installDir });

  console.log("");
  info({ message: "Running Nori Profiles validation checks..." });
  console.log("");

  let hasErrors = false;

  // Check config
  info({ message: "Checking configuration..." });
  const configResult = await validateConfig({ installDir });
  if (configResult.valid) {
    success({ message: `   ✓ ${configResult.message}` });
  } else {
    error({ message: `   ✗ ${configResult.message}` });
    if (configResult.errors) {
      for (const err of configResult.errors) {
        info({ message: `     - ${err}` });
      }
    }
    hasErrors = true;
  }
  console.log("");

  // Load config
  const existingConfig = await loadConfig({ installDir });
  const config = existingConfig ?? {
    profile: getDefaultProfile(),
    installDir,
  };

  // Check server connectivity (paid mode only)
  if (isPaidInstall({ config })) {
    info({ message: "Testing server connection..." });
    try {
      const response = await handshake();
      success({
        message: `   ✓ Server authentication successful (user: ${response.user})`,
      });
    } catch (err: any) {
      error({ message: "   ✗ Server authentication failed" });
      info({ message: `     - ${err.message}` });
      hasErrors = true;
    }
    console.log("");
  }

  // Run validation for all loaders
  const registry = LoaderRegistry.getInstance();
  const loaders = registry.getAll();

  info({ message: "Checking feature installations..." });

  for (const loader of loaders) {
    if (loader.validate) {
      try {
        const result = await loader.validate({ config });
        if (result.valid) {
          success({ message: `   ✓ ${loader.name}: ${result.message}` });
        } else {
          error({ message: `   ✗ ${loader.name}: ${result.message}` });
          if (result.errors) {
            for (const err of result.errors) {
              info({ message: `     - ${err}` });
            }
          }
          hasErrors = true;
        }
      } catch (err: any) {
        error({ message: `   ✗ ${loader.name}: Validation failed` });
        info({ message: `     - ${err.message}` });
        hasErrors = true;
      }
    }
  }

  console.log("");
  console.log("=".repeat(70));

  if (hasErrors) {
    error({ message: "Validation completed with errors" });
    process.exit(1);
  } else {
    success({ message: "All validation checks passed!" });
    info({
      message: `Installation mode: ${isPaidInstall({ config }) ? "paid" : "free"}`,
    });
  }
};

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
  $ nori-ai --non-interactive install
`,
  );

// Register all commands
registerInstallCommand({ program });
registerUninstallCommand({ program });
registerCheckCommand({ program });
registerSwitchProfileCommand({ program });
registerInstallLocationCommand({ program });

program.parse(process.argv);

// Show help if no command provided
if (process.argv.length < 3) {
  program.help();
}
