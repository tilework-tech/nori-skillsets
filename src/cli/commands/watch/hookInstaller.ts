/**
 * Transcript hook installer
 *
 * Manages installation and removal of the transcript-done-marker hook
 * in Claude Code's settings.json.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import {
  getClaudeHomeDir,
  getClaudeHomeSettingsFile,
} from "@/cli/features/claude-code/paths.js";

// Get directory of this file to resolve hook script path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Hook script path (relative to compiled output)
const HOOK_SCRIPT_NAME = "transcript-done-marker.js";

/**
 * Get the absolute path to the transcript-done-marker hook script
 *
 * @returns Absolute path to the hook script
 */
const getHookScriptPath = (): string => {
  // The hook script is in src/cli/features/claude-code/hooks/config/
  // This file is in src/cli/commands/watch/
  // So we need to go up and over to the hooks config directory
  return path.join(
    __dirname,
    "..",
    "..",
    "features",
    "claude-code",
    "hooks",
    "config",
    HOOK_SCRIPT_NAME,
  );
};

/**
 * Check if our hook is already installed
 *
 * @param sessionEndHooks - Array of SessionEnd hook configurations
 *
 * @returns True if our hook is found
 */
const hasOurHook = (
  sessionEndHooks: Array<{ hooks: Array<{ command: string }> }>,
): boolean => {
  return sessionEndHooks.some((h) =>
    h.hooks.some((hook) => hook.command.includes("transcript-done-marker")),
  );
};

/**
 * Install the transcript-done-marker hook into Claude Code settings
 *
 * This is idempotent - calling multiple times won't duplicate the hook.
 */
export const installTranscriptHook = async (): Promise<void> => {
  const claudeDir = getClaudeHomeDir();
  const settingsFile = getClaudeHomeSettingsFile();
  const hookScriptPath = getHookScriptPath();

  // Ensure .claude directory exists
  await fs.mkdir(claudeDir, { recursive: true });

  // Read existing settings or create new
  let settings: Record<string, unknown> = {};
  try {
    const content = await fs.readFile(settingsFile, "utf-8");
    settings = JSON.parse(content);
  } catch {
    // File doesn't exist or is invalid - start fresh
    settings = {
      $schema: "https://json-schema.org/claude-code-settings.json",
    };
  }

  // Initialize hooks structure if needed
  if (!settings.hooks || typeof settings.hooks !== "object") {
    settings.hooks = {};
  }

  const hooks = settings.hooks as Record<string, unknown>;

  // Initialize SessionEnd array if needed
  if (!Array.isArray(hooks.SessionEnd)) {
    hooks.SessionEnd = [];
  }

  const sessionEndHooks = hooks.SessionEnd as Array<{
    matcher: string;
    hooks: Array<{ type: string; command: string; description: string }>;
  }>;

  // Check if our hook is already installed (idempotent)
  if (hasOurHook(sessionEndHooks)) {
    return;
  }

  // Add our hook
  sessionEndHooks.push({
    matcher: "*",
    hooks: [
      {
        type: "command",
        command: `node ${hookScriptPath}`,
        description: "Write transcript done marker for upload",
      },
    ],
  });

  // Write updated settings
  await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2));
};

/**
 * Remove the transcript-done-marker hook from Claude Code settings
 *
 * Leaves other hooks intact.
 */
export const removeTranscriptHook = async (): Promise<void> => {
  const settingsFile = getClaudeHomeSettingsFile();

  // Read existing settings
  let settings: Record<string, unknown>;
  try {
    const content = await fs.readFile(settingsFile, "utf-8");
    settings = JSON.parse(content);
  } catch {
    // File doesn't exist or is invalid - nothing to remove
    return;
  }

  // Check if hooks exist
  if (!settings.hooks || typeof settings.hooks !== "object") {
    return;
  }

  const hooks = settings.hooks as Record<string, unknown>;

  // Check if SessionEnd exists
  if (!Array.isArray(hooks.SessionEnd)) {
    return;
  }

  const sessionEndHooks = hooks.SessionEnd as Array<{
    matcher: string;
    hooks: Array<{ type: string; command: string; description: string }>;
  }>;

  // Filter out our hook
  hooks.SessionEnd = sessionEndHooks.filter(
    (h) =>
      !h.hooks.some((hook) => hook.command.includes("transcript-done-marker")),
  );

  // Write updated settings
  await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2));
};

/**
 * Check if the transcript-done-marker hook is installed
 *
 * @returns True if hook is installed
 */
export const isTranscriptHookInstalled = async (): Promise<boolean> => {
  const settingsFile = getClaudeHomeSettingsFile();

  try {
    const content = await fs.readFile(settingsFile, "utf-8");
    const settings = JSON.parse(content);

    if (!settings.hooks || !Array.isArray(settings.hooks.SessionEnd)) {
      return false;
    }

    return hasOurHook(settings.hooks.SessionEnd);
  } catch {
    return false;
  }
};
