#!/usr/bin/env node

/**
 * Nori Skillsets CLI - Registry Operations
 *
 * A CLI focused on registry operations and skillset management.
 */

import { Command } from "commander";

import {
  registerNoriSkillsetsCompletionCommand,
  registerNoriSkillsetsCurrentCommand,
  registerNoriSkillsetsDirCommand,
  registerNoriSkillsetsDownloadCommand,
  registerNoriSkillsetsDownloadSkillCommand,
  registerNoriSkillsetsEditSkillsetCommand,
  registerNoriSkillsetsExternalCommand,
  registerNoriSkillsetsFactoryResetCommand,
  registerNoriSkillsetsForkCommand,
  registerNoriSkillsetsInitCommand,
  registerNoriSkillsetsInstallCommand,
  registerNoriSkillsetsInstallLocationCommand,
  registerNoriSkillsetsListSkillsetsCommand,
  registerNoriSkillsetsLoginCommand,
  registerNoriSkillsetsNewCommand,
  registerNoriSkillsetsRegisterCommand,
  registerNoriSkillsetsLogoutCommand,
  registerNoriSkillsetsSearchCommand,
  registerNoriSkillsetsSwitchSkillsetCommand,
  registerNoriSkillsetsUploadCommand,
  registerNoriSkillsetsWatchCommand,
} from "@/cli/commands/noriSkillsetsCommands.js";
import {
  setTileworkSource,
  trackInstallLifecycle,
} from "@/cli/installTracking.js";
import { checkForUpdateAndPrompt } from "@/cli/updates/checkForUpdate.js";
import { getCurrentPackageVersion } from "@/cli/version.js";
import { initializeProxySupport } from "@/utils/fetch.js";
import { normalizeInstallDir } from "@/utils/path.js";

// Initialize proxy support early, before any network requests
initializeProxySupport();

const program = new Command();
const version = getCurrentPackageVersion() || "unknown";

// Set the tilework source for analytics before any tracking calls
setTileworkSource({ source: "nori-skillsets" });

void trackInstallLifecycle({ currentVersion: version });

// Check for updates before parsing commands (skip for informational flags)
const isSilent =
  process.argv.includes("--silent") || process.argv.includes("-s");
const isNonInteractive =
  process.argv.includes("--non-interactive") || process.argv.includes("-n");
const isInfoOnly =
  process.argv.includes("--help") ||
  process.argv.includes("-h") ||
  process.argv.includes("--version") ||
  process.argv.includes("-V");

if (!isInfoOnly) {
  await checkForUpdateAndPrompt({
    currentVersion: version,
    isInteractive: !isNonInteractive && !isSilent,
    isSilent,
  });
}

program
  .name("nori-skillsets")
  .version(version)
  .description(`Nori Skillsets CLI - Registry Operations v${version}`)
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
  $ nori-skillsets login
  $ nori-skillsets logout
  $ nori-skillsets init
  $ nori-skillsets search typescript  # searches both skillsets and skills
  $ nori-skillsets download my-skillset
  $ nori-skillsets download my-skillset@1.0.0
  $ nori-skillsets download my-skillset --list-versions
  $ nori-skillsets upload my-skillset
  $ nori-skillsets upload my-skillset@2.0.0
  $ nori-skillsets upload myorg/my-skillset
  $ nori-skillsets upload my-skillset --list-versions
  $ nori-skillsets install my-skillset
  $ nori-skillsets install my-skillset --user
  $ nori-skillsets switch senior-swe
  $ nori-skillsets list
  $ nori-skillsets current
  $ nori-skillsets download-skill my-skill
  $ nori-skillsets download-skill my-skill@1.0.0
  $ nori-skillsets download-skill my-skill --list-versions
  $ nori-skillsets external owner/repo
  $ nori-skillsets external https://github.com/owner/repo --skill my-skill
  $ nori-skillsets external owner/repo --all --ref main
  $ nori-skillsets watch                                    # start watching Claude Code sessions
  $ nori-skillsets watch stop                               # stop the watch daemon
  $ nori-skillsets dir                                      # open the profiles directory
  $ nori-skillsets install-location                         # show all installation directories
  $ nori-skillsets install-location --installation-source   # show only source dirs
  $ nori-skillsets install-location --installation-managed  # show only managed dirs
  $ nori-skillsets install-location --non-interactive       # plain output for scripts
  $ nori-skillsets new my-skillset                          # create a new empty skillset
  $ nori-skillsets register my-skillset                     # create nori.json for existing skillset
  $ nori-skillsets register                                 # create nori.json for current skillset
  $ nori-skillsets fork senior-swe my-custom                # fork a skillset to a new name
  $ nori-skillsets edit                                     # open active skillset in VS Code
  $ nori-skillsets edit my-profile                          # open a specific skillset
  $ nori-skillsets factory-reset claude-code                # remove all Claude Code config
`,
  );

// Register simplified commands for nori-skillsets CLI
registerNoriSkillsetsLoginCommand({ program });
registerNoriSkillsetsLogoutCommand({ program });
registerNoriSkillsetsInitCommand({ program });
registerNoriSkillsetsSearchCommand({ program });
registerNoriSkillsetsDownloadCommand({ program });
registerNoriSkillsetsUploadCommand({ program });
registerNoriSkillsetsInstallCommand({ program });
registerNoriSkillsetsSwitchSkillsetCommand({ program });
registerNoriSkillsetsListSkillsetsCommand({ program });
registerNoriSkillsetsCurrentCommand({ program });
registerNoriSkillsetsDownloadSkillCommand({ program });
registerNoriSkillsetsExternalCommand({ program });
registerNoriSkillsetsWatchCommand({ program });
registerNoriSkillsetsDirCommand({ program });
registerNoriSkillsetsInstallLocationCommand({ program });
registerNoriSkillsetsCompletionCommand({ program });
registerNoriSkillsetsForkCommand({ program });
registerNoriSkillsetsNewCommand({ program });
registerNoriSkillsetsRegisterCommand({ program });
registerNoriSkillsetsEditSkillsetCommand({ program });
registerNoriSkillsetsFactoryResetCommand({ program });

program.parse(process.argv);

// Show help if no command provided
if (process.argv.length < 3) {
  program.help();
}
