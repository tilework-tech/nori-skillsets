/**
 * Template substitution utility
 * Agent-agnostic placeholder replacement for skillset content
 */

import * as path from "path";

import { getNoriSkillsetsDir } from "@/norijson/skillset.js";

/**
 * Substitute template placeholders in content with actual paths
 *
 * Supported placeholders:
 * - {{skills_dir}} - Path to the installed skills directory
 * - {{profiles_dir}} - Path to profiles directory (~/.nori/profiles)
 * - {{commands_dir}} - Path to the installed commands directory
 * - {{install_dir}} - Path to install root (parent of agent config dir)
 *
 * @param args - Arguments object
 * @param args.content - The content with placeholders
 * @param args.installDir - The agent config directory path (e.g. .claude dir)
 * @param args.commandsDir - Optional installed commands directory override
 * @param args.skillsDir - Optional installed skills directory override
 *
 * @returns Content with placeholders replaced
 */
export const substituteTemplatePaths = (args: {
  commandsDir?: string | null;
  content: string;
  installDir: string;
  skillsDir?: string | null;
}): string => {
  const { content, installDir, skillsDir, commandsDir } = args;

  // The installDir is the agent config directory, but profiles are in .nori/profiles
  // We need to get the parent directory to compute the nori profiles path
  const parentDir = path.dirname(installDir);
  const skillsetsDir = getNoriSkillsetsDir();
  const resolvedSkillsDir = skillsDir ?? path.join(installDir, "skills");
  const resolvedCommandsDir = commandsDir ?? path.join(installDir, "commands");

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
    .replace(/\{\{skills_dir\}\}/g, resolvedSkillsDir)
    .replace(/\{\{profiles_dir\}\}/g, skillsetsDir)
    .replace(/\{\{commands_dir\}\}/g, resolvedCommandsDir)
    .replace(/\{\{install_dir\}\}/g, parentDir);

  // Restore the escaped variables (keep them as literal text with backticks)
  return substituted.replace(
    new RegExp(`${ESCAPE_PLACEHOLDER}(\\d+)${ESCAPE_PLACEHOLDER}`, "g"),
    (_, index) => `\`${escapedVars[parseInt(index)]}\``,
  );
};
