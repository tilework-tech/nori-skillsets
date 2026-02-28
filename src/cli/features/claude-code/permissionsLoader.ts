/**
 * Permissions loader for Claude Code
 * Configures Claude Code permissions to allow access to profiles and skills directories.
 * Combines the permissions logic previously split across skillsets/loader.ts and skills/loader.ts.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { getClaudeSettingsFile } from "@/cli/features/claude-code/paths.js";
import { getNoriSkillsetsDir } from "@/cli/features/paths.js";

import type { AgentLoader } from "@/cli/features/agentRegistry.js";

export const permissionsLoader: AgentLoader = {
  name: "permissions",
  description: "Configure permissions for profiles and skills directories",
  managedFiles: ["settings.json"],
  run: async ({ agent, config }) => {
    const claudeSettingsFile = getClaudeSettingsFile({
      installDir: config.installDir,
    });
    const noriProfilesDir = getNoriSkillsetsDir();
    const skillsDir = agent.getSkillsDir({ installDir: config.installDir });

    // Create .claude directory if it doesn't exist
    await fs.mkdir(path.dirname(claudeSettingsFile), { recursive: true });

    // Read or initialize settings
    let settings: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(claudeSettingsFile, "utf-8");
      settings = JSON.parse(content);
    } catch {
      settings = {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
      };
    }

    // Initialize permissions
    const permissions = (settings.permissions ?? {}) as Record<string, unknown>;
    const additionalDirectories = (
      Array.isArray(permissions.additionalDirectories)
        ? permissions.additionalDirectories
        : []
    ) as Array<string>;

    // Add profiles directory if not already present
    if (!additionalDirectories.includes(noriProfilesDir)) {
      additionalDirectories.push(noriProfilesDir);
    }

    // Add skills directory if not already present
    if (!additionalDirectories.includes(skillsDir)) {
      additionalDirectories.push(skillsDir);
    }

    permissions.additionalDirectories = additionalDirectories;
    settings.permissions = permissions;

    // Write back
    await fs.writeFile(claudeSettingsFile, JSON.stringify(settings, null, 2));
  },
};
