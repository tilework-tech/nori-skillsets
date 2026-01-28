#!/usr/bin/env node

/**
 * Nori Skillsets CLI - Registry Operations
 *
 * A minimal CLI focused on registry operations only.
 * For full Nori Profiles functionality, use the nori-ai CLI.
 */

import { Command } from "commander";

import {
  registerNoriSkillsetsDownloadCommand,
  registerNoriSkillsetsDownloadSkillCommand,
  registerNoriSkillsetsInitCommand,
  registerNoriSkillsetsInstallCommand,
  registerNoriSkillsetsListSkillsetsCommand,
  registerNoriSkillsetsSearchCommand,
  registerNoriSkillsetsSwitchSkillsetCommand,
} from "@/cli/commands/noriSkillsetsCommands.js";
import {
  setTileworkSource,
  trackInstallLifecycle,
} from "@/cli/installTracking.js";
import { getCurrentPackageVersion } from "@/cli/version.js";
import { normalizeInstallDir } from "@/utils/path.js";

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
  $ nori-skillsets init
  $ nori-skillsets search typescript  # searches both profiles and skills
  $ nori-skillsets download my-profile
  $ nori-skillsets download my-profile@1.0.0
  $ nori-skillsets download my-profile --list-versions
  $ nori-skillsets install my-profile
  $ nori-skillsets install my-profile --user
  $ nori-skillsets switch-skillset senior-swe
  $ nori-skillsets list-skillsets
  $ nori-skillsets download-skill my-skill
  $ nori-skillsets download-skill my-skill@1.0.0
  $ nori-skillsets download-skill my-skill --list-versions
`,
  );

// Register simplified commands for nori-skillsets CLI
registerNoriSkillsetsInitCommand({ program });
registerNoriSkillsetsSearchCommand({ program });
registerNoriSkillsetsDownloadCommand({ program });
registerNoriSkillsetsInstallCommand({ program });
registerNoriSkillsetsSwitchSkillsetCommand({ program });
registerNoriSkillsetsListSkillsetsCommand({ program });
registerNoriSkillsetsDownloadSkillCommand({ program });

program.parse(process.argv);

// Show help if no command provided
if (process.argv.length < 3) {
  program.help();
}
