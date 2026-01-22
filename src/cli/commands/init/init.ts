/**
 * Init Command
 *
 * Initializes Nori configuration and directories.
 * This is the first step in the installation process.
 *
 * Responsibilities:
 * - Create .nori-config.json with minimal structure
 * - Create ~/.nori/profiles/ directory
 * - Detect and capture existing Claude Code configuration as a profile
 * - Warn about ancestor installations
 */

import * as fs from "fs/promises";

import {
  detectExistingConfig,
  captureExistingConfigAsProfile,
  promptForExistingConfigCapture,
} from "@/cli/commands/install/existingConfigCapture.js";
import { loadConfig, saveConfig, type Config } from "@/cli/config.js";
import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";
import { claudeMdLoader } from "@/cli/features/claude-code/profiles/claudemd/loader.js";
import { info, warn, newline, success } from "@/cli/logger.js";
import { promptUser } from "@/cli/prompt.js";
import { getCurrentPackageVersion } from "@/cli/version.js";
import { normalizeInstallDir, getInstallDirs } from "@/utils/path.js";

import type { Command } from "commander";

/**
 * Check if a directory exists
 *
 * @param dirPath - Path to the directory to check
 *
 * @returns True if the directory exists, false otherwise
 */
const directoryExists = async (dirPath: string): Promise<boolean> => {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
};

/**
 * Display profile persistence warning and require "yes" confirmation
 *
 * @param args - Configuration arguments
 * @param args.nonInteractive - Whether to run in non-interactive mode
 *
 * @returns True if user confirmed, false if cancelled
 */
const displayProfilePersistenceWarning = async (args: {
  nonInteractive: boolean;
}): Promise<boolean> => {
  const { nonInteractive } = args;

  // Skip warning in non-interactive mode
  if (nonInteractive) {
    return true;
  }

  // Display prominent warning
  newline();
  warn({
    message:
      "╔════════════════════════════════════════════════════════════════╗",
  });
  warn({
    message:
      "║                   IMPORTANT: Skillset Persistence              ║",
  });
  warn({
    message:
      "╚════════════════════════════════════════════════════════════════╝",
  });
  newline();
  info({
    message:
      "By running init, nori will manage your config. From here on, any changes",
  });
  info({
    message:
      "to ~/.claude/skills/, ~/.claude/CLAUDE.md, or other configuration",
  });
  info({
    message: "files will be OVERWRITTEN the next time you run switch-skillset.",
  });
  newline();
  info({ message: "To persist your customizations across skillset switches:" });
  info({ message: "  • Make changes in ~/.nori/profiles/<profile-name>/" });
  info({ message: "  • Or create a new custom skillset" });
  newline();

  const response = await promptUser({
    prompt: "Type 'yes' to confirm you understand: ",
  });

  if (response.trim().toLowerCase() !== "yes") {
    newline();
    info({ message: "Initialization cancelled." });
    return false;
  }

  newline();
  return true;
};

/**
 * Main init function
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.nonInteractive - Whether to run in non-interactive mode
 * @param args.skipWarning - Whether to skip the profile persistence warning (useful for auto-init in download flows)
 */
