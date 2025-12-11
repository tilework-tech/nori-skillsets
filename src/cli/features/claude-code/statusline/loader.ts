/**
 * Statusline feature loader
 * Configures Claude Code status line to display git branch, cost, tokens, and Nori branding
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import {
  getClaudeHomeDir,
  getClaudeHomeSettingsFile,
} from "@/cli/features/claude-code/paths.js";
import { success, info, warn } from "@/cli/logger.js";

import type { Config } from "@/cli/config.js";
import type { Loader } from "@/cli/features/agentRegistry.js";

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Configure status line to display git branch, session cost, token usage, and Nori branding
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const configureStatusLine = async (args: { config: Config }): Promise<void> => {
  const { config: _config } = args;
  const claudeDir = getClaudeHomeDir();
  const claudeSettingsFile = getClaudeHomeSettingsFile();

  info({ message: "Configuring status line..." });

  // Source script path (in build output)
  const sourceScript = path.join(__dirname, "config", "nori-statusline.sh");

  // Destination script path (in .claude directory)
  const destScript = path.join(claudeDir, "nori-statusline.sh");

  // Verify source script exists
  try {
    await fs.access(sourceScript);
  } catch {
    warn({
      message: `Status line script not found at ${sourceScript}, skipping status line configuration`,
    });
    return;
  }

  // Create .claude directory if it doesn't exist
  await fs.mkdir(claudeDir, { recursive: true });

  // Copy script to .claude directory
  await fs.copyFile(sourceScript, destScript);

  // Make script executable
  await fs.chmod(destScript, 0o755);

  // Initialize settings file if it doesn't exist
  let settings: any = {};
  try {
    const content = await fs.readFile(claudeSettingsFile, "utf-8");
    settings = JSON.parse(content);
  } catch {
    settings = {
      $schema: "https://json.schemastore.org/claude-code-settings.json",
    };
  }

  // Add status line configuration pointing to copied script
  settings.statusLine = {
    type: "command",
    command: destScript,
    padding: 0,
  };

  await fs.writeFile(claudeSettingsFile, JSON.stringify(settings, null, 2));
  success({ message: `✓ Status line configured in ${claudeSettingsFile}` });
  info({
    message:
      "Status line will display: git branch, session cost, tokens, rotating tips, and Nori branding",
  });
};

/**
 * Remove status line from settings.json and delete copied script
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const removeStatusLine = async (args: { config: Config }): Promise<void> => {
  const { config: _config } = args;
  const claudeDir = getClaudeHomeDir();
  const claudeSettingsFile = getClaudeHomeSettingsFile();
  const destScript = path.join(claudeDir, "nori-statusline.sh");

  info({ message: "Removing status line from Claude Code settings..." });

  try {
    const content = await fs.readFile(claudeSettingsFile, "utf-8");
    const settings = JSON.parse(content);

    if (settings.statusLine) {
      delete settings.statusLine;
      await fs.writeFile(claudeSettingsFile, JSON.stringify(settings, null, 2));
      success({ message: "✓ Status line removed from settings.json" });
    } else {
      info({ message: "No status line found in settings.json" });
    }
  } catch (err) {
    warn({
      message: `Could not remove status line from settings.json: ${err}`,
    });
  }

  // Remove copied script from .claude directory
  try {
    await fs.rm(destScript, { force: true });
    success({ message: "✓ Status line script removed" });
  } catch (err) {
    warn({
      message: `Could not remove status line script: ${err}`,
    });
  }
};

/**
 * Statusline feature loader
 */
export const statuslineLoader: Loader = {
  name: "statusline",
  description: "Configure Claude Code status line with git, cost, and tokens",
  run: async (args: { config: Config }) => {
    await configureStatusLine(args);
  },
  uninstall: async (args: { config: Config }) => {
    await removeStatusLine(args);
  },
};
