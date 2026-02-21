#!/usr/bin/env node

/**
 * Hook handler for checking update availability at session start
 *
 * This script is called by Claude Code SessionStart hook.
 * It reads the version cache and outputs a systemMessage
 * if an update is available.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { debug } from "@/cli/logger.js";
import {
  getAvailableUpdate,
  refreshVersionCache,
} from "@/cli/updates/npmRegistryCheck.js";
import { isCacheStale, readVersionCache } from "@/cli/updates/versionCache.js";
import { getHomeDir } from "@/utils/home.js";

/**
 * Output hook result with systemMessage
 * @param args - Configuration arguments
 * @param args.message - Message to output to the Claude session
 */
const logToClaudeSession = (args: { message: string }): void => {
  const { message } = args;
  const output = { systemMessage: message };
  console.log(JSON.stringify(output));
};

/**
 * Get the install directory. Config is always at ~/.nori-config.json.
 * @param args - Optional configuration arguments
 * @param args.installDir - Explicit install directory override
 *
 * @returns The install directory path
 */
const getInstallDir = (args?: { installDir?: string | null }): string => {
  const explicitDir = args?.installDir;
  if (explicitDir != null) return explicitDir;
  return getHomeDir();
};

/**
 * Read the installed version and autoupdate setting from .nori-config.json
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory to read config from
 *
 * @returns Config object with version and autoupdate, or null if not found
 */
const readConfig = async (args: {
  installDir: string;
}): Promise<{
  version: string | null;
  autoupdate: string | null;
} | null> => {
  const { installDir } = args;

  const configPath = path.join(installDir, ".nori-config.json");
  try {
    const content = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(content);
    return {
      version: config.version ?? null,
      autoupdate: config.autoupdate ?? null,
    };
  } catch {
    return null;
  }
};

/**
 * Main entry point for the update check hook.
 * @param args - Optional configuration arguments
 * @param args.installDir - Explicit install directory override
 */
export const main = async (args?: {
  installDir?: string | null;
}): Promise<void> => {
  try {
    // Get install directory
    const installDir = getInstallDir({
      installDir: args?.installDir,
    });

    // Read config to get installed version and autoupdate setting
    const config = await readConfig({ installDir });
    if (config == null) return;
    if (config.version == null) return;
    if (config.autoupdate === "disabled") return;

    // Trigger background refresh if cache is stale
    const cache = await readVersionCache();
    if (isCacheStale({ cache })) {
      void refreshVersionCache();
    }

    // Use shared update logic (checks cache, semver, dismissed, prerelease)
    const update = await getAvailableUpdate({
      currentVersion: config.version,
    });
    if (update == null) return;

    // Output system message
    let message = `🍙 **Nori Skillsets Update Available**\n\n`;
    message += `Current: ${config.version} → Latest: ${update.latestVersion}\n\n`;
    message += `Run in your terminal: \`npm install -g nori-skillsets@latest\``;

    logToClaudeSession({ message });
  } catch (err) {
    // Silent failure - don't interrupt session startup
    debug({
      message: `Update check hook: Error (non-fatal): ${err}`,
    });
  }
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    debug({
      message: `Update check hook: Unhandled error (non-fatal): ${err}`,
    });
    process.exit(0); // Always exit 0 to not disrupt session
  });
}
