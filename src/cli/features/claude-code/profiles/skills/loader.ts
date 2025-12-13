/**
 * Skills feature loader
 * Installs skill configuration files to ~/.claude/nori/skills/
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { isPaidInstall, getAgentProfile, type Config } from "@/cli/config.js";
import {
  getClaudeDir,
  getClaudeSkillsDir,
  getClaudeSettingsFile,
} from "@/cli/features/claude-code/paths.js";
import { substituteTemplatePaths } from "@/cli/features/claude-code/template.js";
import { success, info, warn } from "@/cli/logger.js";

import type { ValidationResult } from "@/cli/features/agentRegistry.js";
import type { ProfileLoader } from "@/cli/features/claude-code/profiles/profileLoaderRegistry.js";

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Copy a directory recursively, applying template substitution to markdown files
 *
 * @param args - Copy arguments
 * @param args.src - Source directory path
 * @param args.dest - Destination directory path
 * @param args.installDir - Installation directory for template substitution
 */
const copyDirWithTemplateSubstitution = async (args: {
  src: string;
  dest: string;
  installDir: string;
}): Promise<void> => {
  const { src, dest, installDir } = args;

  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirWithTemplateSubstitution({
        src: srcPath,
        dest: destPath,
        installDir,
      });
    } else if (entry.name.endsWith(".md")) {
      // Apply template substitution to markdown files
      const content = await fs.readFile(srcPath, "utf-8");
      const substituted = substituteTemplatePaths({ content, installDir });
      await fs.writeFile(destPath, substituted);
    } else {
      // Copy other files directly
      await fs.copyFile(srcPath, destPath);
    }
  }
};

/**
 * Get config directory for skills based on selected profile
 *
 * @param args - Configuration arguments
 * @param args.profileName - Name of the profile to load skills from
 * @param args.installDir - Installation directory
 *
 * @returns Path to the skills config directory for the profile
 */
const getConfigDir = (args: {
  profileName: string;
  installDir: string;
}): string => {
  const { profileName, installDir } = args;
  const claudeDir = getClaudeDir({ installDir });
  return path.join(claudeDir, "profiles", profileName, "skills");
};

