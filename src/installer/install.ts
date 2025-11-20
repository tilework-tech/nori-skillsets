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

import { trackEvent } from "@/installer/analytics.js";
import {
  displayNoriBanner,
  displayWelcomeBanner,
  displaySeaweedBed,
} from "@/installer/asciiArt.js";
import {
  loadDiskConfig,
  saveDiskConfig,
  generateConfig,
  getConfigPath,
  type DiskConfig,
  type Config,
} from "@/installer/config.js";
import { getClaudeDir } from "@/installer/env.js";
import { LoaderRegistry } from "@/installer/features/loaderRegistry.js";
import { profilesLoader } from "@/installer/features/profiles/loader.js";
import {
  error,
  success,
  info,
  warn,
  wrapText,
  brightCyan,
  boldWhite,
  gray,
} from "@/installer/logger.js";
import { promptUser } from "@/installer/prompt.js";
import {
  getCurrentPackageVersion,
  getInstalledVersion,
  hasExistingInstallation,
  saveInstalledVersion,
} from "@/installer/version.js";
import {
  normalizeInstallDir,
  findAncestorInstallations,
} from "@/utils/path.js";

// Get directory of this installer file for profile loading
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Prompt user to select a profile
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Selected profile name
 */
const promptForProfileSelection = async (args: {
  installDir: string;
}): Promise<string> => {
  const { installDir } = args;

  info({
    message: wrapText({
      text: "Please select a profile. Each profile contains a complete configuration with skills, subagents, and commands tailored for different use cases.",
    }),
  });
  console.log();

  // Read profiles from ~/.claude/profiles/ (populated by profiles loader)
  const claudeDir = getClaudeDir({ installDir });
  const profilesDir = path.join(claudeDir, "profiles");
  const entries = await fs.readdir(profilesDir, { withFileTypes: true });

  // Get all directories that have a profile.json file
  const profiles: Array<{ name: string; description: string }> = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      try {
        const profileJsonPath = path.join(
          profilesDir,
          entry.name,
          "profile.json",
        );
        await fs.access(profileJsonPath);

        // Read description from profile.json
        const content = await fs.readFile(profileJsonPath, "utf-8");
        const profileData = JSON.parse(content);

        profiles.push({
          name: entry.name,
          description: profileData.description || "No description available",
        });
      } catch {
        // Skip directories without profile.json
      }
    }
  }

  // Display profiles with enhanced formatting
  profiles.forEach((p, i) => {
    const number = brightCyan({ text: `${i + 1}.` });
    const name = boldWhite({ text: p.name });
    const description = gray({ text: p.description });

    console.log(`${number} ${name}`);
    console.log(`   ${description}`);
    console.log();
  });

  // Loop until valid selection
  while (true) {
    const response = await promptUser({
      prompt: `Select a profile (1-${profiles.length}): `,
    });

    const selectedIndex = parseInt(response) - 1;
    if (selectedIndex >= 0 && selectedIndex < profiles.length) {
      const selected = profiles[selectedIndex];
      info({ message: `Loading "${selected.name}" profile...` });
      return selected.name;
    }

    // Invalid selection - show error and loop
    error({
      message: `Invalid selection "${response}". Please enter a number between 1 and ${profiles.length}.`,
    });
    console.log();
  }
};

/**
 * Prompt user for authentication credentials
 * @returns Auth credentials or null for free tier
 */
const promptForCredentials = async (): Promise<{
  username: string;
  password: string;
  organizationUrl: string;
} | null> => {
  info({
    message: wrapText({
      text: "Do you have Nori credentials? You should have gotten an email from Josh or Amol if you are on the Nori paid plan. Type in your email address to set up Nori Paid, or hit enter to skip.",
    }),
  });
  console.log();

  const username = await promptUser({
    prompt: "Email address (paid tier) or hit enter to skip (free tier): ",
  });

  if (!username || username.trim() === "") {
    return null; // Free tier
  }

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

  return {
    username: username.trim(),
    password: password.trim(),
    organizationUrl: orgUrl.trim(),
  };
};

/**
 * Prompt user for authentication credentials (without profile selection)
 * @param args - Function arguments
 * @param args.existingDiskConfig - Existing disk config (if any)
 *
 * @returns Auth credentials and whether to use existing config
 */
