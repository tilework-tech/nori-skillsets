/**
 * Skills feature loader
 * Installs skill configuration files to ~/.claude/nori/skills/
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

import type { Config } from '@/installer/config.js';
import type {
  Loader,
  ValidationResult,
} from '@/installer/features/loaderRegistry.js';

import { getClaudeDir } from '@/installer/env.js';
import { success, info, warn } from '@/installer/logger.js';

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get config directory for skills based on selected profile
 *
 * @param args - Configuration arguments
 * @param args.claudeDir - Claude directory path
 * @param args.profileName - Name of the profile to load skills from
 *
 * @returns Path to the skills config directory for the profile
 */
const getConfigDir = (args: {
  claudeDir: string;
  profileName: string;
}): string => {
  const { claudeDir, profileName } = args;
  return path.join(claudeDir, 'profiles', profileName, 'skills');
};

/**
 * Install skills
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const installSkills = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  info({ message: 'Installing Nori skills...' });

  // Get dynamic Claude directory
  const claudeDir = getClaudeDir({ installDir: config.installDir || null });
  const skillsDir = path.join(claudeDir, 'skills');
  const settingsFile = path.join(claudeDir, 'settings.json');

  // Get profile name from config (default to senior-swe)
  const profileName = config.profile?.baseProfile || 'senior-swe';
  const configDir = getConfigDir({ claudeDir, profileName });

  // Remove existing skills directory if it exists
  await fs.rm(skillsDir, { recursive: true, force: true });

  // Create skills directory
  await fs.mkdir(skillsDir, { recursive: true });

  // Read all entries from config directory
  const entries = await fs.readdir(configDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      // Copy non-directory files (like docs.md) directly
      const sourcePath = path.join(configDir, entry.name);
      const destPath = path.join(skillsDir, entry.name);
      await fs.copyFile(sourcePath, destPath);
      continue;
    }

    const sourcePath = path.join(configDir, entry.name);

    // Handle paid-prefixed skills
    //
    // IMPORTANT: Paid skill scripts are BUNDLED before installation.
    // The script.js files we're copying here are standalone executables created
    // by scripts/bundle-skills.ts during the build process. They contain all
    // dependencies inlined by esbuild, making them portable and executable from
    // ~/.claude/skills/ without requiring the MCP package context.
    //
    // @see scripts/bundle-skills.ts - The bundler that creates standalone scripts
    // @see mcp/src/installer/features/skills/config/paid-recall/script.ts - Bundling docs
    if (entry.name.startsWith('paid-')) {
      if (config.installType === 'paid') {
        // Strip paid- prefix when copying
        const destName = entry.name.replace(/^paid-/, '');
        const destPath = path.join(skillsDir, destName);
        await fs.cp(sourcePath, destPath, { recursive: true });
      }
      // Skip if free tier
    } else {
      // Copy non-paid skills for all tiers
      const destPath = path.join(skillsDir, entry.name);
      await fs.cp(sourcePath, destPath, { recursive: true });
    }
  }

  success({ message: '✓ Installed skills' });

  // Configure permissions for skills directory
  await configureSkillsPermissions({ skillsDir, settingsFile });
};

/**
 * Configure permissions for skills directory
 * Adds skills directory to permissions.additionalDirectories in settings.json
 */
const configureSkillsPermissions = async (args: {
  skillsDir: string;
  settingsFile: string;
}): Promise<void> => {
  const { skillsDir, settingsFile } = args;

  info({ message: 'Configuring permissions for skills directory...' });

  // Create .claude directory if it doesn't exist
  await fs.mkdir(path.dirname(settingsFile), { recursive: true });

  // Read or initialize settings
  let settings: any = {};
  try {
    const content = await fs.readFile(settingsFile, 'utf-8');
    settings = JSON.parse(content);
  } catch {
    settings = {
      $schema: 'https://json.schemastore.org/claude-code-settings.json',
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
  if (!settings.permissions.additionalDirectories.includes(skillsDir)) {
    settings.permissions.additionalDirectories.push(skillsDir);
  }

  // Write back to file
  await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2));
  success({ message: `✓ Configured permissions for ${skillsDir}` });
};

/**
 * Uninstall skills
 */
