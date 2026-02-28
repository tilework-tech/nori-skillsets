/**
 * Permissions loader for Claude Code
 * Configures Claude Code permissions to allow access to profiles and skills directories.
 * Combines the permissions logic previously split across skillsets/loader.ts and skills/loader.ts.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { getNoriSkillsetsDir } from "@/cli/features/paths.js";

import type { AgentLoader } from "@/cli/features/agentRegistry.js";

export const permissionsLoader: AgentLoader = {
  name: "permissions",
  description: "Configure permissions for profiles and skills directories",
  managedFiles: ["settings.json"],
  run: async ({ agent, config }) => {
    const agentDir = agent.getAgentDir({ installDir: config.installDir });
    const settingsFile = path.join(agentDir, "settings.json");
    const noriProfilesDir = getNoriSkillsetsDir();
    const skillsDir = agent.getSkillsDir({ installDir: config.installDir });

    // Create agent directory if it doesn't exist
    await fs.mkdir(agentDir, { recursive: true });

    // Read or initialize settings
    let settings: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(settingsFile, "utf-8");
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
    await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2));
  },
};
