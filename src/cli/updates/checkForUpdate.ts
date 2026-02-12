/**
 * Update check orchestrator
 *
 * Main entry point for the auto-update check. Coordinates
 * version checking, prompt display, and update execution.
 */

import { execFileSync } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { readInstallState } from "@/cli/installTracking.js";
import { error } from "@/cli/logger.js";
import {
  getAvailableUpdate,
  refreshVersionCache,
} from "@/cli/updates/npmRegistryCheck.js";
import { dismissVersion } from "@/cli/updates/versionCache.js";

import { getUpdateCommand, showUpdatePrompt } from "./updatePrompt.js";

/**
 * Try to read the autoupdate setting from the nearest .nori-config.json
 *
 * @returns The autoupdate setting, or null if not found
 */
const loadAutoupdateSetting = async (): Promise<
  "enabled" | "disabled" | null
> => {
  const candidates = [
    path.join(os.homedir(), ".claude", ".nori-config.json"),
    path.join(process.cwd(), ".nori-config.json"),
  ];

  for (const configPath of candidates) {
    try {
      const content = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(content);
      if (config.autoupdate === "enabled" || config.autoupdate === "disabled") {
        return config.autoupdate;
      }
    } catch {
      continue;
    }
  }

  return null;
};

/**
 * Detect the package manager used to install nori-skillsets.
 * Reads the persisted install state first (available even outside npm scripts),
 * falls back to npm_config_user_agent env var, defaults to npm.
 *
 * @returns The detected package manager name
 */
const detectInstallSource = async (): Promise<string> => {
  // Read persisted install state (written during npm install)
  const state = await readInstallState();
  if (state?.install_source != null && state.install_source !== "") {
    return state.install_source;
  }

  // Fallback: env var is available when running via npm scripts
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.includes("bun")) return "bun";
  if (userAgent.includes("pnpm")) return "pnpm";
  if (userAgent.includes("yarn")) return "yarn";
  if (userAgent.includes("npm")) return "npm";

  // Default to npm rather than "unknown" - it's the most common case
  return "npm";
};

/**
 * Check for available updates and prompt the user if one exists.
 * This is the main entry point called from the CLI startup.
 *
 * @param args - Arguments
 * @param args.currentVersion - The currently running version
 * @param args.isInteractive - Whether we're in interactive mode
 * @param args.isSilent - Whether silent mode is on
 * @param args.autoupdate - The autoupdate config setting
 */
export const checkForUpdateAndPrompt = async (args: {
  currentVersion: string;
  isInteractive: boolean;
  isSilent: boolean;
  autoupdate?: "enabled" | "disabled" | null;
}): Promise<void> => {
  const { currentVersion, isInteractive, isSilent } = args;

  try {
    // Load autoupdate setting from config if not provided
    const autoupdate = args.autoupdate ?? (await loadAutoupdateSetting());

    // Early exits
    if (autoupdate === "disabled") return;
    if (isSilent) return;

    // Fire-and-forget background refresh
    void refreshVersionCache();

    // Check for available update using cached data
    const update = await getAvailableUpdate({ currentVersion });
    if (update == null) return;

    const installSource = await detectInstallSource();
    const updateCommand = getUpdateCommand({ installSource });

    const choice = await showUpdatePrompt({
      currentVersion,
      latestVersion: update.latestVersion,
      isInteractive,
      updateCommand,
    });

    if (choice === "update") {
      if (updateCommand == null) {
        process.stderr.write(
          `\nCould not detect package manager. Please update manually:\n  npm install -g nori-skillsets@latest\n\n`,
        );
        return;
      }

      process.stderr.write(`\nUpdating nori-skillsets...\n`);
      try {
        execFileSync(updateCommand.command, updateCommand.args, {
          stdio: "inherit",
        });
        process.stderr.write(
          `\nUpdate complete! Please re-run your command.\n`,
        );
        process.exit(0);
      } catch {
        process.stderr.write(
          `\nUpdate failed. Try manually: ${updateCommand.displayCommand}\n`,
        );
      }
    } else if (choice === "dismiss") {
      await dismissVersion({ version: update.latestVersion });
    }
  } catch (err) {
    // Silent failure - never disrupt CLI operation
    error({
      message: `Update check failed (non-fatal): ${err}`,
    });
  }
};
