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
  removeSettingsKeys,
} from "@/cli/features/claude-code/paths.js";
import { confirmAction } from "@/cli/prompts/confirm.js";

import type { Config } from "@/cli/config.js";
import type { AgentLoader } from "@/cli/features/agentRegistry.js";

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Configure status line to display git branch, session cost, token usage, and Nori branding
 * @param _args - Configuration arguments
 * @param _args.config - Runtime configuration
 *
 * @returns Label for the settings note, or void on failure
 */
const configureStatusLine = async (_args: {
  config: Config;
}): Promise<string | void> => {
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

  // Read existing settings before making any filesystem changes
  let settings: any = {};
  try {
    const content = await fs.readFile(claudeSettingsFile, "utf-8");
    settings = JSON.parse(content);
  } catch {
    settings = {
      $schema: "https://json.schemastore.org/claude-code-settings.json",
    };
  }

  // Check for existing statusLine configuration
  const existing = settings.statusLine;
  if (existing && existing.command !== destScript) {
    const backupPath = path.join(claudeDir, ".nori-statusline-backup.json");

    if (process.stdin.isTTY) {
      const displayCmd = existing.command ?? JSON.stringify(existing);
      const shouldReplace = await confirmAction({
        message: `Your Claude Code status line is currently set to: ${displayCmd}\nReplace with Nori status line? (original will be backed up to ${backupPath})`,
      });
      if (!shouldReplace) {
        log.info(`Keeping existing status line configuration`);
        return;
      }
    }

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(
      backupPath,
      JSON.stringify(settings.statusLine, null, 2),
    );

    if (!process.stdin.isTTY) {
      log.info(`Backed up existing status line to ${backupPath}`);
    }
  }

  // Create .claude directory if it doesn't exist
  await fs.mkdir(claudeDir, { recursive: true });

  // Copy script to .claude directory
  await fs.copyFile(sourceScript, destScript);

  // Make script executable
  await fs.chmod(destScript, 0o755);

  // Add status line configuration pointing to copied script
  settings.statusLine = {
    type: "command",
    command: destScript,
    padding: 0,
  };

  await fs.writeFile(claudeSettingsFile, JSON.stringify(settings, null, 2));
  return "Status line";
};

const restoreStatusLine = async (args: {
  settingsFile: string;
  backupPath: string;
}): Promise<boolean> => {
  const { settingsFile, backupPath } = args;

  let backup: unknown;
  try {
    const content = await fs.readFile(backupPath, "utf-8");
    backup = JSON.parse(content);
  } catch (err) {
    const isNotFound =
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT";
    if (!isNotFound) {
      log.warn(
        `Failed to read status line backup at ${backupPath}, removing status line instead`,
      );
    }
    return false;
  }

  let settings: Record<string, unknown>;
  try {
    const content = await fs.readFile(settingsFile, "utf-8");
    settings = JSON.parse(content) as Record<string, unknown>;
  } catch {
    settings = {
      $schema: "https://json.schemastore.org/claude-code-settings.json",
    };
  }

  settings.statusLine = backup;
  await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2));
  await fs.rm(backupPath, { force: true });

  log.info("Restored previous status line configuration from backup");
  return true;
};

/**
 * Statusline feature loader
 */
export const statuslineLoader: AgentLoader = {
  name: "statusline",
  description: "Claude Code status line configuration",
  managedFiles: [
    "nori-statusline.sh",
    "settings.json",
    ".nori-statusline-backup.json",
  ],
  run: async ({ config }) => {
    return configureStatusLine({ config });
  },
  uninstall: async () => {
    const claudeDir = getClaudeHomeDir();
    const claudeSettingsFile = getClaudeHomeSettingsFile();
    const backupPath = path.join(claudeDir, ".nori-statusline-backup.json");

    const restored = await restoreStatusLine({
      settingsFile: claudeSettingsFile,
      backupPath,
    });

    if (!restored) {
      await removeSettingsKeys({
        settingsFile: claudeSettingsFile,
        keys: ["statusLine"],
      });
      await fs.rm(backupPath, { force: true });
    }

    const statuslineScript = path.join(claudeDir, "nori-statusline.sh");
    await fs.rm(statuslineScript, { force: true });
  },
};
