/**
 * AGENTS.md feature loader for cursor-agent
 * Configures AGENTS.md with Nori instructions
 */

import * as fs from "fs/promises";
import * as path from "path";

import { getAgentProfile } from "@/cli/config.js";
import {
  getCursorDir,
  getCursorAgentsMdFile,
} from "@/cli/features/cursor-agent/paths.js";
import { success, info } from "@/cli/logger.js";

import type { Config } from "@/cli/config.js";
import type { ValidationResult } from "@/cli/features/agentRegistry.js";
import type { CursorProfileLoader } from "@/cli/features/cursor-agent/profiles/profileLoaderRegistry.js";

/**
 * Get path to AGENTS.md for a profile
 *
 * @param args - Function arguments
 * @param args.profileName - Name of the profile to load AGENTS.md from
 * @param args.installDir - Installation directory
 *
 * @returns Path to the AGENTS.md file for the profile
 */
const getProfileAgentsMd = (args: {
  profileName: string;
  installDir: string;
}): string => {
  const { profileName, installDir } = args;
  const cursorDir = getCursorDir({ installDir });
  return path.join(cursorDir, "profiles", profileName, "AGENTS.md");
};

// Markers for managed block
const BEGIN_MARKER = "# BEGIN NORI-AI MANAGED BLOCK";
const END_MARKER = "# END NORI-AI MANAGED BLOCK";

/**
 * Insert or update AGENTS.md with nori instructions in a managed block
 * @param args - Configuration arguments
 * @param args.config - Full configuration including profile
 */
const insertAgentsMd = async (args: { config: Config }): Promise<void> => {
  const { config } = args;

  info({ message: "Configuring AGENTS.md with Nori instructions..." });

  // Get profile name from config (default to amol for cursor-agent)
  const agentProfile = getAgentProfile({ config, agentName: "cursor-agent" });
  const profileName = agentProfile?.baseProfile || "amol";

  // Get paths using installDir
  const cursorDir = getCursorDir({ installDir: config.installDir });
  const agentsMdFile = getCursorAgentsMdFile({ installDir: config.installDir });

  // Read AGENTS.md from the selected profile
  const profileAgentsMdPath = getProfileAgentsMd({
    profileName,
    installDir: config.installDir,
  });
  const instructions = await fs.readFile(profileAgentsMdPath, "utf-8");

  // Create .cursor directory if it doesn't exist
  await fs.mkdir(cursorDir, { recursive: true });

  // Read existing content or start with empty string
  let content = "";
  try {
    content = await fs.readFile(agentsMdFile, "utf-8");
  } catch {
    // File doesn't exist, will create it
  }

  // Check if managed block already exists
  if (content.includes(BEGIN_MARKER)) {
    // Replace existing managed block
    const regex = new RegExp(
      `${BEGIN_MARKER}\n[\\s\\S]*?\n${END_MARKER}\n?`,
      "g",
    );
    content = content.replace(
      regex,
      `${BEGIN_MARKER}\n${instructions}\n${END_MARKER}\n`,
    );
    info({ message: "Updating existing nori instructions in AGENTS.md..." });
  } else {
    // Append new managed block
    const section = `\n${BEGIN_MARKER}\n${instructions}\n${END_MARKER}\n`;
    content = content + section;
    info({ message: "Adding nori instructions to AGENTS.md..." });
  }

  await fs.writeFile(agentsMdFile, content);
  success({ message: `✓ AGENTS.md configured at ${agentsMdFile}` });
};

/**
 * Remove nori-managed block from AGENTS.md
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const removeAgentsMd = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  info({ message: "Removing nori instructions from AGENTS.md..." });

  const agentsMdFile = getCursorAgentsMdFile({ installDir: config.installDir });

  try {
    const content = await fs.readFile(agentsMdFile, "utf-8");

    // Check if managed block exists
    if (!content.includes(BEGIN_MARKER)) {
      info({ message: "No nori instructions found in AGENTS.md" });
      return;
    }

    // Remove managed block
    const regex = new RegExp(
      `\n?${BEGIN_MARKER}\n[\\s\\S]*?\n${END_MARKER}\n?`,
      "g",
    );
    const updated = content.replace(regex, "");

    // If file is empty after removal, delete it
    if (updated.trim() === "") {
      await fs.unlink(agentsMdFile);
      success({ message: "✓ AGENTS.md removed (was empty after cleanup)" });
    } else {
      await fs.writeFile(agentsMdFile, updated);
      success({
        message: "✓ Nori instructions removed from AGENTS.md (file preserved)",
      });
    }
  } catch {
    info({ message: "AGENTS.md not found (may not have been installed)" });
  }
};

/**
 * Validate AGENTS.md configuration
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 *
 * @returns Validation result
 */
const validate = async (args: {
  config: Config;
}): Promise<ValidationResult> => {
  const { config } = args;
  const errors: Array<string> = [];

  const agentsMdFile = getCursorAgentsMdFile({ installDir: config.installDir });

  // Check if AGENTS.md exists
  try {
    await fs.access(agentsMdFile);
  } catch {
    errors.push(`AGENTS.md not found at ${agentsMdFile}`);
    errors.push(
      'Run "nori-ai install --agent cursor-agent" to create AGENTS.md',
    );
    return {
      valid: false,
      message: "AGENTS.md not found",
      errors,
    };
  }

  // Read and check for managed block
  let content: string;
  try {
    content = await fs.readFile(agentsMdFile, "utf-8");
  } catch (err) {
    errors.push("Failed to read AGENTS.md");
    errors.push(`Error: ${err}`);
    return {
      valid: false,
      message: "Unable to read AGENTS.md",
      errors,
    };
  }

  // Check if managed block exists
  if (!content.includes(BEGIN_MARKER) || !content.includes(END_MARKER)) {
    errors.push("Nori managed block not found in AGENTS.md");
    errors.push(
      'Run "nori-ai install --agent cursor-agent" to add managed block',
    );
    return {
      valid: false,
      message: "Nori managed block missing",
      errors,
    };
  }

  return {
    valid: true,
    message: "AGENTS.md is properly configured",
    errors: null,
  };
};

/**
 * AGENTS.md feature loader
 */
export const agentsMdLoader: CursorProfileLoader = {
  name: "agentsmd",
  description: "Configure AGENTS.md with Nori instructions",
  install: async (args: { config: Config }) => {
    const { config } = args;
    await insertAgentsMd({ config });
  },
  uninstall: async (args: { config: Config }) => {
    const { config } = args;
    await removeAgentsMd({ config });
  },
  validate,
};
