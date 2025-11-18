/**
 * Statusline feature loader
 * Configures Claude Code status line to display git branch, cost, tokens, and Nori branding
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { getClaudeDir, getClaudeSettingsFile } from "@/installer/env.js";
import { success, info, warn } from "@/installer/logger.js";

import type { Config } from "@/installer/config.js";
import type { Loader } from "@/installer/features/loaderRegistry.js";

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Configure status line to display git branch, session cost, token usage, and Nori branding
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const configureStatusLine = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  const claudeDir = getClaudeDir({ installDir: config.installDir });
  const claudeSettingsFile = getClaudeSettingsFile({
    installDir: config.installDir,
  });

  info({ message: "Configuring status line..." });

  // Script path (absolute path in build output)
  const statuslineScript = path.join(__dirname, "config", "nori-statusline.sh");

  // Verify statusline script exists
  try {
    await fs.access(statuslineScript);
  } catch {
    warn({
      message: `Status line script not found at ${statuslineScript}, skipping status line configuration`,
    });
    return;
  }

  // Create .claude directory if it doesn't exist
  await fs.mkdir(claudeDir, { recursive: true });

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

  // Add status line configuration with absolute path
  settings.statusLine = {
    type: "command",
    command: statuslineScript,
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
 * Remove status line from settings.json
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const removeStatusLine = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  const claudeSettingsFile = getClaudeSettingsFile({
    installDir: config.installDir,
  });

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
