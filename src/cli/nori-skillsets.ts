#!/usr/bin/env node

/**
 * Nori Skillsets CLI - Registry Operations
 *
 * A CLI focused on registry operations and profile management.
 */

import { Command } from "commander";

import {
  registerNoriSkillsetsDownloadCommand,
  registerNoriSkillsetsDownloadSkillCommand,
  registerNoriSkillsetsExternalCommand,
  registerNoriSkillsetsInitCommand,
  registerNoriSkillsetsInstallCommand,
  registerNoriSkillsetsInstallLocationCommand,
  registerNoriSkillsetsListSkillsetsCommand,
  registerNoriSkillsetsLoginCommand,
  registerNoriSkillsetsLogoutCommand,
  registerNoriSkillsetsSearchCommand,
  registerNoriSkillsetsSwitchSkillsetCommand,
  registerNoriSkillsetsWatchCommand,
} from "@/cli/commands/noriSkillsetsCommands.js";
import {
  setTileworkSource,
  trackInstallLifecycle,
} from "@/cli/installTracking.js";
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
  $ nori-skillsets install my-skillset
  $ nori-skillsets install my-skillset --user
  $ nori-skillsets switch-skillset senior-swe
  $ nori-skillsets list-skillsets
  $ nori-skillsets download-skill my-skill
  $ nori-skillsets download-skill my-skill@1.0.0
  $ nori-skillsets download-skill my-skill --list-versions
  $ nori-skillsets external owner/repo
  $ nori-skillsets external https://github.com/owner/repo --skill my-skill
  $ nori-skillsets external owner/repo --all --ref main
  $ nori-skillsets watch              # start watching Claude Code sessions
  $ nori-skillsets watch stop         # stop the watch daemon
  $ nori-skillsets install-location   # show all installation directories
  $ nori-skillsets install-location --installation-source  # show only source dirs
  $ nori-skillsets install-location --installation-managed # show only managed dirs
  $ nori-skillsets install-location --non-interactive      # plain output for scripts
`,
  );

// Register simplified commands for nori-skillsets CLI
registerNoriSkillsetsLoginCommand({ program });
registerNoriSkillsetsLogoutCommand({ program });
registerNoriSkillsetsInitCommand({ program });
registerNoriSkillsetsSearchCommand({ program });
registerNoriSkillsetsDownloadCommand({ program });
registerNoriSkillsetsInstallCommand({ program });
registerNoriSkillsetsSwitchSkillsetCommand({ program });
registerNoriSkillsetsListSkillsetsCommand({ program });
registerNoriSkillsetsDownloadSkillCommand({ program });
registerNoriSkillsetsExternalCommand({ program });
registerNoriSkillsetsWatchCommand({ program });
registerNoriSkillsetsInstallLocationCommand({ program });

program.parse(process.argv);

// Show help if no command provided
if (process.argv.length < 3) {
  program.help();
}