const promptForAuth = async (args: {
  existingDiskConfig: DiskConfig | null;
}): Promise<{
  auth: {
    username: string;
    password: string;
    organizationUrl: string;
  } | null;
  useExistingConfig: boolean;
}> => {
  const { existingDiskConfig } = args;

  if (existingDiskConfig?.auth) {
    // Display existing configuration
    info({
      message:
        "I found an existing Nori configuration file. Do you want to keep it?",
    });
    console.log();
    info({ message: `  Username: ${existingDiskConfig.auth.username}` });
    info({
      message: `  Organization URL: ${existingDiskConfig.auth.organizationUrl}`,
    });
    if (existingDiskConfig.profile) {
      info({
        message: `  Profile: ${existingDiskConfig.profile.baseProfile}`,
      });
    }
    console.log();

    const useExisting = await promptUser({
      prompt: "Keep existing configuration? (y/n): ",
    });

    if (useExisting.match(/^[Yy]$/)) {
      info({ message: "Using existing configuration..." });
      return {
        auth: existingDiskConfig.auth,
        useExistingConfig: true,
      };
    }

    // User chose not to use existing config, continue with prompts
    console.log();
  }

  // Prompt for credentials
  const auth = await promptForCredentials();

  if (auth != null) {
    info({ message: "Installing with backend support..." });
    console.log();
  } else {
    info({ message: "Great. Let's move on to selecting your profile." });
    console.log();
  }

  return {
    auth,
    useExistingConfig: false,
  };
};

/**
 * Complete the configuration by prompting for profile selection
 * @param args - Configuration arguments
 * @param args.auth - Auth credentials (already determined)
 * @param args.existingProfile - Existing profile selection (if reusing config)
 * @param args.installDir - Installation directory
 *
 * @returns The configuration and disk config to save
 */
const completeConfig = async (args: {
  auth: {
    username: string;
    password: string;
    organizationUrl: string;
  } | null;
  existingProfile: { baseProfile: string } | null;
  installDir: string;
}): Promise<{
  config: Config;
  diskConfigToSave: DiskConfig;
}> => {
  const { auth, existingProfile, installDir } = args;

  // If we have an existing profile (from reusing existing config), use it
  // Otherwise, prompt for selection
  const selectedProfileName =
    existingProfile?.baseProfile ||
    (await promptForProfileSelection({ installDir }));

  // Build disk config with auth + profile
  const diskConfig: DiskConfig = {
    auth: auth || undefined,
    profile: {
      baseProfile: selectedProfileName,
    },
    installDir,
  };

  return {
    config: {
      ...generateConfig({ diskConfig, installDir }),
    },
    diskConfigToSave: diskConfig,
  };
};

