/**
 * Shared skills loader
 * Replaces both claude-code and cursor-agent skills loaders
 */

import * as fs from "fs/promises";
import * as path from "path";

import { copyBundledSkills } from "@/cli/features/bundled-skillsets/installer.js";
import { substituteTemplatePaths } from "@/cli/features/template.js";

import type { AgentLoader } from "@/cli/features/agentRegistry.js";

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

export const skillsLoader: AgentLoader = {
  name: "skills",
  description: "Install skill configuration files",
  managedDirs: ["skills"],
  run: async ({ agent, config, skillset }) => {
    if (skillset == null) {
      return;
    }

    const configDir = skillset.skillsDir;
    const agentDir = agent.getAgentDir({ installDir: config.installDir });
    const destSkillsDir = agent.getSkillsDir({ installDir: config.installDir });

    // Remove existing skills directory if it exists
    await fs.rm(destSkillsDir, { recursive: true, force: true });

    // Create skills directory
    await fs.mkdir(destSkillsDir, { recursive: true });

    // Install inline skills from skillset's skills/ folder
    if (configDir != null) {
      try {
        const entries = await fs.readdir(configDir, { withFileTypes: true });

        for (const entry of entries) {
          const sourcePath = path.join(configDir, entry.name);

          if (!entry.isDirectory()) {
            const destPath = path.join(destSkillsDir, entry.name);
            if (entry.name.endsWith(".md")) {
              const content = await fs.readFile(sourcePath, "utf-8");
              const substituted = substituteTemplatePaths({
                content,
                installDir: agentDir,
              });
              await fs.writeFile(destPath, substituted);
            } else {
              await fs.copyFile(sourcePath, destPath);
            }
            continue;
          }

          const destPath = path.join(destSkillsDir, entry.name);
          await copyDirWithTemplateSubstitution({
            src: sourcePath,
            dest: destPath,
            installDir: agentDir,
          });
        }
      } catch {
        // Profile skills directory not found - continue silently
      }
    }

    // Copy bundled skills (skips any already provided by the skillset)
    await copyBundledSkills({
      destSkillsDir,
      installDir: agentDir,
    });
  },
};
