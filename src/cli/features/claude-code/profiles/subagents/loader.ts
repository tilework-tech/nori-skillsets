/**
 * Subagents feature loader
 * Registers all Nori subagents with Claude Code
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { getAgentProfile, type Config } from "@/cli/config.js";
import {
  getClaudeDir,
  getClaudeAgentsDir,
} from "@/cli/features/claude-code/paths.js";
import { substituteTemplatePaths } from "@/cli/features/claude-code/template.js";
import { success, info, warn } from "@/cli/logger.js";

import type { ValidationResult } from "@/cli/features/agentRegistry.js";
import type { ProfileLoader } from "@/cli/features/claude-code/profiles/profileLoaderRegistry.js";

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get config directory for subagents based on selected profile
 *
 * @param args - Configuration arguments
 * @param args.profileName - Name of the profile to load subagents from
 * @param args.installDir - Installation directory
 *
 * @returns Path to the subagents config directory for the profile
 */
const getConfigDir = (args: {
  profileName: string;
  installDir: string;
}): string => {
  const { profileName, installDir } = args;
  const claudeDir = getClaudeDir({ installDir });
  return path.join(claudeDir, "profiles", profileName, "subagents");
};

/**
 * Register all subagents
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const registerSubagents = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  info({ message: "Registering Nori subagents..." });

  // Get profile name from config - error if not configured
  const profileName = getAgentProfile({
    config,
    agentName: "claude-code",
  })?.baseProfile;
  if (profileName == null) {
    throw new Error(
      "No profile configured for claude-code. Run 'nori-ai install' to configure a profile.",
    );
  }
  const configDir = getConfigDir({
    profileName,
    installDir: config.installDir,
  });
  const claudeAgentsDir = getClaudeAgentsDir({ installDir: config.installDir });

  // Create agents directory if it doesn't exist
  await fs.mkdir(claudeAgentsDir, { recursive: true });

  let registeredCount = 0;
  let skippedCount = 0;

  // Read all .md files from the profile's subagents directory
  const files = await fs.readdir(configDir);
  const mdFiles = files.filter(
    (file) => file.endsWith(".md") && file !== "docs.md",
  );

  for (const file of mdFiles) {
    const subagentSrc = path.join(configDir, file);
    const subagentDest = path.join(claudeAgentsDir, file);

    try {
      await fs.access(subagentSrc);
      // Read, apply template substitution, then write
      const content = await fs.readFile(subagentSrc, "utf-8");
      const claudeDir = getClaudeDir({ installDir: config.installDir });
      const substituted = substituteTemplatePaths({
        content,
        installDir: claudeDir,
      });
      await fs.writeFile(subagentDest, substituted);
      const subagentName = file.replace(/\.md$/, "");
      success({ message: `✓ ${subagentName} subagent registered` });
      registeredCount++;
    } catch {
      warn({
        message: `Subagent definition not found at ${subagentSrc}, skipping`,
      });
      skippedCount++;
    }
  }

  if (registeredCount > 0) {
    success({
      message: `Successfully registered ${registeredCount} subagent${
        registeredCount === 1 ? "" : "s"
      }`,
    });
  }
  if (skippedCount > 0) {
    warn({
      message: `Skipped ${skippedCount} subagent${
        skippedCount === 1 ? "" : "s"
      } (not found)`,
    });
  }
};

/**
 * Unregister all subagents
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const unregisterSubagents = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  info({ message: "Removing Nori subagents..." });

  let removedCount = 0;

  // Get profile name from config - skip gracefully if not configured
  // (uninstall should be permissive and clean up whatever is possible)
  const profileName = getAgentProfile({
    config,
    agentName: "claude-code",
  })?.baseProfile;
  if (profileName == null) {
    info({
      message:
        "No profile configured for claude-code, skipping subagents cleanup",
    });
    return;
  }
  const configDir = getConfigDir({
    profileName,
    installDir: config.installDir,
  });
  const claudeAgentsDir = getClaudeAgentsDir({ installDir: config.installDir });

  // Read all .md files from the profile's subagents directory
  try {
    const files = await fs.readdir(configDir);
    const mdFiles = files.filter(
      (file) => file.endsWith(".md") && file !== "docs.md",
    );

    for (const file of mdFiles) {
      const subagentPath = path.join(claudeAgentsDir, file);

      try {
        await fs.access(subagentPath);
        await fs.unlink(subagentPath);
        const subagentName = file.replace(/\.md$/, "");
        success({ message: `✓ ${subagentName} subagent removed` });
        removedCount++;
      } catch {
        const subagentName = file.replace(/\.md$/, "");
        info({
          message: `${subagentName} subagent not found (may not be installed)`,
        });
      }
    }
  } catch {
    info({ message: "Profile subagents directory not found" });
  }

  if (removedCount > 0) {
    success({
      message: `Successfully removed ${removedCount} subagent${
        removedCount === 1 ? "" : "s"
      }`,
    });
  }

  // Remove parent directory if empty
  try {
    const files = await fs.readdir(claudeAgentsDir);
    if (files.length === 0) {
      await fs.rmdir(claudeAgentsDir);
      success({ message: `✓ Removed empty directory: ${claudeAgentsDir}` });
    }
  } catch {
    // Directory doesn't exist or couldn't be removed, which is fine
  }
};

/**
 * Validate subagents installation
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

  const claudeAgentsDir = getClaudeAgentsDir({ installDir: config.installDir });

  // Check if agents directory exists
  try {
    await fs.access(claudeAgentsDir);
  } catch {
    errors.push(`Agents directory not found at ${claudeAgentsDir}`);
    errors.push('Run "nori-ai install" to create the agents directory');
    return {
      valid: false,
      message: "Agents directory not found",
      errors,
    };
  }

  // Get profile name from config - error if not configured
  const profileName = getAgentProfile({
    config,
    agentName: "claude-code",
  })?.baseProfile;
  if (profileName == null) {
    errors.push("No profile configured for claude-code");
    errors.push("Run 'nori-ai install' to configure a profile");
    return {
      valid: false,
      message: "No profile configured",
      errors,
    };
  }
  const configDir = getConfigDir({
    profileName,
    installDir: config.installDir,
  });

  // Check if all expected subagents are present
  const missingSubagents: Array<string> = [];
  let expectedCount = 0;

  try {
    const files = await fs.readdir(configDir);
    const mdFiles = files.filter(
      (file) => file.endsWith(".md") && file !== "docs.md",
    );
    expectedCount = mdFiles.length;

    for (const file of mdFiles) {
      const subagentPath = path.join(claudeAgentsDir, file);
      try {
        await fs.access(subagentPath);
      } catch {
        missingSubagents.push(file.replace(/\.md$/, ""));
      }
    }
  } catch {
    errors.push(`Profile subagents directory not found at ${configDir}`);
    return {
      valid: false,
      message: "Profile subagents directory not found",
      errors,
    };
  }

  if (missingSubagents.length > 0) {
    errors.push(
      `Missing ${missingSubagents.length} subagent(s): ${missingSubagents.join(
        ", ",
      )}`,
    );
    errors.push('Run "nori-ai install" to register missing subagents');
    return {
      valid: false,
      message: "Some subagents are not installed",
      errors,
    };
  }

  return {
    valid: true,
    message: `All ${expectedCount} subagents are properly installed`,
    errors: null,
  };
};

/**
 * Subagents feature loader
 */
export const subagentsLoader: ProfileLoader = {
  name: "subagents",
  description: "Register all Nori subagents with Claude Code",
  install: async (args: { config: Config }) => {
    const { config } = args;
    await registerSubagents({ config });
  },
  uninstall: async (args: { config: Config }) => {
    const { config } = args;
    await unregisterSubagents({ config });
  },
  validate,
};
