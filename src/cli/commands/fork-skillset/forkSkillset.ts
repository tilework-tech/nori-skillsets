/**
 * Fork skillset command
 *
 * Copies an existing skillset to a new name under ~/.nori/profiles/.
 */

import * as fs from "fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "path";

import { log, note } from "@clack/prompts";

import { loadConfig } from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import {
  ensureNoriGitignore,
  initializeGitRepository,
  localGitEnvironment,
} from "@/cli/features/localGitRepository.js";
import { bold } from "@/cli/logger.js";
import { validateNamespacedSkillsetName } from "@/cli/prompts/validators.js";
import {
  namespaceCreateSkillsetName,
  resolveUserSkillsetRef,
} from "@/cli/skillsetResolution.js";
import {
  ensureNoriJson,
  looksLikeSkillset,
  readSkillsetMetadata,
  writeSkillsetMetadata,
} from "@/norijson/nori.js";
import {
  getNoriSkillsetsDir,
  MANIFEST_FILE,
  resolveSkillsetDir,
  skillsetCreateDir,
  skillsetIdentity,
} from "@/norijson/skillset.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";

const execFileAsync = promisify(execFile);

const EXCLUDED_PATH_SEGMENTS = new Set([
  ".nori-version",
  ".nori-managed",
  ".nori",
  ".nori-config.json",
  ".nori-installed-version",
  "node_modules",
  ".venv",
  "__pycache__",
]);

const TOP_LEVEL_GENERATED_FILES = new Set([".mcp.json"]);
const GIT_ENTRY_NAMES = new Set([".git"]);
const NORI_MANAGED_MARKER = ".nori-managed";

type ManagedOutputPlan = {
  rootDir: string;
  files: ReadonlyArray<string>;
  dirs: ReadonlyArray<string>;
  cleanupDirs: ReadonlyArray<string>;
};

const hasManifest = async (args: { skillsetDir: string }): Promise<boolean> => {
  try {
    await fs.access(path.join(args.skillsetDir, MANIFEST_FILE));
    return true;
  } catch {
    return false;
  }
};

const hasFilesystemName = async (args: {
  entryPath: string;
  names: ReadonlySet<string>;
}): Promise<boolean> => {
  const { entryPath, names } = args;
  if (names.has(path.basename(entryPath))) {
    return true;
  }

  const entryRealPath = await fs.realpath(entryPath).catch(() => null);
  if (entryRealPath == null) {
    return false;
  }
  for (const name of names) {
    const namedRealPath = await fs
      .realpath(path.join(path.dirname(entryPath), name))
      .catch(() => null);
    if (namedRealPath === entryRealPath) {
      return true;
    }
  }
  return false;
};

const assertDestinationParentContained = async (args: {
  destPath: string;
}): Promise<void> => {
  const profilesRoot = getNoriSkillsetsDir();
  const parentDir = path.dirname(args.destPath);
  await fs.mkdir(parentDir, { recursive: true });

  const [profilesRootReal, parentDirReal] = await Promise.all([
    fs.realpath(profilesRoot),
    fs.realpath(parentDir),
  ]);
  const relativeParent = path.relative(profilesRootReal, parentDirReal);
  if (
    path.isAbsolute(relativeParent) ||
    relativeParent === ".." ||
    relativeParent.startsWith(`..${path.sep}`)
  ) {
    throw new Error(
      "Fork destination must remain inside the profiles directory",
    );
  }
};

const rejectSubmodules = async (args: { sourceDir: string }): Promise<void> => {
  const { sourceDir } = args;
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "git",
      [
        "-c",
        "core.fsmonitor=false",
        "-C",
        sourceDir,
        "ls-files",
        "--stage",
        "-z",
        "--",
        ".",
      ],
      {
        encoding: "utf8",
        env: localGitEnvironment(),
      },
    ));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return;
    }
    const stderr =
      error instanceof Error && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr ?? "")
        : "";
    if (/not a git repository/i.test(stderr)) {
      return;
    }
    throw error;
  }

  if (
    stdout
      .split("\0")
      .some((entry) => entry.length > 0 && entry.startsWith("160000 "))
  ) {
    throw new Error("Skillsets containing Git submodules cannot be forked");
  }
};

