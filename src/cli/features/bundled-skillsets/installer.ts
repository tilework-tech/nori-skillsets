/**
 * Bundled skillsets installer
 * Copies bundled skills from the package to agent skills directories
 */

import * as fs from "fs/promises";
import * as path from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";

import { substituteTemplatePaths } from "@/cli/features/template.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BUNDLED_SKILLS_DIR = path.join(__dirname, "skills");

/**
 * Get the path to the bundled skills directory.
 * Used by the claudemd loader to include bundled skills in the skills list.
 *
 * @returns Absolute path to the bundled skills directory
 */
export const getBundledSkillsDir = (): string => BUNDLED_SKILLS_DIR;

/**
 * Copy a directory recursively, applying template substitution to markdown files
 *
 * @param args - Copy arguments
 * @param args.commandsDir - Optional installed slash-commands directory
 * @param args.src - Source directory path
 * @param args.dest - Destination directory path
 * @param args.installDir - Installation directory for template substitution
 * @param args.skillsDir - Installed skills directory
 */
const copyDirWithTemplateSubstitution = async (args: {
  commandsDir?: string | null;
  src: string;
  dest: string;
  installDir: string;
  skillsDir: string;
}): Promise<void> => {
  const { src, dest, commandsDir, installDir, skillsDir } = args;

  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirWithTemplateSubstitution({
        commandsDir,
        src: srcPath,
        dest: destPath,
        installDir,
        skillsDir,
      });
    } else if (entry.name.endsWith(".md")) {
      const content = await fs.readFile(srcPath, "utf-8");
      const substituted = substituteTemplatePaths({
        content,
        commandsDir,
        installDir,
        skillsDir,
      });
      await fs.writeFile(destPath, substituted);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
};

/**
 * Copy bundled skills to the agent's skills directory.
 * Bundled skills are only copied if a skill with the same name does not
 * already exist at the destination (skillset-provided skills take precedence).
 *
 * @param args - Function arguments
 * @param args.commandsDir - Optional installed slash-commands directory
 * @param args.destSkillsDir - Destination skills directory (e.g. ~/.claude/skills)
 * @param args.installDir - Agent config directory for template substitution
 */
export const copyBundledSkills = async (args: {
  commandsDir?: string | null;
  destSkillsDir: string;
  installDir: string;
}): Promise<void> => {
  const { commandsDir, destSkillsDir, installDir } = args;

  let entries;
  try {
    entries = await fs.readdir(BUNDLED_SKILLS_DIR, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const destPath = path.join(destSkillsDir, entry.name);

    // Skip if skillset already provides a skill with this name
    try {
      await fs.access(destPath);
      continue;
    } catch {
      // Destination doesn't exist — proceed with copy
    }

    const srcPath = path.join(BUNDLED_SKILLS_DIR, entry.name);
    await copyDirWithTemplateSubstitution({
      commandsDir,
      src: srcPath,
      dest: destPath,
      installDir,
      skillsDir: destSkillsDir,
    });
  }
};
