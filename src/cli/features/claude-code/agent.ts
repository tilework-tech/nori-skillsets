/**
 * Claude Code agent implementation
 * Implements the Agent interface for Claude Code
 */

import * as fs from "fs/promises";
import * as path from "path";

import { loadConfig, saveConfig } from "@/cli/config.js";
import { factoryResetClaudeCode } from "@/cli/features/claude-code/factoryReset.js";
import { LoaderRegistry } from "@/cli/features/claude-code/loaderRegistry.js";
import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";
import { ensureNoriJson } from "@/cli/features/claude-code/profiles/metadata.js";
import { MANIFEST_FILE } from "@/cli/features/managedFolder.js";
import { success, info } from "@/cli/logger.js";

import type { Agent } from "@/cli/features/agentRegistry.js";

/**
 * Claude Code agent implementation
 */
export const claudeCodeAgent: Agent = {
  name: "claude-code",
  displayName: "Claude Code",

  getLoaderRegistry: () => {
    return LoaderRegistry.getInstance();
  },

  factoryReset: factoryResetClaudeCode,

  switchProfile: async (args: {
    installDir: string;
    profileName: string;
  }): Promise<void> => {
    const { installDir, profileName } = args;
    const profilesDir = getNoriProfilesDir();

    // Verify profile exists
    // profileName can be flat (e.g., "senior-swe") or namespaced (e.g., "myorg/my-profile")
    // path.join handles both cases correctly since it just joins the path components
    const profileDir = path.join(profilesDir, profileName);
    await ensureNoriJson({ profileDir });
    const instructionsPath = path.join(profileDir, MANIFEST_FILE);

    try {
      await fs.access(instructionsPath);
    } catch {
      throw new Error(`Profile "${profileName}" not found in ${profilesDir}`);
    }

    // Load current config
    const currentConfig = await loadConfig();

    // Get existing agents config (agents keys are the source of truth for installed agents)
    const existingAgents = currentConfig?.agents ?? {};

    // Update profile for this agent
    const updatedAgents = {
      ...existingAgents,
      ["claude-code"]: {
        ...existingAgents["claude-code"],
        profile: { baseProfile: profileName },
      },
    };

    await saveConfig({
      username: currentConfig?.auth?.username ?? null,
      password: currentConfig?.auth?.password ?? null,
      refreshToken: currentConfig?.auth?.refreshToken ?? null,
      organizationUrl: currentConfig?.auth?.organizationUrl ?? null,
      organizations: currentConfig?.auth?.organizations ?? null,
      isAdmin: currentConfig?.auth?.isAdmin ?? null,
      agents: updatedAgents,
      sendSessionTranscript: currentConfig?.sendSessionTranscript ?? null,
      autoupdate: currentConfig?.autoupdate,
      version: currentConfig?.version ?? null,
      transcriptDestination: currentConfig?.transcriptDestination ?? null,
      installDir,
    });

    success({
      message: `Switched to "${profileName}" profile for Claude Code`,
    });
    info({
      message: `Restart Claude Code to load the new profile configuration`,
    });
  },
};
