/**
 * Shared skills loader
 * Installs skill configuration files to the agent's skills directory
 */

import * as fs from "fs/promises";
import * as path from "path";

import { type Config } from "@/cli/config.js";
import { copyBundledSkills } from "@/cli/features/bundled-skillsets/installer.js";
import {
  getAgentDir,
  getSkillsDir,
} from "@/cli/features/shared/agentHandlers.js";
import { substituteTemplatePaths } from "@/cli/features/template.js";

import type { AgentConfig } from "@/cli/features/agentRegistry.js";
import type { Skillset } from "@/cli/features/skillset.js";
import type { Dirent } from "fs";

/**
 * Copy a directory recursively, applying template substitution to markdown files
 * @param args - Function arguments
 * @param args.src - Source directory path
 * @param args.dest - Destination directory path
 * @param args.installDir - The installation directory for template substitution
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
 * Install skills from a skillset to the agent's skills directory
 * @param args - Function arguments
 * @param args.agentConfig - The agent configuration
 * @param args.config - The Nori configuration
 * @param args.skillset - The parsed skillset
 */
export const installSkills = async (args: {
  agentConfig: AgentConfig;
  config: Config;
  skillset: Skillset;
}): Promise<void> => {
  const { agentConfig, config, skillset } = args;

  const configDir = skillset.skillsDir;
  const agentDirPath = getAgentDir({
    agentConfig,
    installDir: config.installDir,
  });
  const skillsDirPath = getSkillsDir({
    agentConfig,
    installDir: config.installDir,
  });

  // Remove existing skills directory if it exists
  await fs.rm(skillsDirPath, { recursive: true, force: true });

  // Create skills directory
  await fs.mkdir(skillsDirPath, { recursive: true });

  // Install inline skills from skillset's skills/ folder
  if (configDir != null) {
    let entries: Array<Dirent>;
    try {
      entries = await fs.readdir(configDir, { withFileTypes: true });

      for (const entry of entries) {
        const sourcePath = path.join(configDir, entry.name);

        if (!entry.isDirectory()) {
          const destPath = path.join(skillsDirPath, entry.name);
          if (entry.name.endsWith(".md")) {
            const content = await fs.readFile(sourcePath, "utf-8");
            const substituted = substituteTemplatePaths({
              content,
              installDir: agentDirPath,
            });
            await fs.writeFile(destPath, substituted);
          } else {
            await fs.copyFile(sourcePath, destPath);
          }
          continue;
        }

        const destPath = path.join(skillsDirPath, entry.name);
        await copyDirWithTemplateSubstitution({
          src: sourcePath,
          dest: destPath,
          installDir: agentDirPath,
        });
      }
    } catch {
      // Skillset skills directory not found — continue silently
    }
  }

  // Copy bundled skills (skips any already provided by the skillset)
  await copyBundledSkills({
    destSkillsDir: skillsDirPath,
    installDir: agentDirPath,
  });
};