const uninstallSkills = async (args: { config: Config }): Promise<void> => {
  const { config } = args;

  info({ message: 'Removing Nori skills...' });

  // Get dynamic Claude directory
  const claudeDir = getClaudeDir({ installDir: config.installDir || null });
  const skillsDir = path.join(claudeDir, 'skills');
  const settingsFile = path.join(claudeDir, 'settings.json');

  try {
    await fs.access(skillsDir);
    await fs.rm(skillsDir, { recursive: true, force: true });
    success({ message: '✓ Removed skills directory' });
  } catch {
    info({
      message: 'Skills directory not found (may not have been installed)',
    });
  }

  // Remove permissions configuration
  await removeSkillsPermissions({ skillsDir, settingsFile });
};

/**
 * Remove skills directory permissions
 * Removes skills directory from permissions.additionalDirectories in settings.json
 */
const removeSkillsPermissions = async (args: {
  skillsDir: string;
  settingsFile: string;
}): Promise<void> => {
  const { skillsDir, settingsFile } = args;

  info({ message: 'Removing skills directory permissions...' });

  try {
    const content = await fs.readFile(settingsFile, 'utf-8');
    const settings = JSON.parse(content);

    if (settings.permissions?.additionalDirectories) {
      settings.permissions.additionalDirectories =
        settings.permissions.additionalDirectories.filter(
          (dir: string) => dir !== skillsDir,
        );

      // Clean up empty arrays/objects
      if (settings.permissions.additionalDirectories.length === 0) {
        delete settings.permissions.additionalDirectories;
      }
      if (Object.keys(settings.permissions).length === 0) {
        delete settings.permissions;
      }

      await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2));
      success({ message: '✓ Removed skills directory permissions' });
    } else {
      info({ message: 'No permissions found in settings.json' });
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

  // Get dynamic Claude directory
  const claudeDir = getClaudeDir({ installDir: config.installDir || null });
  const skillsDir = path.join(claudeDir, 'skills');
  const settingsFile = path.join(claudeDir, 'settings.json');

  // Check if skills directory exists
  try {
    await fs.access(skillsDir);
  } catch {
    errors.push(`Skills directory not found at ${skillsDir}`);
    errors.push('Run "nori-ai install" to install skills');
    return {
      valid: false,
      message: 'Skills directory not found',
      errors,
    };
  }

  // Verify expected skills exist based on tier
  const profileName = config.profile?.baseProfile || 'senior-swe';
  const configDir = getConfigDir({ claudeDir, profileName });
  const sourceEntries = await fs.readdir(configDir, { withFileTypes: true });

  for (const entry of sourceEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    // For paid-prefixed skills, check if they exist without prefix (paid tier only)
    if (entry.name.startsWith('paid-')) {
      if (config.installType === 'paid') {
        const destName = entry.name.replace(/^paid-/, '');
        try {
          await fs.access(path.join(skillsDir, destName));
        } catch {
          errors.push(`Expected skill '${destName}' not found (paid tier)`);
        }
      }
    } else {
      // Non-paid skills should exist for all tiers
      try {
        await fs.access(path.join(skillsDir, entry.name));
      } catch {
        errors.push(`Expected skill '${entry.name}' not found`);
      }
    }
  }

  if (errors.length > 0) {
    errors.push('Run "nori-ai install" to reinstall skills');
    return {
      valid: false,
      message: 'Skills directory incomplete',
      errors,
    };
  }

  // Check if permissions are configured in settings.json
  try {
    const content = await fs.readFile(settingsFile, 'utf-8');
    const settings = JSON.parse(content);

    if (!settings.permissions?.additionalDirectories?.includes(skillsDir)) {
      errors.push(
        'Skills directory not configured in permissions.additionalDirectories',
      );
      errors.push('Run "nori-ai install" to configure permissions');
      return {
        valid: false,
        message: 'Skills permissions not configured',
        errors,
      };
    }
  } catch {
    errors.push('Could not read or parse settings.json');
    return {
      valid: false,
      message: 'Settings file error',
      errors,
    };
  }

  return {
    valid: true,
    message: 'Skills are properly installed',
    errors: null,
  };
};

/**
 * Skills feature loader
 */
export const skillsLoader: Loader = {
  name: 'skills',
  description: 'Install skill configuration files',
  run: async (args: { config: Config }) => {
    const { config } = args;
    await installSkills({ config });
  },
  uninstall: async (args: { config: Config }) => {
    const { config } = args;
    await uninstallSkills({ config });
  },
  validate,
};
