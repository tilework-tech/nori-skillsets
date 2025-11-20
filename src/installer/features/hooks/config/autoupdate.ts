#!/usr/bin/env node

/**
 * Hook handler for auto-updating nori-ai package
 *
 * This script is called by Claude Code SessionStart hook.
 * It checks npm registry for updates and installs them in the background.
 */

import { execSync, spawn } from "child_process";
import { appendFileSync, openSync, closeSync } from "fs";
import { join } from "path";

import { trackEvent } from "@/installer/analytics.js";
import { loadDiskConfig } from "@/installer/config.js";
import { error } from "@/installer/logger.js";
import { getInstalledVersion } from "@/installer/version.js";

const PACKAGE_NAME = "nori-ai";

/**
 * Get the latest version from npm registry
 * @returns The latest version string or null if not found
 */
const getLatestVersion = async (): Promise<string | null> => {
  try {
    const output = execSync(`npm view ${PACKAGE_NAME} version`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output.trim();
  } catch {
    return null;
  }
};

/**
 * Install the latest version in the background
 * @param args - Configuration arguments
 * @param args.version - Version to install
 * @param args.installDir - Custom installation directory (optional)
 */
const installUpdate = (args: {
  version: string;
  installDir?: string | null;
}): void => {
  const { version, installDir } = args;

  // Build command args
  const cmdArgs = [
    `${PACKAGE_NAME}@${version}`,
    "install",
    "--non-interactive",
  ];
  if (installDir != null && installDir !== "") {
    cmdArgs.push("--install-dir", installDir);
  }

  // Log to notifications file (in current working directory to match where config is stored)
  const logPath = join(process.cwd(), ".nori-notifications.log");
  const logHeader = `\n=== Nori Autoupdate: ${new Date().toISOString()} ===\nInstalling v${version}...\nCommand: npx ${cmdArgs.join(" ")}\n`;
  appendFileSync(logPath, logHeader);

  // Use openSync to get file descriptor for spawn stdio
  const logFd = openSync(logPath, "a");

  // Spawn background process with output redirected to log
  // Use npx to install the new version AND run the install script non-interactively
  const child = spawn("npx", cmdArgs, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });

  // Listen for spawn errors
  child.on("error", (err) => {
    appendFileSync(logPath, `\nSpawn error: ${err.message}\n`);
    error({ message: `Autoupdate spawn failed: ${err.message}` });
  });

  // Close file descriptor when process exits to prevent leak
  child.on("exit", () => {
    try {
      closeSync(logFd);
    } catch {
      // Ignore close errors
    }
  });

  child.unref();
};

/**
 * Output hook result with additionalContext
 * @param args - Configuration arguments
 * @param args.message - Message to output
 */
const logToClaudeSession = (args: { message: string }): void => {
  const { message } = args;

  const output = {
    systemMessage: message,
  };

  console.log(JSON.stringify(output));
};

/**
 * Main entry point
 */
const main = async (): Promise<void> => {
  try {
    // Get installed version from file (not build constant) to ensure
    // we retry if previous install failed
    // Use cwd as installDir since hook is called from project directory
    const installDir = process.cwd();
    const installedVersion = getInstalledVersion({ installDir });

    // Load disk config to determine install_type
    const diskConfig = await loadDiskConfig({ installDir });
    const installType = diskConfig?.auth ? "paid" : "free";

    // Check for updates
    const latestVersion = await getLatestVersion();
    const updateAvailable =
      latestVersion != null && installedVersion !== latestVersion;

    // Track session start (fire and forget - non-blocking)
    trackEvent({
      eventName: "nori_session_started",
      eventParams: {
        installed_version: installedVersion,
        update_available: updateAvailable,
        install_type: installType,
      },
    }).catch(() => {
      // Silent failure - never interrupt session startup for analytics
    });

    if (!latestVersion) {
      // Could not determine latest version, skip silently
      return;
    }

    if (installedVersion === latestVersion) {
      // Already on latest version
      return;
    }

    // New version available - install in background
    installUpdate({
      version: latestVersion,
      installDir: diskConfig?.installDir,
    });

    // Notify user via additionalContext
    logToClaudeSession({
      message: `🔄 Nori Profiles update available: v${installedVersion} → v${latestVersion}. Installing in background...`,
    });
  } catch (err) {
    // Silent failure - don't interrupt session startup
    error({
      message: `Nori autoupdate: Error checking for updates (non-fatal): ${err}`,
    });
  }
};

// Export for testing
export { main };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    error({ message: `Nori autoupdate: Unhandled error (non-fatal): ${err}` });
    process.exit(0);
  });
}
