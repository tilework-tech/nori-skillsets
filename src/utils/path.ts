/**
 * Path utility functions for configurable installation directories
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Type of Nori installation
 * - "source": Has config file (.nori-config.json) but no managed CLAUDE.md block
 * - "managed": Has managed CLAUDE.md block but no config file
 * - "both": Has both config file and managed CLAUDE.md block
 */
export type InstallationType = "source" | "managed" | "both";

/**
 * Information about a Nori installation
 */
export type InstallationInfo = {
  path: string;
  type: InstallationType;
};

/**
 * Normalize an installation directory path
 * @param args - Configuration arguments
 * @param args.installDir - The installation directory (optional)
 *
 * @returns Absolute path to the base installation directory
 */
export const normalizeInstallDir = (args: {
  installDir?: string | null;
}): string => {
  const { installDir } = args;

  // Use home directory if no installDir provided or empty
  if (installDir == null || installDir === "") {
    return os.homedir();
  }

  let normalizedPath = installDir;

  // Expand tilde to home directory
  if (normalizedPath.startsWith("~/")) {
    normalizedPath = path.join(os.homedir(), normalizedPath.slice(2));
  } else if (normalizedPath === "~") {
    normalizedPath = os.homedir();
  }

  // Resolve relative paths to absolute
  if (!path.isAbsolute(normalizedPath)) {
    normalizedPath = path.join(process.cwd(), normalizedPath);
  }

  // Normalize the path (resolves . and .., normalizes multiple slashes)
  normalizedPath = path.normalize(normalizedPath);

  // Remove trailing slash if present (except for root)
  if (normalizedPath.length > 1 && normalizedPath.endsWith("/")) {
    normalizedPath = normalizedPath.slice(0, -1);
  }

  // If path ends with .claude, strip it to get the base directory
  if (path.basename(normalizedPath) === ".claude") {
    return path.dirname(normalizedPath);
  }

  return normalizedPath;
};

/**
 * Get all directories that have Nori installations, starting from current directory
 * Searches current directory first, then ancestors
 * @param args - Configuration arguments
 * @param args.currentDir - The directory to start searching from (defaults to process.cwd())
 *
 * @returns Array of paths to directories with Nori installations, ordered from closest to furthest.
 *   Returns empty array if no installations found.
 */
export const getInstallDirs = (args?: {
  currentDir?: string | null;
}): Array<string> => {
  const currentDir = args?.currentDir || process.cwd();
  const results: Array<string> = [];

  // Inline hasNoriInstallation logic
  const hasCurrentInstallation = (() => {
    // Check for .nori-config.json (new style)
    const newConfigPath = path.join(currentDir, ".nori-config.json");
    if (fs.existsSync(newConfigPath)) {
      return true;
    }

    // Check for nori-config.json (legacy style)
    const legacyConfigPath = path.join(currentDir, "nori-config.json");
    if (fs.existsSync(legacyConfigPath)) {
      return true;
    }

    // Check for .nori-config.json in .nori subdirectory (home directory installations)
    const noriSubdirConfigPath = path.join(
      currentDir,
      ".nori",
      ".nori-config.json",
    );
    if (fs.existsSync(noriSubdirConfigPath)) {
      return true;
    }

    // Check for .claude/CLAUDE.md with NORI-AI MANAGED BLOCK
    const claudeMdPath = path.join(currentDir, ".claude", "CLAUDE.md");
    if (fs.existsSync(claudeMdPath)) {
      try {
        const content = fs.readFileSync(claudeMdPath, "utf-8");
        if (content.includes("NORI-AI MANAGED BLOCK")) {
          return true;
        }
      } catch {
        // Ignore read errors
      }
    }

    return false;
  })();

  if (hasCurrentInstallation) {
    results.push(currentDir);
  }

  // Walk up the directory tree starting from parent
  let checkDir = path.dirname(currentDir);
  let previousDir = "";
  while (checkDir !== previousDir) {
    // Check for Nori installation in this ancestor directory
    const hasAncestorInstallation = (() => {
      // Check for .nori-config.json (new style)
      const newConfigPath = path.join(checkDir, ".nori-config.json");
      if (fs.existsSync(newConfigPath)) {
        return true;
      }

      // Check for nori-config.json (legacy style)
      const legacyConfigPath = path.join(checkDir, "nori-config.json");
      if (fs.existsSync(legacyConfigPath)) {
        return true;
      }

      // Check for .nori-config.json in .nori subdirectory (home directory installations)
      const noriSubdirConfigPath = path.join(
        checkDir,
        ".nori",
        ".nori-config.json",
      );
      if (fs.existsSync(noriSubdirConfigPath)) {
        return true;
      }

      // Check for .claude/CLAUDE.md with NORI-AI MANAGED BLOCK
      const claudeMdPath = path.join(checkDir, ".claude", "CLAUDE.md");
      if (fs.existsSync(claudeMdPath)) {
        try {
          const content = fs.readFileSync(claudeMdPath, "utf-8");
          if (content.includes("NORI-AI MANAGED BLOCK")) {
            return true;
          }
        } catch {
          // Ignore read errors
        }
      }

      return false;
    })();

    if (hasAncestorInstallation) {
      results.push(checkDir);
    }

    previousDir = checkDir;
    checkDir = path.dirname(checkDir);
  }

  return results;
};

