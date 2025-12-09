#!/usr/bin/env node

/**
 * Nori Profiles CLI Router
 *
 * Routes commands to the appropriate installer/uninstaller using commander.js.
 */

import { Command } from "commander";

import { registerCheckCommand } from "@/cli/commands/check/check.js";
import { registerInstallCommand } from "@/cli/commands/install/install.js";
import { registerInstallCursorCommand } from "@/cli/commands/install-cursor/installCursor.js";
import { registerInstallLocationCommand } from "@/cli/commands/install-location/installLocation.js";
import { registerRegistryDownloadCommand } from "@/cli/commands/registry-download/registryDownload.js";
import { registerRegistrySearchCommand } from "@/cli/commands/registry-search/registrySearch.js";
import { registerRegistryUploadCommand } from "@/cli/commands/registry-upload/registryUpload.js";
import { registerSwitchProfileCommand } from "@/cli/commands/switch-profile/profiles.js";
import { registerUninstallCommand } from "@/cli/commands/uninstall/uninstall.js";
import { getCurrentPackageVersion } from "@/cli/version.js";
import { normalizeInstallDir } from "@/utils/path.js";

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
registerInstallCursorCommand({ program });
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
