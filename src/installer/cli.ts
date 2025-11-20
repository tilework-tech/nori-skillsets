#!/usr/bin/env node

/**
 * Nori Profiles CLI Router
 *
 * Routes commands to the appropriate installer/uninstaller using commander.js.
 */

import { Command } from "commander";

import { registerCheckCommand } from "@/installer/commands/check.js";
import { registerInstallCommand } from "@/installer/commands/install.js";
import { registerSwitchProfileCommand } from "@/installer/commands/switchProfile.js";
import { registerUninstallCommand } from "@/installer/commands/uninstall.js";
import { main as installMain } from "@/installer/install.js";
import { getCurrentPackageVersion } from "@/installer/version.js";
import { normalizeInstallDir } from "@/utils/path.js";

// Import version from package.json at the project root

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
  $ nori-ai switch-profile senior-swe
  $ nori-ai --non-interactive install
`,
  );

// Register all commands
registerInstallCommand({ program });
registerUninstallCommand({ program });
registerCheckCommand({ program });
registerSwitchProfileCommand({ program });

// Default action when no command is provided
program.action(async () => {
  const opts = program.opts();
  await installMain({
    nonInteractive: opts.nonInteractive || null,
    installDir: opts.installDir || null,
  });
});

program.parse(process.argv);
