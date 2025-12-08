#!/usr/bin/env node

/**
 * Nori Profiles Installer
 *
 * Pipeline-style installer that prompts for configuration and executes feature loaders.
 */

import { execSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { trackEvent } from "@/cli/analytics.js";
import {
  displayNoriBanner,
  displayWelcomeBanner,
  displaySeaweedBed,
} from "@/cli/commands/install/asciiArt.js";
import { hasExistingInstallation } from "@/cli/commands/install/installState.js";
import { promptRegistryAuths } from "@/cli/commands/install/registryAuthPrompt.js";
import {
  loadConfig,
  getDefaultProfile,
  isPaidInstall,
  type Config,
} from "@/cli/config.js";
import { getClaudeDir } from "@/cli/env.js";
import { LoaderRegistry } from "@/cli/features/loaderRegistry.js";
import {
  error,
  success,
  info,
  warn,
  wrapText,
  brightCyan,
  boldWhite,
  gray,
} from "@/cli/logger.js";
import { promptUser } from "@/cli/prompt.js";
import {
  getCurrentPackageVersion,
  getInstalledVersion,
  saveInstalledVersion,
} from "@/cli/version.js";
import { normalizeInstallDir, getInstallDirs } from "@/utils/path.js";

import type { Command } from "commander";

// Get directory of this installer file for profile loading
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Source profiles directory (in the package)
// From src/cli/commands/install/ go up to src/cli/features/profiles/config
const SOURCE_PROFILES_DIR = path.join(
  __dirname,
  "..",
  "..",
  "features",
  "profiles",
  "config",
);

/**
 * Get available profiles from both source and installed locations
 * Creates a superset of all available profiles
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Array of available profiles with names and descriptions
 */
const getAvailableProfiles = async (args: {
  installDir: string;
}): Promise<Array<{ name: string; description: string }>> => {
  const { installDir } = args;
  const profilesMap = new Map<string, { name: string; description: string }>();

  // Read from source profiles directory (available profiles in package)
  const sourceEntries = await fs.readdir(SOURCE_PROFILES_DIR, {
    withFileTypes: true,
  });

  for (const entry of sourceEntries) {
    // Skip internal directories and non-directories
    if (!entry.isDirectory() || entry.name.startsWith("_")) {
      continue;
    }

    const profileJsonPath = path.join(
      SOURCE_PROFILES_DIR,
      entry.name,
      "profile.json",
    );

    const content = await fs.readFile(profileJsonPath, "utf-8");
    const profileData = JSON.parse(content);

    profilesMap.set(entry.name, {
      name: entry.name,
      description: profileData.description || "No description available",
    });
  }

  // Read from installed profiles directory (already installed profiles)
  try {
    const claudeDir = getClaudeDir({ installDir });
    const installedProfilesDir = path.join(claudeDir, "profiles");
    const installedEntries = await fs.readdir(installedProfilesDir, {
      withFileTypes: true,
    });

    for (const entry of installedEntries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const profileJsonPath = path.join(
        installedProfilesDir,
        entry.name,
        "profile.json",
      );

      try {
        const content = await fs.readFile(profileJsonPath, "utf-8");
        const profileData = JSON.parse(content);

        // Add to map (will override source if same name exists)
        profilesMap.set(entry.name, {
          name: entry.name,
          description: profileData.description || "No description available",
        });
      } catch {
        // Skip if can't read profile.json
      }
    }
  } catch {
    // Installed profiles directory doesn't exist yet - that's fine
  }

  return Array.from(profilesMap.values());
};

/**
 * Generate prompt configuration by consolidating all prompt logic
 * This function handles all user prompts and returns the complete configuration
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.existingConfig - Existing configuration (if any)
 *
 * @returns Runtime configuration, or null if user cancels
 */
export const generatePromptConfig = async (args: {
  installDir: string;
  existingConfig: Config | null;
}): Promise<Config | null> => {
  const { installDir, existingConfig } = args;

  // Check if user wants to reuse existing config
  if (existingConfig?.auth) {
    info({
      message:
        "I found an existing Nori configuration file. Do you want to keep it?",
    });
    console.log();
    info({ message: `  Username: ${existingConfig.auth.username}` });
    info({
      message: `  Organization URL: ${existingConfig.auth.organizationUrl}`,
    });
    if (existingConfig.profile) {
      info({
        message: `  Profile: ${existingConfig.profile.baseProfile}`,
      });
    }
    console.log();

    const useExisting = await promptUser({
      prompt: "Keep existing configuration? (y/n): ",
    });

    if (useExisting.match(/^[Yy]$/)) {
      info({ message: "Using existing configuration..." });
      return {
        ...existingConfig,
        profile: existingConfig.profile ?? getDefaultProfile(),
        installDir,
      };
    }

    console.log();
  }

  // Prompt for credentials
  info({
    message: wrapText({
      text: "Nori Watchtower is our backend service that enables shared knowledge features - search and recall past solutions across your team, save learnings for future sessions, and server-side documentation with versioning. If you have Watchtower credentials (you should have received them from Josh or Amol), enter your email to enable these features. Otherwise, press enter to continue with local-only features.",
    }),
  });
  console.log();

  const username = await promptUser({
    prompt: "Email address (Watchtower) or hit enter to skip: ",
  });

  let auth: {
    username: string;
    password: string;
    organizationUrl: string;
  } | null = null;

  if (username && username.trim() !== "") {
    const password = await promptUser({
      prompt: "Enter your password: ",
      hidden: true,
    });

    const orgUrl = await promptUser({
      prompt:
        "Enter your organization URL (e.g., http://localhost:3000 for local dev): ",
    });

    if (!password || !orgUrl) {
      error({
        message:
          "Password and organization URL are required for backend installation",
      });
      process.exit(1);
    }

    auth = {
      username: username.trim(),
      password: password.trim(),
      organizationUrl: orgUrl.trim(),
    };

    info({ message: "Installing with backend support..." });
    console.log();
  } else {
    info({ message: "Great. Let's move on to selecting your profile." });
    console.log();
  }

  // Get available profiles from both source and installed locations
  const profiles = await getAvailableProfiles({ installDir });

  if (profiles.length === 0) {
    error({ message: "No profiles found. This should not happen." });
    process.exit(1);
  }

  // Display profiles
  info({
    message: wrapText({
      text: "Please select a profile. Each profile contains a complete configuration with skills, subagents, and commands tailored for different use cases.",
    }),
  });
  console.log();

  profiles.forEach((p, i) => {
    const number = brightCyan({ text: `${i + 1}.` });
    const name = boldWhite({ text: p.name });
    const description = gray({ text: p.description });

    console.log(`${number} ${name}`);
    console.log(`   ${description}`);
    console.log();
  });

  // Loop until valid selection
  let selectedProfileName: string;
  while (true) {
    const response = await promptUser({
      prompt: `Select a profile (1-${profiles.length}): `,
    });

    const selectedIndex = parseInt(response) - 1;
    if (selectedIndex >= 0 && selectedIndex < profiles.length) {
      const selected = profiles[selectedIndex];
      info({ message: `Loading "${selected.name}" profile...` });
      selectedProfileName = selected.name;
      break;
    }

    // Invalid selection - show error and loop
    error({
      message: `Invalid selection "${response}". Please enter a number between 1 and ${profiles.length}.`,
    });
    console.log();
  }

  // Prompt for private registry authentication
  console.log();
  const registryAuths = await promptRegistryAuths({
    existingRegistryAuths: existingConfig?.registryAuths ?? null,
  });

  // Build config directly
  return {
    auth: auth ?? null,
    profile: {
      baseProfile: selectedProfileName,
    },
    installDir,
    registryAuths: registryAuths ?? null,
  };
};

/**
 * Interactive installation mode
 * Prompts user for all configuration and performs installation
 *
 * @param args - Configuration arguments
 * @param args.skipUninstall - Whether to skip uninstall step
 * @param args.installDir - Installation directory (optional)
 */
export const interactive = async (args?: {
  skipUninstall?: boolean | null;
  installDir?: string | null;
}): Promise<void> => {
  const { skipUninstall, installDir } = args || {};
  const normalizedInstallDir = normalizeInstallDir({ installDir });

  // Check for ancestor installations that might cause conflicts
  const allInstallations = getInstallDirs({
    currentDir: normalizedInstallDir,
  });
  // Filter out the current directory to get only ancestors
  const ancestorInstallations = allInstallations.filter(
    (dir) => dir !== normalizedInstallDir,
  );

  if (ancestorInstallations.length > 0) {
    console.log();
    warn({ message: "⚠️  Nori installation detected in ancestor directory!" });
    console.log();
    info({
      message: "Claude Code loads CLAUDE.md files from all parent directories.",
    });
    info({
      message:
        "Having multiple Nori installations can cause duplicate or conflicting configurations.",
    });
    console.log();
    info({ message: "Existing Nori installations found at:" });
    for (const ancestorPath of ancestorInstallations) {
      info({ message: `  • ${ancestorPath}` });
    }
    console.log();
    info({ message: "To remove an existing installation, run:" });
    for (const ancestorPath of ancestorInstallations) {
      info({
        message: `  cd ${ancestorPath} && nori-ai uninstall`,
      });
    }
    console.log();

    const continueAnyway = await promptUser({
      prompt: "Do you want to continue with the installation anyway? (y/n): ",
    });

    if (!continueAnyway.match(/^[Yy]$/)) {
      info({ message: "Installation cancelled." });
      process.exit(0);
    }
    console.log();
  }

  // Handle existing installation cleanup
  if (
    !skipUninstall &&
    hasExistingInstallation({ installDir: normalizedInstallDir })
  ) {
    const previousVersion = getInstalledVersion({
      installDir: normalizedInstallDir,
    });
    info({
      message: `Cleaning up previous installation (v${previousVersion})...`,
    });

    try {
      execSync(
        `nori-ai uninstall --non-interactive --install-dir="${normalizedInstallDir}"`,
        {
          stdio: "inherit",
        },
      );
    } catch (err: any) {
      info({
        message: `Note: Uninstall at v${previousVersion} failed (may not exist). Continuing with installation...`,
      });
    }
  } else if (skipUninstall) {
    info({
      message: "Skipping uninstall step (preserving existing installation)...",
    });
  } else {
    info({ message: "First-time installation detected. No cleanup needed." });
  }

  // Display banner
  displayNoriBanner();
  console.log();
  info({ message: "Let's personalize Nori to your needs." });
  console.log();

  // Load existing config
  const existingConfig = await loadConfig({
    installDir: normalizedInstallDir,
  });

  // Generate configuration through prompts
  const config = await generatePromptConfig({
    installDir: normalizedInstallDir,
    existingConfig,
  });

  if (config == null) {
    info({ message: "Installation cancelled." });
    process.exit(0);
  }

  // Track installation start
  trackEvent({
    eventName: "plugin_install_started",
    eventParams: {
      install_type: isPaidInstall({ config }) ? "paid" : "free",
      non_interactive: false,
    },
  });

  // Create progress marker
  const currentVersion = getCurrentPackageVersion();
  if (currentVersion) {
    const markerPath = path.join(
      process.env.HOME || "~",
      ".nori-install-in-progress",
    );
    writeFileSync(markerPath, currentVersion, "utf-8");
  }

  // Run all loaders (including profiles)
  const registry = LoaderRegistry.getInstance();
  const loaders = registry.getAll();

  info({ message: "Installing features..." });
  console.log();

  for (const loader of loaders) {
    await loader.run({ config });
  }

  console.log();

  // Save version
  const finalVersion = getCurrentPackageVersion();
  if (finalVersion) {
    saveInstalledVersion({
      version: finalVersion,
      installDir: normalizedInstallDir,
    });
  }

  // Remove progress marker
  const markerPath = path.join(
    process.env.HOME || "~",
    ".nori-install-in-progress",
  );
  if (existsSync(markerPath)) {
    unlinkSync(markerPath);
  }

  // Track completion
  trackEvent({
    eventName: "plugin_install_completed",
    eventParams: {
      install_type: isPaidInstall({ config }) ? "paid" : "free",
      non_interactive: false,
    },
  });

  displayWelcomeBanner();
  success({
    message:
      "======================================================================",
  });
  success({
    message:
      "        Restart your Claude Code instances to get started           ",
  });
  success({
    message:
      "======================================================================",
  });
  console.log();
  displaySeaweedBed();
  console.log();
};

/**
 * Non-interactive installation mode
 * Uses existing config or defaults, no prompting
 *
 * @param args - Configuration arguments
 * @param args.skipUninstall - Whether to skip uninstall step
 * @param args.installDir - Installation directory (optional)
 */
export const noninteractive = async (args?: {
  skipUninstall?: boolean | null;
  installDir?: string | null;
}): Promise<void> => {
  const { skipUninstall, installDir } = args || {};
  const normalizedInstallDir = normalizeInstallDir({ installDir });

  // Check for ancestor installations (warn but continue)
  const allInstallations = getInstallDirs({
    currentDir: normalizedInstallDir,
  });
  const ancestorInstallations = allInstallations.filter(
    (dir) => dir !== normalizedInstallDir,
  );

  if (ancestorInstallations.length > 0) {
    console.log();
    warn({ message: "⚠️  Nori installation detected in ancestor directory!" });
    console.log();
    info({
      message: "Claude Code loads CLAUDE.md files from all parent directories.",
    });
    info({
      message:
        "Having multiple Nori installations can cause duplicate or conflicting configurations.",
    });
    console.log();
    info({ message: "Existing Nori installations found at:" });
    for (const ancestorPath of ancestorInstallations) {
      info({ message: `  • ${ancestorPath}` });
    }
    console.log();
    info({ message: "To remove an existing installation, run:" });
    for (const ancestorPath of ancestorInstallations) {
      info({
        message: `  cd ${ancestorPath} && nori-ai uninstall`,
      });
    }
    console.log();
    warn({
      message:
        "Continuing with installation in non-interactive mode despite ancestor installations...",
    });
    console.log();
  }

  // Handle existing installation cleanup
  if (
    !skipUninstall &&
    hasExistingInstallation({ installDir: normalizedInstallDir })
  ) {
    const previousVersion = getInstalledVersion({
      installDir: normalizedInstallDir,
    });
    info({
      message: `Cleaning up previous installation (v${previousVersion})...`,
    });

    try {
      execSync(
        `nori-ai uninstall --non-interactive --install-dir="${normalizedInstallDir}"`,
        {
          stdio: "inherit",
        },
      );
    } catch (err: any) {
      info({
        message: `Note: Uninstall at v${previousVersion} failed (may not exist). Continuing with installation...`,
      });
    }
  } else if (skipUninstall) {
    info({
      message: "Skipping uninstall step (preserving existing installation)...",
    });
  } else {
    info({ message: "First-time installation detected. No cleanup needed." });
  }

  // Load existing config or use defaults
  const existingConfig = await loadConfig({
    installDir: normalizedInstallDir,
  });

  const config: Config = existingConfig ?? {
    profile: getDefaultProfile(),
    installDir: normalizedInstallDir,
  };

  // Track installation start
  trackEvent({
    eventName: "plugin_install_started",
    eventParams: {
      install_type: isPaidInstall({ config }) ? "paid" : "free",
      non_interactive: true,
    },
  });

  // Create progress marker
  const currentVersion = getCurrentPackageVersion();
  if (currentVersion) {
    const markerPath = path.join(
      process.env.HOME || "~",
      ".nori-install-in-progress",
    );
    writeFileSync(markerPath, currentVersion, "utf-8");
  }

  // Run all loaders
  const registry = LoaderRegistry.getInstance();
  const loaders = registry.getAll();

  info({ message: "Installing features..." });
  console.log();

  for (const loader of loaders) {
    await loader.run({ config });
  }

  console.log();

  // Save version
  const finalVersion = getCurrentPackageVersion();
  if (finalVersion) {
    saveInstalledVersion({
      version: finalVersion,
      installDir: normalizedInstallDir,
    });
  }

  // Remove progress marker
  const markerPath = path.join(
    process.env.HOME || "~",
    ".nori-install-in-progress",
  );
  if (existsSync(markerPath)) {
    unlinkSync(markerPath);
  }

  // Track completion
  trackEvent({
    eventName: "plugin_install_completed",
    eventParams: {
      install_type: isPaidInstall({ config }) ? "paid" : "free",
      non_interactive: true,
    },
  });

  displayWelcomeBanner();
  success({
    message:
      "======================================================================",
  });
  success({
    message:
      "        Restart your Claude Code instances to get started           ",
  });
  success({
    message:
      "======================================================================",
  });
  console.log();
  displaySeaweedBed();
  console.log();
};

/**
 * Main installer entry point
 * Routes to interactive or non-interactive mode
 * @param args - Configuration arguments
 * @param args.nonInteractive - Whether to run in non-interactive mode
 * @param args.skipUninstall - Whether to skip uninstall step (useful for profile switching)
 * @param args.installDir - Custom installation directory (optional)
 */
export const main = async (args?: {
  nonInteractive?: boolean | null;
  skipUninstall?: boolean | null;
  installDir?: string | null;
}): Promise<void> => {
  const { nonInteractive, skipUninstall, installDir } = args || {};

  try {
    if (nonInteractive) {
      await noninteractive({ skipUninstall, installDir });
    } else {
      await interactive({ skipUninstall, installDir });
    }
  } catch (err: any) {
    error({ message: err.message });
    process.exit(1);
  }
};

/**
 * Register the 'install' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerInstallCommand = (args: { program: Command }): void => {
  const { program } = args;

  program
    .command("install")
    .description("Install Nori Profiles")
    .action(async () => {
      // Get global options from parent
      const globalOpts = program.opts();

      await main({
        nonInteractive: globalOpts.nonInteractive || null,
        installDir: globalOpts.installDir || null,
      });
    });
};
