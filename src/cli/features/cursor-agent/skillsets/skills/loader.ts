/**
 * Skills feature loader for Cursor
 * Installs skill configuration files to .cursor/skills/
 */

import * as fs from "fs/promises";
import * as path from "path";

import { type Config } from "@/cli/config.js";
import { copyBundledSkills } from "@/cli/features/bundled-skillsets/installer.js";
import {
  getCursorDir,
  getCursorSkillsDir,
} from "@/cli/features/cursor-agent/paths.js";
import { substituteTemplatePaths } from "@/cli/features/template.js";

import type { CursorProfileLoader } from "@/cli/features/cursor-agent/skillsets/skillsetLoaderRegistry.js";
import type { Skillset } from "@/cli/features/skillset.js";
import type { Dirent } from "fs";

/**
 * Copy a directory recursively, applying template substitution to markdown files
 *
 * @param args - Copy arguments
 * @param args.src - Source directory path
 * @param args.dest - Destination directory path
 * @param args.installDir - Installation directory for template substitution
 */
const copyDirWithTemplateSubstitution = async (args: {
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
      const content = await fs.readFile(srcPath, "utf-8");
      const substituted = substituteTemplatePaths({ content, installDir });
      await fs.writeFile(destPath, substituted);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
};

/**
 * Install skills
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 * @param args.skillset - Parsed skillset
 */
const installSkills = async (args: {
  config: Config;
  skillset: Skillset;
}): Promise<void> => {
  const { config, skillset } = args;

  const configDir = skillset.skillsDir;
  const cursorDir = getCursorDir({ installDir: config.installDir });
  const cursorSkillsDir = getCursorSkillsDir({
    installDir: config.installDir,
  });

  // Remove existing skills directory if it exists
  await fs.rm(cursorSkillsDir, { recursive: true, force: true });

  // Create skills directory
  await fs.mkdir(cursorSkillsDir, { recursive: true });

  // Install inline skills from skillset's skills/ folder
  if (configDir != null) {
    let entries: Array<Dirent>;
    try {
      entries = await fs.readdir(configDir, { withFileTypes: true });

      for (const entry of entries) {
        const sourcePath = path.join(configDir, entry.name);

        if (!entry.isDirectory()) {
          const destPath = path.join(cursorSkillsDir, entry.name);
          if (entry.name.endsWith(".md")) {
            const content = await fs.readFile(sourcePath, "utf-8");
            const substituted = substituteTemplatePaths({
              content,
              installDir: cursorDir,
            });
            await fs.writeFile(destPath, substituted);
          } else {
            await fs.copyFile(sourcePath, destPath);
          }
          continue;
        }

        const destPath = path.join(cursorSkillsDir, entry.name);
        await copyDirWithTemplateSubstitution({
          src: sourcePath,
          dest: destPath,
          installDir: cursorDir,
        });
      }
    } catch {
      // Profile skills directory not found - continue silently
    }
  }

  // Copy bundled skills (skips any already provided by the skillset)
  await copyBundledSkills({
    destSkillsDir: cursorSkillsDir,
    installDir: cursorDir,
  });
};

/**
 * Skills feature loader for Cursor
 */
export const skillsLoader: CursorProfileLoader = {
  name: "skills",
  description: "Install skill configuration files for Cursor",
  install: async (args: { config: Config; skillset: Skillset }) => {
    const { config, skillset } = args;
    await installSkills({ config, skillset });
  },
};
