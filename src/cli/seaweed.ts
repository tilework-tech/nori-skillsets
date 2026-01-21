#!/usr/bin/env node

/**
 * Seaweed CLI - Registry Operations
 *
 * A minimal CLI focused on registry operations only.
 * For full Nori Profiles functionality, use the nori-ai CLI.
 */

import { Command } from "commander";

import {
  registerSeaweedDownloadCommand,
  registerSeaweedDownloadSkillCommand,
  registerSeaweedInstallCommand,
  registerSeaweedSearchCommand,
  registerSeaweedSwitchSkillsetCommand,
  registerSeaweedUpdateCommand,
  registerSeaweedUploadCommand,
  registerSeaweedUploadSkillCommand,
} from "@/cli/commands/seaweedCommands.js";
import { getCurrentPackageVersion } from "@/cli/version.js";
import { normalizeInstallDir } from "@/utils/path.js";

const program = new Command();
const version = getCurrentPackageVersion() || "unknown";

program
  .name("seaweed")
  .version(version)
  .description(`Seaweed CLI - Registry Operations v${version}`)
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
  $ seaweed search typescript  # searches both profiles and skills
  $ seaweed download my-profile
  $ seaweed download my-profile@1.0.0
  $ seaweed download my-profile --list-versions
  $ seaweed install my-profile
  $ seaweed install my-profile --user
  $ seaweed update my-profile
  $ seaweed upload my-profile
  $ seaweed upload my-profile@1.0.0 --registry https://registry.example.com
  $ seaweed switch-skillset senior-swe
  $ seaweed download-skill my-skill
  $ seaweed download-skill my-skill@1.0.0
  $ seaweed download-skill my-skill --list-versions
  $ seaweed upload-skill my-skill
  $ seaweed upload-skill my-skill@1.0.0 --registry https://registry.example.com
`,
  );

// Register simplified commands for seaweed CLI
registerSeaweedSearchCommand({ program });
registerSeaweedDownloadCommand({ program });
registerSeaweedInstallCommand({ program });
registerSeaweedUpdateCommand({ program });
registerSeaweedUploadCommand({ program });
registerSeaweedSwitchSkillsetCommand({ program });
registerSeaweedDownloadSkillCommand({ program });
registerSeaweedUploadSkillCommand({ program });

program.parse(process.argv);

// Show help if no command provided
if (process.argv.length < 3) {
  program.help();
}