/**
 * Main installer entry point
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
    // Check for ancestor installations that might cause conflicts
    const normalizedInstallDir = normalizeInstallDir({ installDir });
    const ancestorInstallations = findAncestorInstallations({
      installDir: normalizedInstallDir,
    });

    if (ancestorInstallations.length > 0) {
      console.log(); // Add spacing
      warn({
        message: "⚠️  Nori installation detected in ancestor directory!",
      });
      console.log();
      info({
        message:
          "Claude Code loads CLAUDE.md files from all parent directories.",
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
      info({
        message: "To remove an existing installation, run:",
      });
      for (const ancestorPath of ancestorInstallations) {
        info({
          message: `  cd ${ancestorPath} && npx nori-ai@latest uninstall`,
        });
      }
      console.log();

      // In interactive mode, prompt for confirmation
      if (!nonInteractive) {
        const continueAnyway = await promptUser({
          prompt:
            "Do you want to continue with the installation anyway? (y/n): ",
        });

        if (!continueAnyway.match(/^[Yy]$/)) {
          info({ message: "Installation cancelled." });
          process.exit(0);
        }
        console.log();
      } else {
        // In non-interactive mode, warn and continue
        warn({
          message:
            "Continuing with installation in non-interactive mode despite ancestor installations...",
        });
        console.log();
      }
    }

    // Check if there's an existing installation to clean up
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

      // Call uninstall at the PREVIOUS version
      try {
        execSync(`npx nori-ai@${previousVersion} uninstall --non-interactive`, {
          stdio: "inherit",
        });
      } catch (err: any) {
        // If uninstall fails, log but continue with installation
        // This handles cases where the previous version didn't have uninstall
        info({
          message: `Note: Uninstall at v${previousVersion} failed (may not exist). Continuing with installation...`,
        });
      }
    } else if (skipUninstall) {
      // Skipping uninstall explicitly (e.g., for profile switching)
      info({
        message:
          "Skipping uninstall step (preserving existing installation)...",
      });
    } else {
      // First-time installation - no cleanup needed
      info({
        message: "First-time installation detected. No cleanup needed.",
      });
    }

    // Load existing disk config (if any)
    const existingDiskConfig = await loadDiskConfig({
      installDir: normalizedInstallDir,
    });

    let config: Config;
    let diskConfigToSave: DiskConfig | null = null;

    if (nonInteractive) {
      // Non-interactive mode: use existing config or default to free
      if (existingDiskConfig?.auth) {
        config = {
          ...generateConfig({
            diskConfig: existingDiskConfig,
            installDir: normalizedInstallDir,
          }),
          nonInteractive: true,
          installDir: normalizedInstallDir,
        };
      } else {
        config = {
          installType: "free",
          nonInteractive: true,
          profile: { baseProfile: "senior-swe" },
          installDir: normalizedInstallDir,
        };
      }

      // Run profile loader with the config
      info({ message: "Loading available profiles..." });
      await profilesLoader.run({ config });
      console.log();
    } else {
      // Interactive mode: show prompts
      displayNoriBanner();
      console.log();
      info({ message: "Let's personalize Nori to your needs." });
      console.log();

      // 1. Prompt for auth credentials FIRST (or reuse existing)
      const { auth, useExistingConfig } = await promptForAuth({
        existingDiskConfig,
      });

      // 2. Build temporary config for profile loader
      const tempDiskConfig: DiskConfig = {
        auth: auth || undefined,
        profile: existingDiskConfig?.profile || null,
        installDir: normalizedInstallDir,
      };
      config = generateConfig({
        diskConfig: tempDiskConfig,
        installDir: normalizedInstallDir,
      });

      // 3. Run profile loader with CORRECT config (paid if auth exists)
      info({ message: "Loading available profiles..." });
      await profilesLoader.run({ config });
      console.log();

      // 4. If not reusing existing config, prompt for profile selection
      if (!useExistingConfig) {
        const result = await completeConfig({
          auth,
          existingProfile: null, // Force new selection
          installDir: normalizedInstallDir,
        });
        config = result.config;
        diskConfigToSave = result.diskConfigToSave;
      } else {
        // Reusing existing config - no need to save
        diskConfigToSave = null;
      }
    }

    // Track installation start
    trackEvent({
      eventName: "plugin_install_started",
      eventParams: {
        install_type: config.installType,
        non_interactive: config.nonInteractive || false,
      },
    });

    // Create install-in-progress marker file for statusline tracking
    const currentVersion = getCurrentPackageVersion();
    if (currentVersion) {
      const markerPath = path.join(
        process.env.HOME || "~",
        ".nori-install-in-progress",
      );
      writeFileSync(markerPath, currentVersion, "utf-8");
    }

    // Save disk config if needed
    if (diskConfigToSave != null) {
      await saveDiskConfig({
        username: diskConfigToSave.auth?.username || null,
        password: diskConfigToSave.auth?.password || null,
        organizationUrl: diskConfigToSave.auth?.organizationUrl || null,
        profile: diskConfigToSave.profile || null,
        installDir: normalizedInstallDir,
      });
      success({
        message: `Configuration saved to ${getConfigPath({ installDir: normalizedInstallDir })}`,
      });
      console.log();
    }

    // Load all feature loaders (excluding profiles, which already ran)
    const registry = LoaderRegistry.getInstance();
    const loaders = registry.getAll();

    info({ message: "Installing features..." });
    console.log();

    // Execute all loaders except profiles (profiles already ran above)
    const remainingLoaders = loaders.filter((l) => l.name !== "profiles");
    for (const loader of remainingLoaders) {
      await loader.run({ config });
    }

    // Installation complete
    console.log();

    // Save installed version
    const finalVersion = getCurrentPackageVersion();
    if (finalVersion) {
      saveInstalledVersion({
        version: finalVersion,
        installDir: normalizedInstallDir,
      });
    }

    // Delete install-in-progress marker on successful completion
    const markerPath = path.join(
      process.env.HOME || "~",
      ".nori-install-in-progress",
    );
    if (existsSync(markerPath)) {
      unlinkSync(markerPath);
    }

    // Track installation completion
    trackEvent({
      eventName: "plugin_install_completed",
      eventParams: {
        install_type: config.installType,
        non_interactive: config.nonInteractive || false,
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
  } catch (err: any) {
    error({ message: err.message });
    process.exit(1);
  }
};

// Run the installer if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
