/**
 * CLI command for installing skills from external GitHub repositories
 *
 * Handles: nori-skillsets external <source> [options]
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import {
  getCommandNames,
  type CliName,
} from "@/cli/commands/cliCommandNames.js";
import { loadConfig, getAgentProfile } from "@/cli/config.js";
import {
  getClaudeSkillsDir,
  getNoriProfilesDir,
} from "@/cli/features/claude-code/paths.js";
import { addSkillToNoriJson } from "@/cli/features/claude-code/profiles/metadata.js";
import { substituteTemplatePaths } from "@/cli/features/claude-code/template.js";
import { error, success, info, newline, warn } from "@/cli/logger.js";
import { getInstallDirs } from "@/utils/path.js";

import type { Command } from "commander";

import { cloneRepo, cleanupClone, GitCloneError } from "./gitClone.js";
import { discoverSkills, type DiscoveredSkill } from "./skillDiscovery.js";
import { parseGitHubSource } from "./sourceParser.js";

const COPY_SKIP_DIRS = new Set([".git", "node_modules", "__pycache__"]);

/**
 * Copy a directory recursively, skipping .git, node_modules, and __pycache__
 * @param args - The function arguments
 * @param args.src - Source directory path
 * @param args.dest - Destination directory path
 */
const copyDirRecursive = async (args: {
  src: string;
  dest: string;
}): Promise<void> => {
  const { src, dest } = args;
  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && COPY_SKIP_DIRS.has(entry.name)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirRecursive({ src: srcPath, dest: destPath });
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
};

/**
 * Apply template substitution to all .md files in a directory recursively
 * @param args - The function arguments
 * @param args.dir - Directory to process
 * @param args.installDir - The .claude directory path for template substitution
 */
const applyTemplateSubstitutionToDir = async (args: {
  dir: string;
  installDir: string;
}): Promise<void> => {
  const { dir, installDir } = args;

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await applyTemplateSubstitutionToDir({ dir: entryPath, installDir });
    } else if (entry.name.endsWith(".md")) {
      const content = await fs.readFile(entryPath, "utf-8");
      const substituted = substituteTemplatePaths({ content, installDir });
      await fs.writeFile(entryPath, substituted);
    }
  }
};

/**
 * Install a single discovered skill to the target directories
 * @param args - The function arguments
 * @param args.skill - The discovered skill to install
 * @param args.skillsDir - Path to the live skills directory
 * @param args.installDir - Root installation directory
 * @param args.profilesDir - Path to the profiles directory
 * @param args.targetSkillset - Skillset name to update manifests for
 * @param args.sourceUrl - Source repository URL for provenance
 * @param args.ref - Branch/tag that was checked out
 * @param args.subpath - Subpath within the repository
 * @param args.cliName - CLI name for user-facing messages
 */
const installSkill = async (args: {
  skill: DiscoveredSkill;
  skillsDir: string;
  installDir: string;
  profilesDir: string;
  targetSkillset: string | null;
  sourceUrl: string;
  ref: string | null;
  subpath: string | null;
  cliName?: CliName | null;
}): Promise<void> => {
  const {
    skill,
    skillsDir,
    installDir,
    profilesDir,
    targetSkillset,
    sourceUrl,
    ref,
    subpath,
  } = args;

  // Sanitize skill name for directory name
  const skillDirName =
    skill.name
      .toLowerCase()
      .replace(/[^a-z0-9._]+/g, "-")
      .replace(/^[.\-]+|[.\-]+$/g, "")
      .substring(0, 255) || "unnamed-skill";

  const targetDir = path.join(skillsDir, skillDirName);

  // Check if skill already exists
  let skillExists = false;
  try {
    await fs.access(targetDir);
    skillExists = true;
    warn({
      message: `Skill "${skill.name}" already exists at ${targetDir}. Overwriting.`,
    });
  } catch {
    // Doesn't exist, proceed
  }

  // Remove existing skill directory if it exists
  if (skillExists) {
    await fs.rm(targetDir, { recursive: true, force: true });
  }

  // Copy skill directory to live location
  await copyDirRecursive({ src: skill.dirPath, dest: targetDir });

  // Write nori.json provenance file inside the skill directory
  const noriJsonData = {
    name: skill.name,
    source: sourceUrl,
    ...(ref != null ? { ref } : {}),
    ...(subpath != null ? { subpath } : {}),
    installedAt: new Date().toISOString(),
  };
  await fs.writeFile(
    path.join(targetDir, "nori.json"),
    JSON.stringify(noriJsonData, null, 2),
  );

  // Persist raw copy to profile's skills directory
  if (targetSkillset != null) {
    const profileSkillDir = path.join(
      profilesDir,
      targetSkillset,
      "skills",
      skillDirName,
    );
    try {
      await fs.rm(profileSkillDir, { recursive: true, force: true });
      await copyDirRecursive({ src: skill.dirPath, dest: profileSkillDir });
      // Also write nori.json to profile copy
      await fs.writeFile(
        path.join(profileSkillDir, "nori.json"),
        JSON.stringify(noriJsonData, null, 2),
      );
    } catch (profileCopyErr) {
      const msg =
        profileCopyErr instanceof Error
          ? profileCopyErr.message
          : String(profileCopyErr);
      info({ message: `Warning: Could not persist skill to profile: ${msg}` });
    }
  }

  // Apply template substitution to .md files in the live copy
  const claudeDir = path.join(installDir, ".claude");
  await applyTemplateSubstitutionToDir({
    dir: targetDir,
    installDir: claudeDir,
  });

  success({ message: `Installed skill "${skill.name}" from GitHub` });
  info({ message: `Installed to: ${targetDir}` });

  // Update skillset manifests
  if (targetSkillset != null) {
    const skillsetDir = path.join(profilesDir, targetSkillset);
    try {
      await addSkillToNoriJson({
        profileDir: skillsetDir,
        skillName: skillDirName,
        version: "*",
      });
    } catch (noriJsonErr) {
      const msg =
        noriJsonErr instanceof Error
          ? noriJsonErr.message
          : String(noriJsonErr);
      info({
        message: `Warning: Could not update nori.json: ${msg}`,
      });
    }
  }
};