export const initMain = async (args?: {
  installDir?: string | null;
  nonInteractive?: boolean | null;
  skipWarning?: boolean | null;
}): Promise<void> => {
  const { installDir, nonInteractive, skipWarning } = args ?? {};
  const normalizedInstallDir = normalizeInstallDir({ installDir });

  // Show profile persistence warning and get confirmation (unless skipped)
  if (!skipWarning) {
    const confirmed = await displayProfilePersistenceWarning({
      nonInteractive: nonInteractive ?? false,
    });

    if (!confirmed) {
      return;
    }
  }

  // Check for ancestor installations
  const allInstallations = getInstallDirs({
    currentDir: normalizedInstallDir,
  });
  const ancestorInstallations = allInstallations.filter(
    (dir) => dir !== normalizedInstallDir,
  );

  if (ancestorInstallations.length > 0) {
    newline();
    warn({ message: "⚠️  Nori installation detected in ancestor directory!" });
    newline();
    info({
      message: "Claude Code loads CLAUDE.md files from all parent directories.",
    });
    info({
      message:
        "Having multiple Nori installations can cause duplicate or conflicting configurations.",
    });
    newline();
    info({ message: "Existing Nori installations found at:" });
    for (const ancestorPath of ancestorInstallations) {
      info({ message: `  • ${ancestorPath}` });
    }
    newline();
    info({ message: "To remove an existing installation, run:" });
    for (const ancestorPath of ancestorInstallations) {
      info({
        message: `  cd ${ancestorPath} && nori-ai uninstall`,
      });
    }
    newline();
  }

  // Create ~/.nori/profiles/ directory
  const profilesDir = getNoriProfilesDir({ installDir: normalizedInstallDir });
  if (!(await directoryExists(profilesDir))) {
    await fs.mkdir(profilesDir, { recursive: true });
  }

  // Load existing config (if any)
  const existingConfig = await loadConfig({ installDir: normalizedInstallDir });
  const currentVersion = getCurrentPackageVersion();

  // Track captured profile name for setting in config
  let capturedProfileName: string | null = null;

  // If no existing config, check for existing Claude Code configuration to capture
  if (existingConfig == null) {
    const detectedConfig = await detectExistingConfig({
      installDir: normalizedInstallDir,
    });
    if (detectedConfig != null) {
      if (nonInteractive) {
        // Non-interactive mode: auto-capture as "my-profile"
        capturedProfileName = "my-profile";
        await captureExistingConfigAsProfile({
          installDir: normalizedInstallDir,
          profileName: capturedProfileName,
        });
        success({
          message: `✓ Configuration saved as profile "${capturedProfileName}"`,
        });
      } else {
        // Interactive mode: require profile name
        capturedProfileName = await promptForExistingConfigCapture({
          existingConfig: detectedConfig,
        });
        await captureExistingConfigAsProfile({
          installDir: normalizedInstallDir,
          profileName: capturedProfileName,
        });
        success({
          message: `✓ Configuration saved as profile "${capturedProfileName}"`,
        });
        newline();
      }
    }
  }

  // Create or update config
  // If existing config, preserve all fields and update version
  // If new config, create minimal structure
  const username = existingConfig?.auth?.username ?? null;
  const password = existingConfig?.auth?.password ?? null;
  const refreshToken = existingConfig?.auth?.refreshToken ?? null;
  const organizationUrl = existingConfig?.auth?.organizationUrl ?? null;
  const sendSessionTranscript = existingConfig?.sendSessionTranscript ?? null;
  const autoupdate = existingConfig?.autoupdate ?? null;
  const registryAuths = existingConfig?.registryAuths ?? null;
  const version = currentVersion ?? null;

  // Set agents - if a profile was captured, set it as the active profile for claude-code
  let agents = existingConfig?.agents ?? {};
  if (capturedProfileName != null) {
    agents = {
      ...agents,
      "claude-code": { profile: { baseProfile: capturedProfileName } },
    };
  }

  // Save config
  await saveConfig({
    username,
    password,
    refreshToken,
    organizationUrl,
    sendSessionTranscript,
    autoupdate,
    registryAuths,
    agents,
    version,
    installDir: normalizedInstallDir,
  });

  // If a profile was captured, install the managed block to CLAUDE.md
  if (capturedProfileName != null) {
    const config: Config = {
      installDir: normalizedInstallDir,
      agents,
    };
    await claudeMdLoader.install({ config });
  }

  if (!nonInteractive) {
    success({ message: "✓ Nori initialized successfully" });
  }
};

/**
 * Register the 'init' command with commander
 *
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerInitCommand = (args: { program: Command }): void => {
  const { program } = args;

  program
    .command("init")
    .description("Initialize Nori configuration and directories")
    .action(async () => {
      // Get global options from parent
      const globalOpts = program.opts();

      await initMain({
        installDir: globalOpts.installDir || null,
        nonInteractive: globalOpts.nonInteractive || null,
      });
    });
};
