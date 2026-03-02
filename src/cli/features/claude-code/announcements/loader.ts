/**
 * Announcements feature loader
 * Configures Claude Code companyAnnouncements to display Nori branding at startup
 */

import * as fs from "fs/promises";

import {
  getClaudeHomeDir,
  getClaudeHomeSettingsFile,
} from "@/cli/features/claude-code/paths.js";

import type { Config } from "@/cli/config.js";
import type { AgentLoader } from "@/cli/features/agentRegistry.js";

const NORI_ANNOUNCEMENT = "🍙🍙🍙 Powered by Nori AI 🍙🍙🍙";

/**
 * Configure companyAnnouncements to display Nori branding at startup
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 *
 * @returns Label for the settings note, or void on failure
 */
const configureAnnouncements = async (args: {
  config: Config;
}): Promise<string | void> => {
  const { config: _config } = args;
  const claudeDir = getClaudeHomeDir();
  const claudeSettingsFile = getClaudeHomeSettingsFile();

  // Create .claude directory if it doesn't exist
  await fs.mkdir(claudeDir, { recursive: true });

  // Initialize settings file if it doesn't exist
  let settings: Record<string, unknown> = {};
  try {
    const content = await fs.readFile(claudeSettingsFile, "utf-8");
    settings = JSON.parse(content);
  } catch {
    settings = {
      $schema: "https://json.schemastore.org/claude-code-settings.json",
    };
  }

  // Add companyAnnouncements configuration
  settings.companyAnnouncements = [NORI_ANNOUNCEMENT];

  await fs.writeFile(claudeSettingsFile, JSON.stringify(settings, null, 2));
  return "Announcements";
};

/**
 * Announcements feature loader
 */
export const announcementsLoader: AgentLoader = {
  name: "announcements",
  description: "Claude Code announcements configuration",
  managedFiles: ["settings.json"],
  run: async ({ config }) => {
    return configureAnnouncements({ config });
  },
};
