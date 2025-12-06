#!/usr/bin/env node

/**
 * Hook handler for auto-updating nori-ai package
 *
 * This script is called by Claude Code SessionStart hook.
 * It checks npm registry for updates and installs them in the background.
 */

import { execSync, spawn } from "child_process";
import { appendFileSync, openSync, closeSync, existsSync } from "fs";
import { join } from "path";

import semver from "semver";

import { trackEvent } from "@/cli/analytics.js";
import { loadConfig } from "@/cli/config.js";
import { error } from "@/cli/logger.js";
import { getInstalledVersion } from "@/cli/version.js";
import { getInstallDirs } from "@/utils/path.js";

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

  // Build command args for nori-ai install
  const installArgs = ["install", "--non-interactive"];
  if (installDir != null && installDir !== "") {
    installArgs.push("--install-dir", installDir);
  }

  // Build full shell command: first update global package, then run install
  const fullCommand = `npm install -g ${PACKAGE_NAME}@${version} && nori-ai ${installArgs.join(" ")}`;

  // Log to notifications file in the install directory
  const logDir =
    installDir != null && installDir !== "" ? installDir : process.cwd();
  const logPath = join(logDir, ".nori-notifications.log");
  const logHeader = `\n=== Nori Autoupdate: ${new Date().toISOString()} ===\nInstalling v${version}...\nCommand: ${fullCommand}\n`;
  appendFileSync(logPath, logHeader);

  // Use openSync to get file descriptor for spawn stdio
  const logFd = openSync(logPath, "a");

  // Spawn background process with output redirected to log
  // Use shell to run npm install -g followed by nori-ai install
  const child = spawn("sh", ["-c", fullCommand], {
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
    const cwd = process.cwd();

    // Find Nori installation by searching upward from cwd
    const allInstallations = getInstallDirs({ currentDir: cwd });
    const configDir = allInstallations.length > 0 ? allInstallations[0] : null;

    if (configDir == null) {
      // No config found - log to notifications and exit
      const logPath = join(cwd, ".nori-notifications.log");
      appendFileSync(
        logPath,
        `\n=== Nori Autoupdate Error: ${new Date().toISOString()} ===\n` +
          `Could not find .nori-config.json in current directory or any parent directory.\n` +
          `Searched from: ${cwd}\n`,
      );
      return;
    }

    // Load config from found directory
    const diskConfig = await loadConfig({ installDir: configDir });
    const installType = diskConfig?.auth ? "paid" : "free";

    if (diskConfig?.installDir == null) {
      // Config exists but has no installDir - log error and exit
      const logPath = join(cwd, ".nori-notifications.log");
      appendFileSync(
        logPath,
        `\n=== Nori Autoupdate Error: ${new Date().toISOString()} ===\n` +
          `Config file exists at ${configDir} but has no installDir field.\n`,
      );
      return;
    }

    const installDir = diskConfig.installDir;

    // Validate that installDir exists
    if (!existsSync(installDir)) {
      const logPath = join(cwd, ".nori-notifications.log");
      appendFileSync(
        logPath,
        `\n=== Nori Autoupdate Error: ${new Date().toISOString()} ===\n` +
          `Config specifies installDir: ${installDir} but directory does not exist.\n`,
      );
      return;
    }

    // Get installed version from the actual install directory
    const installedVersion = getInstalledVersion({ installDir });

    // Check for updates
    const latestVersion = await getLatestVersion();
    const updateAvailable =
      latestVersion != null &&
      semver.valid(latestVersion) != null &&
      semver.gt(latestVersion, installedVersion);

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

    if (!updateAvailable) {
      // No update needed (either no latest version found, invalid version,
      // or installed version is already >= latest version)
      return;
    }

    // Check if autoupdate is disabled in config
    if (diskConfig?.autoupdate === "disabled") {
      // Notify user that update is available but autoupdate is disabled
      logToClaudeSession({
        message: `🔔 Nori Profiles v${latestVersion} available (current: v${installedVersion}). Autoupdate is disabled. Run 'npx nori-ai install' to update manually.`,
      });
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
