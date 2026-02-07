/**
 * Skills feature loader
 * Installs skill configuration files to ~/.claude/nori/skills/
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { getAgentProfile, type Config } from "@/cli/config.js";
import {
  getClaudeDir,
  getClaudeSkillsDir,
  getClaudeSettingsFile,
  getNoriDir,
} from "@/cli/features/claude-code/paths.js";
import { substituteTemplatePaths } from "@/cli/features/claude-code/template.js";
import { success, info } from "@/cli/logger.js";

import type { ProfileLoader } from "@/cli/features/claude-code/profiles/profileLoaderRegistry.js";
import type { Dirent } from "fs";

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
 * Get profile directory based on selected profile
 *
 * @param args - Configuration arguments
 * @param args.profileName - Name of the profile
 *
 * @returns Path to the profile directory
 */
const getProfileDir = (args: { profileName: string }): string => {
  const { profileName } = args;
  const noriDir = getNoriDir();
  return path.join(noriDir, "profiles", profileName);
};

/**
 * Get config directory for skills based on selected profile
 *
 * @param args - Configuration arguments
 * @param args.profileName - Name of the profile to load skills from
 *
 * @returns Path to the skills config directory for the profile
 */
const getConfigDir = (args: { profileName: string }): string => {
  const { profileName } = args;
  return path.join(getProfileDir({ profileName }), "skills");
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
      "No profile configured for claude-code. Run 'nori-skillsets init' to configure a profile.",
    );
  }
  const configDir = getConfigDir({
    profileName,
  });
  const claudeDir = getClaudeDir({ installDir: config.installDir });
  const claudeSkillsDir = getClaudeSkillsDir({ installDir: config.installDir });

  // Remove existing skills directory if it exists
  await fs.rm(claudeSkillsDir, { recursive: true, force: true });

  // Create skills directory
  await fs.mkdir(claudeSkillsDir, { recursive: true });

  // Step 1: Install inline skills from profile's skills/ folder
  let entries: Array<Dirent>;
  try {
    entries = await fs.readdir(configDir, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(configDir, entry.name);

      if (!entry.isDirectory()) {
        // Copy non-directory files (like docs.md) with template substitution if markdown
        const destPath = path.join(claudeSkillsDir, entry.name);
        if (entry.name.endsWith(".md")) {
          const content = await fs.readFile(sourcePath, "utf-8");
          const substituted = substituteTemplatePaths({
            content,
            installDir: claudeDir,
          });
          await fs.writeFile(destPath, substituted);
        } else {
          await fs.copyFile(sourcePath, destPath);
        }
        continue;
      }

      const destPath = path.join(claudeSkillsDir, entry.name);
      await copyDirWithTemplateSubstitution({
        src: sourcePath,
        dest: destPath,
        installDir: claudeDir,
      });
    }
  } catch {
    // Profile skills directory not found - continue to check skills.json
    info({
      message: "Profile skills directory not found, checking skills.json",
    });
  }

  // Note: External skills from skills.json are now stored in the profile's own skills
  // directory ({profileDir}/skills/) after being downloaded by registry-download.
  // Step 1 already copies all skills from that directory, so no separate step is needed.
  // The skills.json file is now just metadata for tracking which skills were downloaded.

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
 * Skills feature loader
 */
export const skillsLoader: ProfileLoader = {
  name: "skills",
  description: "Install skill configuration files",
  install: async (args: { config: Config }) => {
    const { config } = args;
    await installSkills({ config });
  },
};