/**
 * Check if a directory has a Nori config file (.nori-config.json or legacy nori-config.json)
 * Also checks in .nori subdirectory for home directory installations
 * @param dir - Directory to check
 *
 * @returns true if config file exists
 */
const hasConfigFile = (dir: string): boolean => {
  // Check for .nori-config.json (new style) in directory
  const newConfigPath = path.join(dir, ".nori-config.json");
  if (fs.existsSync(newConfigPath)) {
    return true;
  }

  // Check for nori-config.json (legacy style) in directory
  const legacyConfigPath = path.join(dir, "nori-config.json");
  if (fs.existsSync(legacyConfigPath)) {
    return true;
  }

  // Check for .nori-config.json in .nori subdirectory (home directory installations)
  const noriSubdirConfigPath = path.join(dir, ".nori", ".nori-config.json");
  if (fs.existsSync(noriSubdirConfigPath)) {
    return true;
  }

  return false;
};

/**
 * Check if a directory has a managed CLAUDE.md block
 * @param dir - Directory to check
 *
 * @returns true if .claude/CLAUDE.md exists with NORI-AI MANAGED BLOCK
 */
const hasManagedBlock = (dir: string): boolean => {
  const claudeMdPath = path.join(dir, ".claude", "CLAUDE.md");
  if (fs.existsSync(claudeMdPath)) {
    try {
      const content = fs.readFileSync(claudeMdPath, "utf-8");
      if (content.includes("NORI-AI MANAGED BLOCK")) {
        return true;
      }
    } catch {
      // Ignore read errors
    }
  }

  return false;
};

/**
 * Get all directories that have Nori installations with type information
 * Searches current directory first, then ancestors
 * @param args - Configuration arguments
 * @param args.currentDir - The directory to start searching from (defaults to process.cwd())
 *
 * @returns Array of InstallationInfo objects ordered from closest to furthest.
 *   Returns empty array if no installations found.
 */
export const getInstallDirsWithTypes = (args?: {
  currentDir?: string | null;
}): Array<InstallationInfo> => {
  const currentDir = args?.currentDir || process.cwd();
  const results: Array<InstallationInfo> = [];

  /**
   * Classify a directory's installation type
   *
   * @param dir - Directory path to classify
   *
   * @returns InstallationInfo if installation found, null otherwise
   */
  const classifyDir = (dir: string): InstallationInfo | null => {
    const hasConfig = hasConfigFile(dir);
    const hasManaged = hasManagedBlock(dir);

    if (hasConfig && hasManaged) {
      return { path: dir, type: "both" };
    } else if (hasConfig) {
      return { path: dir, type: "source" };
    } else if (hasManaged) {
      return { path: dir, type: "managed" };
    }

    return null;
  };

  // Check current directory
  const currentInstallation = classifyDir(currentDir);
  if (currentInstallation) {
    results.push(currentInstallation);
  }

  // Walk up the directory tree starting from parent
  let checkDir = path.dirname(currentDir);
  let previousDir = "";
  while (checkDir !== previousDir) {
    const ancestorInstallation = classifyDir(checkDir);
    if (ancestorInstallation) {
      results.push(ancestorInstallation);
    }

    previousDir = checkDir;
    checkDir = path.dirname(checkDir);
  }

  return results;
};