const collectManagedOutputPlan = async (args: {
  sourceDir: string;
  destDir: string;
}): Promise<ManagedOutputPlan> => {
  const { sourceDir, destDir } = args;
  const files = new Set<string>();
  const dirs = new Set<string>();
  const cleanupDirs = new Set<string>();

  for (const agent of AgentRegistry.getInstance().getAll()) {
    const sourceAgentDir = agent.getAgentDir({ installDir: sourceDir });
    const sourceAgentDirStat = await fs.lstat(sourceAgentDir).catch(() => null);
    if (
      sourceAgentDirStat == null ||
      !sourceAgentDirStat.isDirectory() ||
      sourceAgentDirStat.isSymbolicLink()
    ) {
      continue;
    }
    const markerStat = await fs
      .lstat(path.join(sourceAgentDir, NORI_MANAGED_MARKER))
      .catch(() => null);
    if (markerStat == null) {
      continue;
    }
    if (markerStat.isSymbolicLink()) {
      throw new Error("Skillsets containing symbolic links cannot be forked");
    }
    if (!markerStat.isFile()) {
      continue;
    }

    const destAgentDir = agent.getAgentDir({ installDir: destDir });
    cleanupDirs.add(destAgentDir);
    for (const dir of [
      agent.getSkillsDir({ installDir: destDir }),
      agent.getSubagentsDir({ installDir: destDir }),
      agent.getSlashcommandsDir({ installDir: destDir }),
    ]) {
      dirs.add(dir);
      cleanupDirs.add(dir);
    }

    const sourceInstructionsFile = agent.getInstructionsFilePath({
      installDir: sourceDir,
    });
    if (path.dirname(sourceInstructionsFile) !== sourceDir) {
      const destInstructionsFile = agent.getInstructionsFilePath({
        installDir: destDir,
      });
      files.add(destInstructionsFile);
      cleanupDirs.add(path.dirname(destInstructionsFile));
    }
    if (agent.getProjectMcpFile != null) {
      files.add(agent.getProjectMcpFile({ installDir: destDir }));
    }
  }

  return {
    rootDir: destDir,
    files: Array.from(files),
    dirs: Array.from(dirs),
    cleanupDirs: Array.from(cleanupDirs).sort(
      (a, b) => b.split(path.sep).length - a.split(path.sep).length,
    ),
  };
};

