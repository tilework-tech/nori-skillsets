/**
 * Postinstall version sync.
 *
 * Refreshes ~/.nori-config.json's `version` field to match the on-disk
 * package.json after `npm install -g nori-skillsets@latest`. Without this,
 * the cached config version stays stuck at whatever value was written the
 * last time `nori init` or `nori install` ran, and the statusline ends up
 * nagging users to upgrade a package that's already current.
 *
 * Runs as:
 * - npm postinstall script (automatic on package upgrade)
 */

import { dirname } from "path";
import { fileURLToPath } from "url";

import { loadConfig, updateConfig } from "@/cli/config.js";
import { getCurrentPackageVersion } from "@/cli/version.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Sync the installed package version into ~/.nori-config.json.
 *
 * Best-effort: silently no-ops if the config file doesn't exist, the package
 * version can't be detected, or the config file is malformed. Never throws.
 *
 * @param args - Optional configuration arguments
 * @param args.startDir - Directory to start the package.json walk from
 *   (defaults to this module's directory)
 */
export const syncInstalledVersion = async (args?: {
  startDir?: string | null;
}): Promise<void> => {
  const startDir = args?.startDir ?? __dirname;

  const currentVersion = getCurrentPackageVersion({ startDir });
  if (currentVersion == null) {
    return;
  }

  const existing = await loadConfig();
  if (existing == null) {
    return;
  }

  if (existing.version === currentVersion) {
    return;
  }

  await updateConfig({ version: currentVersion });
};

const isDirectExecution =
  process.argv[1] != null &&
  (process.argv[1].endsWith("syncInstalledVersion.js") ||
    process.argv[1].endsWith("syncInstalledVersion.ts"));

if (isDirectExecution) {
  syncInstalledVersion().catch(() => {
    process.exit(0);
  });
}
