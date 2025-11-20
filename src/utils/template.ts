/**
 * Template substitution utility functions for configurable installation directories
 */

import * as os from "os";
import * as path from "path";

/**
 * Check if an install directory is the user's home directory
 * @param args - Arguments object
 * @param args.installDir - The installation directory (.claude path)
 *
 * @returns true if the install directory is in the home directory
 */
const isHomeInstall = (args: { installDir: string }): boolean => {
  const { installDir } = args;
  const homeClaudeDir = path.join(os.homedir(), ".claude");
  return installDir === homeClaudeDir;
};

/**
 * Get the parent directory of the .claude directory (the install root)
 * @param args - Arguments object
 * @param args.installDir - The .claude directory path
 *
 * @returns The parent directory path
 */
const getInstallRoot = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.dirname(installDir);
};

/**
 * Format a path within the install directory with appropriate notation
 * Uses tilde notation for home installs, absolute paths for custom installs
 *
 * @param args - Arguments object
 * @param args.installDir - The installation directory (.claude path)
 * @param args.subPath - The sub-path within the .claude directory
 *
 * @returns Formatted path string
 */
export const formatInstallPath = (args: {
  installDir: string;
  subPath: string;
}): string => {
  const { installDir, subPath } = args;

  // Clean the subPath (remove leading slash if present)
  const cleanSubPath = subPath.startsWith("/") ? subPath.slice(1) : subPath;

  if (isHomeInstall({ installDir })) {
    // Use tilde notation for home installs
    if (cleanSubPath === "") {
      return "~/.claude";
    }
    return `~/.claude/${cleanSubPath}`;
  }

  // Use absolute path for custom installs
  if (cleanSubPath === "") {
    return installDir;
  }
  return path.join(installDir, cleanSubPath);
};

/**
 * Substitute template placeholders in content with actual paths
 *
 * Supported placeholders:
 * - {{skills_dir}} - Path to skills directory
 * - {{profiles_dir}} - Path to profiles directory
 * - {{commands_dir}} - Path to commands directory
 * - {{install_dir}} - Path to install root (parent of .claude)
 *
 * @param args - Arguments object
 * @param args.content - The content with placeholders
 * @param args.installDir - The installation directory (.claude path)
 *
 * @returns Content with placeholders replaced
 */
export const substituteTemplatePaths = (args: {
  content: string;
  installDir: string;
}): string => {
  const { content, installDir } = args;

  let result = content;

  // Replace {{skills_dir}}
  const skillsPath = formatInstallPath({ installDir, subPath: "skills" });
  result = result.replace(/\{\{skills_dir\}\}/g, skillsPath);

  // Replace {{profiles_dir}}
  const profilesPath = formatInstallPath({ installDir, subPath: "profiles" });
  result = result.replace(/\{\{profiles_dir\}\}/g, profilesPath);

  // Replace {{commands_dir}}
  const commandsPath = formatInstallPath({ installDir, subPath: "commands" });
  result = result.replace(/\{\{commands_dir\}\}/g, commandsPath);

  // Replace {{install_dir}} - this is the parent of .claude
  const installRoot = getInstallRoot({ installDir });
  const formattedInstallRoot = isHomeInstall({ installDir })
    ? "~"
    : installRoot;
  result = result.replace(/\{\{install_dir\}\}/g, formattedInstallRoot);

  return result;
};