const makeCleanupWritable = async (args: {
  plan: ManagedOutputPlan;
}): Promise<Array<{ dir: string; mode: number }>> => {
  const candidates = new Set<string>();
  for (const outputPath of [
    ...args.plan.files.map((file) => path.dirname(file)),
    ...args.plan.dirs,
    ...args.plan.cleanupDirs,
  ]) {
    let dir = outputPath;
    while (dir !== path.dirname(args.plan.rootDir)) {
      const relative = path.relative(args.plan.rootDir, dir);
      if (
        path.isAbsolute(relative) ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`)
      ) {
        break;
      }
      candidates.add(dir);
      if (dir === args.plan.rootDir) {
        break;
      }
      dir = path.dirname(dir);
    }
  }

  const originalModes: Array<{ dir: string; mode: number }> = [];
  for (const dir of candidates) {
    const stat = await fs.lstat(dir).catch(() => null);
    if (stat == null || !stat.isDirectory() || stat.isSymbolicLink()) {
      continue;
    }
    const mode = stat.mode & 0o7777;
    originalModes.push({ dir, mode });
    await fs.chmod(dir, mode | 0o300);
  }
  return originalModes;
};

const removeManagedOutput = async (args: {
  plan: ManagedOutputPlan;
}): Promise<void> => {
  const originalModes = await makeCleanupWritable({ plan: args.plan });
  for (const file of args.plan.files) {
    await fs.rm(file, { force: true });
  }
  for (const dir of args.plan.dirs) {
    const entries = await fs
      .readdir(dir, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      if (!entry.name.startsWith(".")) {
        await fs.rm(path.join(dir, entry.name), {
          recursive: true,
          force: true,
        });
      }
    }
  }
  for (const dir of args.plan.cleanupDirs) {
    await fs.rmdir(dir).catch((error) => {
      if (
        error instanceof Error &&
        "code" in error &&
        ["ENOENT", "ENOTEMPTY", "EEXIST"].includes(
          String((error as NodeJS.ErrnoException).code),
        )
      ) {
        return;
      }
      throw error;
    });
  }
  for (const { dir, mode } of originalModes.reverse()) {
    await fs.chmod(dir, mode).catch((error) => {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return;
      }
      throw error;
    });
  }
};

const makeOwnedTreeRemovable = async (args: { dir: string }): Promise<void> => {
  const stat = await fs.lstat(args.dir).catch(() => null);
  if (stat == null || stat.isSymbolicLink() || !stat.isDirectory()) {
    return;
  }
  await fs.chmod(args.dir, (stat.mode & 0o7777) | 0o700);
  const entries = await fs.readdir(args.dir);
  for (const entry of entries) {
    await makeOwnedTreeRemovable({ dir: path.join(args.dir, entry) });
  }
};

const copyCanonicalContent = async (args: {
  sourceDir: string;
  destDir: string;
}): Promise<void> => {
  const { sourceDir, destDir } = args;
  const managedOutputPlan = await collectManagedOutputPlan({
    sourceDir,
    destDir,
  });
  const entries = await fs.readdir(sourceDir);
  const copyEntry = async (entry: string): Promise<void> => {
    await fs.cp(path.join(sourceDir, entry), path.join(destDir, entry), {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: async (source) => {
        const relativePath = path.relative(sourceDir, source);
        const segments = relativePath.split(path.sep);
        if (
          await hasFilesystemName({
            entryPath: source,
            names: GIT_ENTRY_NAMES,
          })
        ) {
          if (segments.length === 1) {
            return false;
          }
          throw new Error(
            "Skillsets containing nested Git repositories or submodules cannot be forked",
          );
        }
        if (
          await hasFilesystemName({
            entryPath: source,
            names: EXCLUDED_PATH_SEGMENTS,
          })
        ) {
          return false;
        }
        if (
          segments.length === 1 &&
          (await hasFilesystemName({
            entryPath: source,
            names: TOP_LEVEL_GENERATED_FILES,
          }))
        ) {
          return false;
        }

        const stat = await fs.lstat(source);
        if (stat.isSymbolicLink()) {
          throw new Error(
            "Skillsets containing symbolic links cannot be forked",
          );
        }
        return true;
      },
    });
  };
  for (const entry of entries) {
    await copyEntry(entry);
  }
  await removeManagedOutput({ plan: managedOutputPlan });
};

export const forkSkillsetMain = async (args: {
  baseSkillset: string;
  newSkillset: string;
}): Promise<CommandStatus> => {
  const { baseSkillset } = args;
  const config = await loadConfig();

  // The destination is a new skillset: a bare name lands under the default org.
  const newSkillset = namespaceCreateSkillsetName({
    name: args.newSkillset,
    defaultOrg: config?.defaultOrg,
  });

  const validationError = validateNamespacedSkillsetName({
    value: newSkillset,
  });
  if (validationError != null) {
    log.error(validationError);
    return {
      success: false,
      cancelled: false,
      message: validationError,
    };
  }

  // The base is an existing skillset: resolve it across buckets, preferring the
  // default org for a bare name (and warning once on a deprecated bare name).
  const sourcePath = (
    await resolveUserSkillsetRef({
      name: baseSkillset,
      defaultOrg: config?.defaultOrg,
      nameWasProvided: true,
    })
  )?.dir;
  const destPath = skillsetCreateDir({ name: newSkillset });

  const sourceDir =
    sourcePath == null ? null : await fs.realpath(sourcePath).catch(() => null);
  const sourceIsSkillset =
    sourceDir != null &&
    ((await hasManifest({ skillsetDir: sourceDir })) ||
      (await looksLikeSkillset({ skillsetDir: sourceDir })));
  if (sourceDir == null || !sourceIsSkillset) {
    log.error(
      `Skillset '${baseSkillset}' not found. Run 'nori-skillsets list' to see available skillsets.`,
    );
    return {
      success: false,
      cancelled: false,
      message: `Skillset "${baseSkillset}" not found`,
    };
  }

  // Validate destination does not already resolve to an existing skillset
  if ((await resolveSkillsetDir({ name: newSkillset })) != null) {
    log.error(
      `Skillset '${newSkillset}' already exists. Choose a different name.`,
    );
    return {
      success: false,
      cancelled: false,
      message: `Skillset "${newSkillset}" already exists`,
    };
  }

  await assertDestinationParentContained({ destPath });

  await rejectSubmodules({ sourceDir });

  let ownsDestination = false;
  try {
    await fs.mkdir(destPath);
    ownsDestination = true;
    await copyCanonicalContent({ sourceDir, destDir: destPath });

    await ensureNoriJson({ skillsetDir: destPath });
    const metadata = await readSkillsetMetadata({ skillsetDir: destPath });
    metadata.name = path.basename(newSkillset);
    delete metadata.registryURL;
    await writeSkillsetMetadata({ skillsetDir: destPath, metadata });
    await ensureNoriGitignore({ dir: destPath });
    initializeGitRepository({ dir: destPath });
  } catch (error) {
    if (ownsDestination) {
      await makeOwnedTreeRemovable({ dir: destPath }).catch(() => {
        // Best-effort preparation; preserve the original fork error.
      });
      await fs.rm(destPath, { recursive: true, force: true }).catch(() => {
        // Best-effort rollback; preserve the original fork error.
      });
    }
    throw error;
  }

  const relLocation = skillsetIdentity({ dir: destPath });
  const nextSteps = [
    `To switch:  nori-skillsets switch ${relLocation}`,
    `To edit:    ~/.nori/profiles/${relLocation}/`,
  ].join("\n");
  note(nextSteps, "Next Steps");

  return {
    success: true,
    cancelled: false,
    message: `Forked "${bold({ text: baseSkillset })}" to "${bold({ text: newSkillset })}"`,
  };
};