/**
 * Install skills
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const installSkills = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  info({ message: "Installing Nori skills..." });

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
  const claudeSkillsDir = getClaudeSkillsDir({ installDir: config.installDir });

  // Remove existing skills directory if it exists
  await fs.rm(claudeSkillsDir, { recursive: true, force: true });

  // Create skills directory
  await fs.mkdir(claudeSkillsDir, { recursive: true });

  // Read all entries from config directory
  const entries = await fs.readdir(configDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(configDir, entry.name);

    if (!entry.isDirectory()) {
      // Copy non-directory files (like docs.md) with template substitution if markdown
      const destPath = path.join(claudeSkillsDir, entry.name);
      if (entry.name.endsWith(".md")) {
        const content = await fs.readFile(sourcePath, "utf-8");
        const substituted = substituteTemplatePaths({
          content,
          installDir: config.installDir,
        });
        await fs.writeFile(destPath, substituted);
      } else {
        await fs.copyFile(sourcePath, destPath);
      }
      continue;
    }

    // Handle paid-prefixed skills
    //
    // IMPORTANT: Paid skill scripts are BUNDLED before installation.
    // The script.js files we're copying here are standalone executables created
    // by scripts/bundle-skills.ts during the build process. They contain all
    // dependencies inlined by esbuild, making them portable and executable from
    // ~/.claude/skills/ without requiring the MCP package context.
    //
    // @see scripts/bundle-skills.ts - The bundler that creates standalone scripts
    // @see src/cli/features/claude-code/profiles/config/_mixins/_paid/skills/paid-recall/script.ts - Bundling docs
    if (entry.name.startsWith("paid-")) {
      if (isPaidInstall({ config })) {
        // Strip paid- prefix when copying
        const destName = entry.name.replace(/^paid-/, "");
        const destPath = path.join(claudeSkillsDir, destName);
        await copyDirWithTemplateSubstitution({
          src: sourcePath,
          dest: destPath,
          installDir: config.installDir,
        });
      }
      // Skip if free tier
    } else {
      // Copy non-paid skills for all tiers
      const destPath = path.join(claudeSkillsDir, entry.name);
      await copyDirWithTemplateSubstitution({
        src: sourcePath,
        dest: destPath,
        installDir: config.installDir,
      });
    }
  }

  success({ message: "✓ Installed skills" });

  // Configure permissions for skills directory
  await configureSkillsPermissions({ config });
};

/**
 * Configure permissions for skills directory
 * Adds skills directory to permissions.additionalDirectories in settings.json
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const configureSkillsPermissions = async (args: {
  config: Config;
}): Promise<void> => {
  const { config } = args;
  info({ message: "Configuring permissions for skills directory..." });

  const claudeSettingsFile = getClaudeSettingsFile({
    installDir: config.installDir,
  });
  const claudeSkillsDir = getClaudeSkillsDir({ installDir: config.installDir });

  // Create .claude directory if it doesn't exist
  await fs.mkdir(path.dirname(claudeSettingsFile), { recursive: true });

  // Read or initialize settings
  let settings: any = {};
  try {
    const content = await fs.readFile(claudeSettingsFile, "utf-8");
    settings = JSON.parse(content);
  } catch {
    settings = {
      $schema: "https://json.schemastore.org/claude-code-settings.json",
    };
  }

  // Initialize permissions object if needed
  if (!settings.permissions) {
    settings.permissions = {};
  }

  // Initialize additionalDirectories array if needed
  if (!settings.permissions.additionalDirectories) {
    settings.permissions.additionalDirectories = [];
  }

  // Add skills directory if not already present
  if (!settings.permissions.additionalDirectories.includes(claudeSkillsDir)) {
    settings.permissions.additionalDirectories.push(claudeSkillsDir);
  }

  // Write back to file
  await fs.writeFile(claudeSettingsFile, JSON.stringify(settings, null, 2));
  success({ message: `✓ Configured permissions for ${claudeSkillsDir}` });
};

/**
 * Uninstall skills
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const uninstallSkills = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  info({ message: "Removing Nori skills..." });

  const claudeSkillsDir = getClaudeSkillsDir({ installDir: config.installDir });

  try {
    await fs.access(claudeSkillsDir);
    await fs.rm(claudeSkillsDir, { recursive: true, force: true });
    success({ message: "✓ Removed skills directory" });
  } catch {
    info({
      message: "Skills directory not found (may not have been installed)",
    });
  }

  // Remove permissions configuration
  await removeSkillsPermissions({ config });
};

/**
 * Remove skills directory permissions
 * Removes skills directory from permissions.additionalDirectories in settings.json
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const removeSkillsPermissions = async (args: {
  config: Config;
}): Promise<void> => {
  const { config } = args;
  info({ message: "Removing skills directory permissions..." });

  const claudeSettingsFile = getClaudeSettingsFile({
    installDir: config.installDir,
  });
  const claudeSkillsDir = getClaudeSkillsDir({ installDir: config.installDir });

  try {
    const content = await fs.readFile(claudeSettingsFile, "utf-8");
    const settings = JSON.parse(content);

    if (settings.permissions?.additionalDirectories) {
      settings.permissions.additionalDirectories =
        settings.permissions.additionalDirectories.filter(
          (dir: string) => dir !== claudeSkillsDir,
        );

      // Clean up empty arrays/objects
      if (settings.permissions.additionalDirectories.length === 0) {
        delete settings.permissions.additionalDirectories;
      }
      if (Object.keys(settings.permissions).length === 0) {
        delete settings.permissions;
      }

      await fs.writeFile(claudeSettingsFile, JSON.stringify(settings, null, 2));
      success({ message: "✓ Removed skills directory permissions" });
    } else {
      info({ message: "No permissions found in settings.json" });
    }
  } catch (err) {
    warn({ message: `Could not remove permissions: ${err}` });
  }
};

/**
 * Validate skills installation
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

  const claudeSkillsDir = getClaudeSkillsDir({ installDir: config.installDir });
  const claudeSettingsFile = getClaudeSettingsFile({
    installDir: config.installDir,
  });

  // Check if skills directory exists
  try {
    await fs.access(claudeSkillsDir);
  } catch {
    errors.push(`Skills directory not found at ${claudeSkillsDir}`);
    errors.push('Run "nori-ai install" to install skills');
    return {
      valid: false,
      message: "Skills directory not found",
      errors,
    };
  }

  // Verify expected skills exist based on tier
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
  const sourceEntries = await fs.readdir(configDir, { withFileTypes: true });

  for (const entry of sourceEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    // For paid-prefixed skills, check if they exist without prefix (paid tier only)
    if (entry.name.startsWith("paid-")) {
      if (isPaidInstall({ config })) {
        const destName = entry.name.replace(/^paid-/, "");
        try {
          await fs.access(path.join(claudeSkillsDir, destName));
        } catch {
          errors.push(`Expected skill '${destName}' not found (paid tier)`);
        }
      }
    } else {
      // Non-paid skills should exist for all tiers
      try {
        await fs.access(path.join(claudeSkillsDir, entry.name));
      } catch {
        errors.push(`Expected skill '${entry.name}' not found`);
      }
    }
  }

  if (errors.length > 0) {
    errors.push('Run "nori-ai install" to reinstall skills');
    return {
      valid: false,
      message: "Skills directory incomplete",
      errors,
    };
  }

  // Check if permissions are configured in settings.json
  try {
    const content = await fs.readFile(claudeSettingsFile, "utf-8");
    const settings = JSON.parse(content);

    if (
      !settings.permissions?.additionalDirectories?.includes(claudeSkillsDir)
    ) {
      errors.push(
        "Skills directory not configured in permissions.additionalDirectories",
      );
      errors.push('Run "nori-ai install" to configure permissions');
      return {
        valid: false,
        message: "Skills permissions not configured",
        errors,
      };
    }
  } catch {
    errors.push("Could not read or parse settings.json");
    return {
      valid: false,
      message: "Settings file error",
      errors,
    };
  }

  return {
    valid: true,
    message: "Skills are properly installed",
    errors: null,
  };
};

/**
 * Skills feature loader
 */
export const skillsLoader: ProfileLoader = {
  name: "skills",
  description: "Install skill configuration files",
  install: async (args: { config: Config }) => {
    const { config } = args;
    await installSkills({ config });
  },
  uninstall: async (args: { config: Config }) => {
    const { config } = args;
    await uninstallSkills({ config });
  },
  validate,
};
