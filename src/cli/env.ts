/**
 * Environment paths and constants for CLI
 * Contains only CLI-level concerns. Agent-specific paths are in their respective feature directories.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Find the package root by walking up from the current directory
 * looking for package.json with name "nori-ai"
 *
 * @param args - Configuration arguments
 * @param args.startDir - Directory to start searching from
 *
 * @throws Error if package root cannot be found within maxDepth directories
 *
 * @returns The path to the package root directory
 */
const findPackageRoot = (args: { startDir: string }): string => {
  const { startDir } = args;
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;
  const maxDepth = 10;
  let depth = 0;

  while (currentDir !== root && depth < maxDepth) {
    const packageJsonPath = path.join(currentDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        if (pkg.name === "nori-ai") {
          return currentDir;
        }
      } catch {
        // Invalid JSON, continue searching
      }
    }
    currentDir = path.dirname(currentDir);
    depth++;
  }

  // This should never happen in normal operation
  throw new Error(
    `Could not find nori-ai package root starting from ${startDir}. ` +
      `Searched ${depth} directories.`,
  );
};

/**
 * CLI root directory (where package.json is located)
 */
export const CLI_ROOT = findPackageRoot({ startDir: __dirname });
