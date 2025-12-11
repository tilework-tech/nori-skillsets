/**
 * Version file loader
 * Manages the .nori-installed-version file lifecycle
 */

import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { readFileSync } from "fs";
import { dirname, join } from "path";

import { CLI_ROOT } from "@/cli/env.js";
import { info, success } from "@/cli/logger.js";

import type { Config } from "@/cli/config.js";
import type { Loader } from "@/cli/features/agentRegistry.js";

/**
 * Get the current package version by reading package.json
 * @returns The current package version or null if not found
 */
const getCurrentPackageVersion = (): string | null => {
  try {
    const packageJsonPath = join(CLI_ROOT, "package.json");
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    // Verify it's the nori-ai package
    if (pkg.name === "nori-ai") {
      return pkg.version;
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Install version file - save current package version
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const installVersion = async (args: { config: Config }): Promise<void> => {
  const { config } = args;

  const currentVersion = getCurrentPackageVersion();
  if (currentVersion == null) {
    info({
      message: "Could not determine package version, skipping version file",
    });
    return;
  }

  // Inline saveInstalledVersion logic
  const versionFilePath = join(config.installDir, ".nori-installed-version");

  // Ensure the directory exists
  const dir = dirname(versionFilePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(versionFilePath, currentVersion, "utf-8");

  success({
    message: `✓ Version file created: ${versionFilePath}`,
  });
};

/**
 * Uninstall version file - remove it
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const uninstallVersion = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  const versionFile = join(config.installDir, ".nori-installed-version");

  if (existsSync(versionFile)) {
    unlinkSync(versionFile);
    success({ message: `✓ Version file removed: ${versionFile}` });
  } else {
    info({ message: "Version file not found (may not exist)" });
  }
};

/**
 * Version loader
 */
export const versionLoader: Loader = {
  name: "version",
  description: "Manage .nori-installed-version file",
  run: installVersion,
  uninstall: uninstallVersion,
};
