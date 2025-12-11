/**
 * Template substitution utility for Claude Code
 * Replaces placeholders with actual paths in content
 */

import * as path from "path";

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
 * @param args.installDir - The .claude directory path
 *
 * @returns Content with placeholders replaced
 */
export const substituteTemplatePaths = (args: {
  content: string;
  installDir: string;
}): string => {
  const { content, installDir } = args;

  return content
    .replace(/\{\{skills_dir\}\}/g, path.join(installDir, "skills"))
    .replace(/\{\{profiles_dir\}\}/g, path.join(installDir, "profiles"))
    .replace(/\{\{commands_dir\}\}/g, path.join(installDir, "commands"))
    .replace(/\{\{install_dir\}\}/g, path.dirname(installDir));
};
