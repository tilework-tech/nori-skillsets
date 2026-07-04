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

const ANNOUNCEMENTS_ENV = "NORI_SKILLSETS_ANNOUNCEMENTS";

const announcementsDisabled = (): boolean => {
  const value = process.env[ANNOUNCEMENTS_ENV];
  return value === "none" || value === "off" || value === "false";
};

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

  // Merge the Nori announcement with the user's own announcements: user
  // entries always survive, and the Nori entry appears exactly once (or not
  // at all when disabled via env).
  const existing = Array.isArray(settings.companyAnnouncements)
    ? (settings.companyAnnouncements as Array<unknown>)
    : [];
  const userAnnouncements = existing.filter(
    (entry) => entry !== NORI_ANNOUNCEMENT,
  );
  const announcements = announcementsDisabled()
    ? userAnnouncements
    : [...userAnnouncements, NORI_ANNOUNCEMENT];

  if (announcements.length > 0) {
    settings.companyAnnouncements = announcements;
  } else {
    delete settings.companyAnnouncements;
  }

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
