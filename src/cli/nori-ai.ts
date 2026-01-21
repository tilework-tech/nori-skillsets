#!/usr/bin/env node

/**
 * Nori Profiles CLI Router
 *
 * Routes commands to the appropriate installer/uninstaller using commander.js.
 */

import { Command } from "commander";

import { registerCheckCommand } from "@/cli/commands/check/check.js";
import { registerInstallCommand } from "@/cli/commands/install/install.js";
import { registerInstallLocationCommand } from "@/cli/commands/install-location/installLocation.js";
import { registerRegistryDownloadCommand } from "@/cli/commands/registry-download/registryDownload.js";
import { registerRegistryInstallCommand } from "@/cli/commands/registry-install/registryInstall.js";
import { registerRegistrySearchCommand } from "@/cli/commands/registry-search/registrySearch.js";
import { registerRegistryUpdateCommand } from "@/cli/commands/registry-update/registryUpdate.js";
import { registerRegistryUploadCommand } from "@/cli/commands/registry-upload/registryUpload.js";
import { registerSkillDownloadCommand } from "@/cli/commands/skill-download/skillDownload.js";
import { registerSkillUploadCommand } from "@/cli/commands/skill-upload/skillUpload.js";
import { registerSwitchProfileCommand } from "@/cli/commands/switch-profile/profiles.js";
import { registerUninstallCommand } from "@/cli/commands/uninstall/uninstall.js";
import { trackInstallLifecycle } from "@/cli/installTracking.js";
import { getCurrentPackageVersion } from "@/cli/version.js";
import { normalizeInstallDir } from "@/utils/path.js";

const program = new Command();
const version = getCurrentPackageVersion() || "unknown";

void trackInstallLifecycle({ currentVersion: version });

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
  .option("-s, --silent", "Suppress all output (implies --non-interactive)")
  .option(
    "-a, --agent <name>",
    "AI agent to use (auto-detected from config, or claude-code)",
  )
  .addHelpText(
    "after",
    `
Examples:
  $ nori-ai install --install-dir ~/my-dir
  $ nori-ai install --agent claude-code
  $ nori-ai uninstall
  $ nori-ai check
  $ nori-ai install-location
  $ nori-ai switch-profile senior-swe
  $ nori-ai registry-search typescript  # searches both profiles and skills
  $ nori-ai registry-download my-profile
  $ nori-ai registry-download my-profile@1.0.0
  $ nori-ai registry-download my-profile --list-versions
  $ nori-ai registry-install my-profile
  $ nori-ai registry-install my-profile --user
  $ nori-ai registry-update my-profile
  $ nori-ai registry-upload my-profile
  $ nori-ai registry-upload my-profile@1.0.0 --registry https://registry.example.com
  $ nori-ai skill-download my-skill
  $ nori-ai skill-download my-skill@1.0.0
  $ nori-ai skill-download my-skill --list-versions
  $ nori-ai skill-upload my-skill
  $ nori-ai skill-upload my-skill@1.0.0 --registry https://registry.example.com
  $ nori-ai --non-interactive install
  $ nori-ai --silent install
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
registerRegistryInstallCommand({ program });
registerRegistryUpdateCommand({ program });
registerRegistryUploadCommand({ program });
registerSkillDownloadCommand({ program });
registerSkillUploadCommand({ program });

program.parse(process.argv);

// Show help if no command provided
if (process.argv.length < 3) {
  program.help();
}
