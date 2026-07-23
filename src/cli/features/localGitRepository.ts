import * as fs from "fs/promises";
import { execFileSync } from "node:child_process";
import * as path from "path";

const NORI_GITIGNORE_ENTRIES = [
  ".nori-version",
  ".nori-managed",
  ".nori/",
  ".nori-config.json",
  ".nori-installed-version",
] as const;

const GIT_ROUTING_ENVIRONMENT_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_INDEX_FILE",
] as const;

export const localGitEnvironment = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const variable of GIT_ROUTING_ENVIRONMENT_VARIABLES) {
    delete env[variable];
  }
  return env;
};

export const ensureNoriGitignore = async (args: {
  dir: string;
}): Promise<void> => {
  const gitignorePath = path.join(args.dir, ".gitignore");
  let existing = "";
  try {
    existing = await fs.readFile(gitignorePath, "utf8");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      throw error;
    }
  }

  const existingEntries = new Set(existing.split(/\r?\n/));
  const missingEntries = NORI_GITIGNORE_ENTRIES.filter(
    (entry) => !existingEntries.has(entry),
  );
  if (missingEntries.length === 0) {
    return;
  }

  const prefix =
    existing.length === 0
      ? "# Nori-local state\n"
      : `${existing.endsWith("\n") ? "" : "\n"}\n# Nori-local state\n`;
  await fs.writeFile(
    gitignorePath,
    `${existing}${prefix}${missingEntries.join("\n")}\n`,
  );
};

export const initializeGitRepository = (args: { dir: string }): void => {
  const { dir } = args;
  try {
    execFileSync("git", ["init", "--quiet", "--template="], {
      cwd: dir,
      env: localGitEnvironment(),
      stdio: "pipe",
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new Error("Git is not installed or is not available on PATH");
    }

    const stderr =
      error instanceof Error && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr ?? "").trim()
        : "";
    const detail =
      stderr || (error instanceof Error ? error.message : String(error));
    throw new Error(`Failed to initialize Git repository: ${detail}`);
  }
};
