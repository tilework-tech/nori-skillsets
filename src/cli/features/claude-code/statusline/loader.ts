/**
 * Statusline feature loader
 * Configures Claude Code status line to display git branch, cost, tokens, and Nori branding
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { log } from "@clack/prompts";

import {
  getClaudeHomeDir,
  getClaudeHomeSettingsFile,
} from "@/cli/features/claude-code/paths.js";
import { readJsonObjectFile, writeJsonFileAtomic } from "@/utils/jsonFile.js";

import type { Config } from "@/cli/config.js";
import type { AgentLoader } from "@/cli/features/agentRegistry.js";

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Configure status line to display git branch, session cost, token usage, and Nori branding
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 *
 * @returns Label for the settings note, or void on failure
 */
const configureStatusLine = async (args: {
  config: Config;
}): Promise<string | void> => {
  const { config } = args;
  if (config.claudeCodeStatusLine === "disabled") {
    return;
  }

  const claudeDir = getClaudeHomeDir();
  const claudeSettingsFile = getClaudeHomeSettingsFile();

  // Source script path (in build output)
  const sourceScript = path.join(__dirname, "config", "nori-statusline.sh");

  // Destination script path (in .claude directory)
  const destScript = path.join(claudeDir, "nori-statusline.sh");

  // Verify source script exists
  try {
    await fs.access(sourceScript);
  } catch {
    log.warn(
      `Status line script not found at ${sourceScript}, skipping status line configuration`,
    );
    return;
  }

  // Create .claude directory if it doesn't exist
  await fs.mkdir(claudeDir, { recursive: true });

  // Copy script to .claude directory
  await fs.copyFile(sourceScript, destScript);

  // Make script executable
  await fs.chmod(destScript, 0o755);

  // Read the user's settings, preserving them. A file that exists but does not
  // parse aborts loudly instead of being overwritten with a fresh object.
  const settings: any = await readJsonObjectFile({
    filePath: claudeSettingsFile,
    ifAbsent: {
      $schema: "https://json.schemastore.org/claude-code-settings.json",
    },
  });

  // Add status line configuration pointing to copied script
  settings.statusLine = {
    type: "command",
    command: destScript,
    padding: 0,
  };

  await writeJsonFileAtomic({ filePath: claudeSettingsFile, value: settings });
  return "Status line";
};

/**
 * Statusline feature loader
 */
export const statuslineLoader: AgentLoader = {
  name: "statusline",
  description: "Claude Code status line configuration",
  managedFiles: ["nori-statusline.sh", "settings.json"],
  run: async ({ config }) => {
    return configureStatusLine({ config });
  },
  uninstall: async () => {
    const statuslineScript = path.join(
      getClaudeHomeDir(),
      "nori-statusline.sh",
    );
    await fs.rm(statuslineScript, { force: true });
  },
};