/**
 * Download and install skills from an external GitHub repository
 *
 * @param args - The function arguments
 * @param args.source - GitHub URL or shorthand (owner/repo)
 * @param args.cwd - Current working directory
 * @param args.installDir - Optional explicit install directory
 * @param args.skillset - Optional skillset name to add skills to
 * @param args.skill - Optional specific skill name to install
 * @param args.all - Install all discovered skills without prompting
 * @param args.ref - Optional branch/tag to checkout
 * @param args.cliName - CLI name for user-facing messages
 */
export const externalMain = async (args: {
  source: string;
  cwd?: string | null;
  installDir?: string | null;
  skillset?: string | null;
  skill?: string | null;
  all?: boolean | null;
  ref?: string | null;
  cliName?: CliName | null;
}): Promise<void> => {
  const { source, installDir, skillset, skill, all, ref, cliName } = args;
  const cwd = args.cwd ?? process.cwd();
  const commandNames = getCommandNames({ cliName });
  const cliPrefix = cliName ?? "nori-skillsets";

  // 1. Parse source
  const parsed = parseGitHubSource({ source });
  if (parsed == null) {
    error({
      message: `Invalid source: "${source}".\n\nOnly GitHub repositories are supported. Expected formats:\n  - https://github.com/owner/repo\n  - https://github.com/owner/repo/tree/branch/path\n  - owner/repo\n  - owner/repo@skill-name`,
    });
    return;
  }

  // Use --ref flag if provided, otherwise use ref from URL
  const effectiveRef = ref ?? parsed.ref;

  // 2. Resolve install directory
  let targetInstallDir: string;
  if (installDir != null) {
    targetInstallDir = installDir;
  } else {
    const allInstallations = getInstallDirs({ currentDir: cwd });
    if (allInstallations.length === 0) {
      targetInstallDir = os.homedir();
    } else if (allInstallations.length > 1) {
      const installList = allInstallations
        .map((dir, index) => `${index + 1}. ${dir}`)
        .join("\n");
      error({
        message: `Found multiple Nori installations. Cannot determine which one to use.\n\nInstallations found:\n${installList}\n\nPlease use --install-dir to specify the target installation.`,
      });
      return;
    } else {
      targetInstallDir = allInstallations[0];
    }
  }

  // 3. Load config and resolve target skillset
  const config = await loadConfig();
  let targetSkillset: string | null = null;
  const profilesDir = getNoriProfilesDir();

  if (skillset != null) {
    const skillsetDir = path.join(profilesDir, skillset);
    const skillsetClaudeMd = path.join(skillsetDir, "CLAUDE.md");
    try {
      await fs.access(skillsetClaudeMd);
      targetSkillset = skillset;
    } catch {
      error({
        message: `Skillset "${skillset}" not found at: ${skillsetDir}\n\nMake sure the skillset exists and contains a CLAUDE.md file.`,
      });
      return;
    }
  } else if (config != null) {
    const activeProfile = getAgentProfile({
      config,
      agentName: "claude-code",
    });
    if (activeProfile != null) {
      const profileDir = path.join(profilesDir, activeProfile.baseProfile);
      try {
        await fs.access(profileDir);
        targetSkillset = activeProfile.baseProfile;
      } catch {
        // Profile directory doesn't exist - skip manifest update
      }
    }
  }

  const skillsDir = getClaudeSkillsDir({ installDir: targetInstallDir });
  await fs.mkdir(skillsDir, { recursive: true });

  // 4. Clone repository
  let clonedDir: string;
  info({ message: `Cloning ${parsed.url}...` });

  try {
    clonedDir = await cloneRepo({ url: parsed.url, ref: effectiveRef });
  } catch (err) {
    if (err instanceof GitCloneError) {
      error({ message: err.message });
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      error({ message: `Failed to clone repository: ${msg}` });
    }
    return;
  }

  try {
    // 5. Discover skills
    const subpath = parsed.subpath;
    let discovered = await discoverSkills({ basePath: clonedDir, subpath });

    // Apply skill filter from @skill syntax
    if (parsed.skillFilter != null) {
      discovered = discovered.filter(
        (s) => s.name.toLowerCase() === parsed.skillFilter!.toLowerCase(),
      );
      if (discovered.length === 0) {
        error({
          message: `Skill "${parsed.skillFilter}" not found in repository.`,
        });
        return;
      }
    }

    if (discovered.length === 0) {
      error({
        message: `No skills found in ${source}.\n\nA valid skill requires a SKILL.md file with name and description in the YAML frontmatter.`,
      });
      return;
    }

    // 6. Determine which skills to install
    let skillsToInstall: Array<DiscoveredSkill>;

    if (skill != null) {
      // Install specific skill by name
      const matched = discovered.filter(
        (s) => s.name.toLowerCase() === skill.toLowerCase(),
      );
      if (matched.length === 0) {
        const available = discovered.map((s) => `  - ${s.name}`).join("\n");
        error({
          message: `Skill "${skill}" not found. Available skills:\n${available}`,
        });
        return;
      }
      skillsToInstall = matched;
    } else if (all || discovered.length === 1) {
      // Install all (or single skill found)
      skillsToInstall = discovered;
    } else {
      // Multiple skills found, no --skill or --all
      const available = discovered
        .map((s) => `  - ${s.name}: ${s.description}`)
        .join("\n");
      error({
        message: `Found ${discovered.length} skills in ${source}:\n${available}\n\nSpecify which skill to install:\n  ${cliPrefix} ${commandNames.externalSkill} ${source} --skill <name>\n\nOr install all:\n  ${cliPrefix} ${commandNames.externalSkill} ${source} --all`,
      });
      return;
    }

    // Reconstruct source URL for provenance (without .git suffix for display)
    const sourceUrl = parsed.url.replace(/\.git$/, "");

    // 7. Install each skill
    for (const skillToInstall of skillsToInstall) {
      await installSkill({
        skill: skillToInstall,
        skillsDir,
        installDir: targetInstallDir,
        profilesDir,
        targetSkillset,
        sourceUrl,
        ref: effectiveRef,
        subpath,
        cliName,
      });
    }

    newline();
    if (skillsToInstall.length === 1) {
      info({
        message: `Skill "${skillsToInstall[0].name}" is now available in your Claude Code profile.`,
      });
    } else {
      info({
        message: `${skillsToInstall.length} skills are now available in your Claude Code profile.`,
      });
    }

    if (targetSkillset == null) {
      info({
        message: `No active skillset - skills not added to any manifest.`,
      });
    }
  } finally {
    // 8. Always clean up cloned directory
    await cleanupClone({ dir: clonedDir });
  }
};

/**
 * Register the 'external-skill' command with commander
 *
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerExternalSkillCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("external-skill <source>")
    .description("Install skills from an external GitHub repository")
    .option(
      "--skillset <name>",
      "Add skill to the specified skillset's manifest (defaults to active skillset)",
    )
    .option(
      "--skill <name>",
      "Install only the named skill from the repository",
    )
    .option("--all", "Install all discovered skills from the repository")
    .option("--ref <ref>", "Branch or tag to checkout")
    .action(
      async (
        source: string,
        options: {
          skillset?: string;
          skill?: string;
          all?: boolean;
          ref?: string;
        },
      ) => {
        const globalOpts = program.opts();

        await externalMain({
          source,
          installDir: globalOpts.installDir || null,
          skillset: options.skillset || null,
          skill: options.skill || null,
          all: options.all || null,
          ref: options.ref || null,
        });
      },
    );
};
