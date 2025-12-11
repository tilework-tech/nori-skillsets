/**
 * Template substitution utility for Cursor Agent
 * Replaces placeholders with actual paths in content
 */

import * as path from "path";

/**
 * Substitute template placeholders in content with actual paths
 *
 * Supported placeholders:
 * - {{rules_dir}} - Path to rules directory
 * - {{profiles_dir}} - Path to profiles directory
 * - {{commands_dir}} - Path to commands directory
 * - {{subagents_dir}} - Path to subagents directory
 * - {{install_dir}} - Path to install root (parent of .cursor)
 *
 * @param args - Arguments object
 * @param args.content - The content with placeholders
 * @param args.installDir - The .cursor directory path
 *
 * @returns Content with placeholders replaced
 */
export const substituteTemplatePaths = (args: {
  content: string;
  installDir: string;
}): string => {
  const { content, installDir } = args;

  return content
    .replace(/\{\{rules_dir\}\}/g, path.join(installDir, "rules"))
    .replace(/\{\{profiles_dir\}\}/g, path.join(installDir, "profiles"))
    .replace(/\{\{commands_dir\}\}/g, path.join(installDir, "commands"))
    .replace(/\{\{subagents_dir\}\}/g, path.join(installDir, "subagents"))
    .replace(/\{\{install_dir\}\}/g, path.dirname(installDir));
};
