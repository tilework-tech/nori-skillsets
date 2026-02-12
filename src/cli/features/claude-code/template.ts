/**
 * Template substitution utility for Claude Code
 * Replaces placeholders with actual paths in content
 */

import * as path from "path";

import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";

/**
 * Substitute template placeholders in content with actual paths
 *
 * Supported placeholders:
 * - {{skills_dir}} - Path to skills directory (~/.claude/skills)
 * - {{profiles_dir}} - Path to profiles directory (~/.nori/profiles)
 * - {{commands_dir}} - Path to commands directory (~/.claude/commands)
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

  // The installDir is the .claude directory, but profiles are in .nori/profiles
  // We need to get the parent directory to compute the nori profiles path
  const parentDir = path.dirname(installDir);
  const profilesDir = getNoriProfilesDir();

  // Use a placeholder to protect escaped variables (wrapped in backticks)
  // e.g., `{{skills_dir}}` should not be substituted
  const ESCAPE_PLACEHOLDER = "\x00ESCAPED_VAR\x00";

  // First, temporarily replace escaped variables (backtick-wrapped) with placeholders
  // Match `{{variable_name}}` where the backticks are literal
  const escapedVars: Array<string> = [];
  const contentWithPlaceholders = content.replace(
    /`(\{\{[^}]+\}\})`/g,
    (_, variable) => {
      escapedVars.push(variable);
      return `${ESCAPE_PLACEHOLDER}${escapedVars.length - 1}${ESCAPE_PLACEHOLDER}`;
    },
  );

  // Now perform the actual substitutions on non-escaped variables
  const substituted = contentWithPlaceholders
    .replace(/\{\{skills_dir\}\}/g, path.join(installDir, "skills"))
    .replace(/\{\{profiles_dir\}\}/g, profilesDir)
    .replace(/\{\{commands_dir\}\}/g, path.join(installDir, "commands"))
    .replace(/\{\{install_dir\}\}/g, parentDir);

  // Restore the escaped variables (keep them as literal text with backticks)
  return substituted.replace(
    new RegExp(`${ESCAPE_PLACEHOLDER}(\\d+)${ESCAPE_PLACEHOLDER}`, "g"),
    (_, index) => `\`${escapedVars[parseInt(index)]}\``,
  );
};
