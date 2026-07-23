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

const hasManifest = async (args: { skillsetDir: string }): Promise<boolean> => {
  try {
    await fs.access(path.join(args.skillsetDir, MANIFEST_FILE));
    return true;
  } catch {
    return false;
  }
};

const isGitEntry = async (args: { entryPath: string }): Promise<boolean> => {
  const { entryPath } = args;
  if (path.basename(entryPath) === ".git") {
    return true;
  }

  const [entryRealPath, gitRealPath] = await Promise.all([
    fs.realpath(entryPath).catch(() => null),
    fs.realpath(path.join(path.dirname(entryPath), ".git")).catch(() => null),
  ]);
  return entryRealPath != null && entryRealPath === gitRealPath;
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

const copyCanonicalContent = async (args: {
  sourceDir: string;
  destDir: string;
}): Promise<void> => {
  const { sourceDir, destDir } = args;
  const entries = await fs.readdir(sourceDir);
  const copyEntry = async (entry: string): Promise<void> => {
    await fs.cp(path.join(sourceDir, entry), path.join(destDir, entry), {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: async (source) => {
        const relativePath = path.relative(sourceDir, source);
        const segments = relativePath.split(path.sep);
        if (await isGitEntry({ entryPath: source })) {
          if (segments.length === 1) {
            return false;
          }
          throw new Error(
            "Skillsets containing nested Git repositories or submodules cannot be forked",
          );
        }
        if (segments.some((segment) => EXCLUDED_PATH_SEGMENTS.has(segment))) {
          return false;
        }
        if (
          segments.length === 1 &&
          TOP_LEVEL_GENERATED_FILES.has(segments[0]!)
        ) {
          return false;
        }

        const stat = await fs.lstat(source);
        if (stat.isSymbolicLink()) {
          throw new Error(
            "Skillsets containing symbolic links cannot be forked",
          );
        }
        if (
          segments.length === 1 &&
          stat.isDirectory() &&
          (await fs
            .access(path.join(source, ".nori-managed"))
            .then(() => true)
            .catch(() => false))
        ) {
          return false;
        }
        return true;
      },
    });
  };
  for (const entry of entries) {
    await copyEntry(entry);
  }
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
    value: args.newSkillset,
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

  // Create parent directory if needed (for namespaced profiles like org/name)
  const parentDir = path.dirname(destPath);
  await fs.mkdir(parentDir, { recursive: true });

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
