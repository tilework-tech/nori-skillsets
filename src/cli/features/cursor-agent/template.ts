/**
 * Template substitution utility for Cursor Agent
 * Replaces placeholders with actual paths in content
 */

import * as fs from "fs/promises";
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

/**
 * Copy a directory recursively, applying template substitution to markdown files
 *
 * @param args - Copy arguments
 * @param args.src - Source directory path
 * @param args.dest - Destination directory path
 * @param args.installDir - Installation directory for template substitution
 */
export const copyDirWithTemplateSubstitution = async (args: {
  src: string;
  dest: string;
  installDir: string;
}): Promise<void> => {
  const { src, dest, installDir } = args;

  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirWithTemplateSubstitution({
        src: srcPath,
        dest: destPath,
        installDir,
      });
    } else if (entry.name.endsWith(".md")) {
      // Apply template substitution to markdown files
      const content = await fs.readFile(srcPath, "utf-8");
      const substituted = substituteTemplatePaths({ content, installDir });
      await fs.writeFile(destPath, substituted);
    } else {
      // Copy other files directly
      await fs.copyFile(srcPath, destPath);
    }
  }
};
