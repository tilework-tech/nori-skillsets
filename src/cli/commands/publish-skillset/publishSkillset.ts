import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import { confirm, isCancel, note } from "@clack/prompts";

import { loadConfig } from "@/cli/config.js";
import { validateGitPackageEntries } from "@/cli/features/gitPackage.js";
import { localGitEnvironment } from "@/cli/features/localGitRepository.js";
import { validateSkillsetName } from "@/cli/prompts/validators.js";
import { resolveUserSkillsetRef } from "@/cli/skillsetResolution.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";
import type { NoriJson, NoriJsonDependencies } from "@/norijson/nori.js";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 60_000;
const SUPPORTED_REMOTE_SCHEMES = new Set([
  "file",
  "git",
  "git+ssh",
  "http",
  "https",
  "ssh",
]);

export type PublishSkillsetArgs = {
  skillset: string;
  remote: string;
  message?: string | null;
  nonInteractive?: boolean | null;
  silent?: boolean | null;
  yes?: boolean | null;
};

const failure = (message: string): CommandStatus => ({
  success: false,
  cancelled: false,
  message,
});

const sanitizeDisplayText = (value: string): string =>
  value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "?");

const sanitizeDiffText = (value: string): string =>
  value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu, "?");

const redactRemote = (remote: string): string => {
  const sanitized = sanitizeDisplayText(remote).replace(
    /^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/iu,
    "$1***@",
  );
  try {
    const url = new URL(sanitized);
    url.username = url.username.length > 0 ? "***" : "";
    url.password = "";
    for (const key of url.searchParams.keys()) {
      url.searchParams.set(key, "***");
    }
    if (url.hash.length > 0) url.hash = "#***";
    return url.toString();
  } catch {
    return sanitized.replace(
      /^([^@/\\\s:]+)@(\[[^\]\s]+\]|[^/\\\s:]+):/u,
      "***@$2:",
    );
  }
};

const sanitizeGitError = (args: {
  error: unknown;
  remote?: string | null;
}): string => {
  const { error, remote } = args;
  const stderr =
    error != null && typeof error === "object" && "stderr" in error
      ? String(error.stderr).trim()
      : "";
  let detail =
    stderr || (error instanceof Error ? error.message : String(error));
  if (remote != null && remote.length > 0) {
    detail = detail.replaceAll(remote, redactRemote(remote));
  }
  return sanitizeDisplayText(detail)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/giu, "$1***@")
    .replace(/([?&][^=&#\s]+)=([^&#\s]+)/giu, "$1=***")
    .replace(/#[^\s]+/gu, "#***");
};

const assertSupportedRemote = (remote: string): void => {
  if (remote.length === 0 || remote.startsWith("-")) {
    throw new Error("A valid Git remote is required");
  }
  if (/^[^:/\\]+::/u.test(remote)) {
    throw new Error("Git remote-helper URLs are not supported");
  }
  const scheme = remote.match(/^([^:/\\]+):\/\//u)?.[1]?.toLowerCase();
  if (scheme != null && !SUPPORTED_REMOTE_SCHEMES.has(scheme)) {
    throw new Error(`Unsupported Git remote scheme "${scheme}"`);
  }
};

const gitEnvironment = (nonInteractive: boolean): NodeJS.ProcessEnv => {
  const env = localGitEnvironment();
  if (nonInteractive) {
    env.GIT_TERMINAL_PROMPT = "0";
    env.GCM_INTERACTIVE = "Never";
    env.GIT_ASKPASS = "true";
    env.SSH_ASKPASS = "true";
    env.SSH_ASKPASS_REQUIRE = "never";
  }
  return env;
};

const runGit = async (args: {
  command: Array<string>;
  cwd: string;
  nonInteractive: boolean;
  remote?: string | null;
}): Promise<string> => {
  try {
    const { stdout } = await execFileAsync("git", args.command, {
      cwd: args.cwd,
      env: gitEnvironment(args.nonInteractive),
      maxBuffer: 10 * 1024 * 1024,
      timeout: GIT_TIMEOUT_MS,
    });
    return stdout.trim();
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new Error("Git is not installed or is not available on PATH");
    }
    throw new Error(sanitizeGitError({ error, remote: args.remote }));
  }
};

type GitRunner = (
  command: Array<string>,
  remote?: string | null,
) => Promise<string>;

type GitIndexSnapshot = {
  contents: Buffer | null;
  path: string;
};

const createGitRunner =
  (args: { dir: string; nonInteractive: boolean }): GitRunner =>
  (command, remote) =>
    runGit({
      command,
      cwd: args.dir,
      nonInteractive: args.nonInteractive,
      remote,
    });

const readGitIndex = async (args: {
  dir: string;
  git: GitRunner;
}): Promise<GitIndexSnapshot> => {
  const gitPath = await args.git(["rev-parse", "--git-path", "index"]);
  const indexPath = path.isAbsolute(gitPath)
    ? gitPath
    : path.resolve(args.dir, gitPath);
  try {
    return { contents: await fs.readFile(indexPath), path: indexPath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { contents: null, path: indexPath };
    }
    throw error;
  }
};

const restoreGitIndex = async (snapshot: GitIndexSnapshot): Promise<void> => {
  if (snapshot.contents == null) {
    await fs.rm(snapshot.path, { force: true });
    return;
  }
  await fs.writeFile(snapshot.path, snapshot.contents);
};

const readHeadTree = async (git: GitRunner): Promise<string | null> => {
  try {
    return await git(["rev-parse", "--verify", "HEAD^{tree}"]);
  } catch (error) {
    try {
      await git(["symbolic-ref", "--quiet", "HEAD"]);
      return null;
    } catch {
      throw error;
    }
  }
};

const dependencyNames = (args: {
  dependencies: NoriJsonDependencies;
  kind: keyof NoriJsonDependencies;
}): Array<string> => {
  const value = args.dependencies[args.kind];
  if (value == null) return [];
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${args.kind} dependency declarations`);
  }
  return Object.keys(value);
};

const validateDependencies = (args: {
  entries: ReadonlySet<string>;
  metadata: NoriJson;
}): void => {
  const dependencies = args.metadata.dependencies;
  if (dependencies == null) return;
  if (typeof dependencies !== "object" || Array.isArray(dependencies)) {
    throw new Error("Invalid dependency declarations in nori.json");
  }

  const slashCommands = dependencyNames({
    dependencies,
    kind: "slashCommands",
  });
  if (slashCommands.length > 0) {
    throw new Error("Slash-command dependencies are unsupported for publish");
  }

  for (const name of dependencyNames({ dependencies, kind: "skills" })) {
    if (validateSkillsetName({ value: name }) != null) {
      throw new Error(`Invalid dependency name "${sanitizeDisplayText(name)}"`);
    }
    if (!args.entries.has(`skills/${name}/SKILL.md`)) {
      throw new Error(
        `Declared skill dependency "${name}" is not materialized`,
      );
    }
  }

  for (const name of dependencyNames({ dependencies, kind: "subagents" })) {
    if (validateSkillsetName({ value: name }) != null) {
      throw new Error(`Invalid dependency name "${sanitizeDisplayText(name)}"`);
    }
    if (
      !args.entries.has(`subagents/${name}/SUBAGENT.md`) &&
      !args.entries.has(`subagents/${name}.md`)
    ) {
      throw new Error(
        `Declared subagent dependency "${name}" is not materialized`,
      );
    }
  }
};

const readAndValidateSnapshot = async (args: {
  git: GitRunner;
  slug: string;
}): Promise<void> => {
  const entries = validateGitPackageEntries({
    output: await args.git(["ls-files", "--stage", "-z"]),
  });

  let metadata: NoriJson;
  try {
    metadata = JSON.parse(await args.git(["show", ":nori.json"])) as NoriJson;
  } catch (error) {
    throw new Error(
      `Invalid skillset manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (metadata.name !== args.slug) {
    throw new Error(
      `Skillset manifest name "${sanitizeDisplayText(String(metadata.name))}" does not match local name "${args.slug}"`,
    );
  }
  if (metadata.type !== "skillset") {
    throw new Error("Invalid skillset manifest: type must be skillset");
  }
  validateDependencies({
    entries: new Set(entries.map((entry) => entry.path)),
    metadata,
  });
};

export const publishSkillsetMain = async (
  args: PublishSkillsetArgs,
): Promise<CommandStatus> => {
  const nonInteractive = args.nonInteractive === true || args.silent === true;
  let originalIndex: GitIndexSnapshot | null = null;
  let commitCreated = false;
  let dir: string | null = null;
  let git: GitRunner | null = null;

  try {
    assertSupportedRemote(args.remote);
    const config = await loadConfig();
    const resolved = await resolveUserSkillsetRef({
      name: args.skillset,
      defaultOrg: config?.defaultOrg,
      nameWasProvided: true,
      warn: !nonInteractive,
    });
    if (resolved == null) {
      return failure(`Skillset "${args.skillset}" was not found`);
    }
    dir = await fs.realpath(resolved.dir);
    git = createGitRunner({ dir, nonInteractive });
    const repositoryRoot = await fs.realpath(
      await git(["rev-parse", "--show-toplevel"]),
    );
    if (repositoryRoot !== dir) {
      return failure("The skillset must be the Git repository root");
    }

    const slug = path.basename(resolved.identity);
    originalIndex = await readGitIndex({ dir, git });
    await git(["add", "-A"]);
    await readAndValidateSnapshot({ git, slug });

    const stagedTree = await git(["write-tree"]);
    const headTree = await readHeadTree(git);
    const hasChanges = stagedTree !== headTree;
    const diff = hasChanges
      ? sanitizeDiffText(
          await git(["diff", "--cached", "--no-ext-diff", "--no-color"]),
        )
      : "No uncommitted changes; the existing HEAD will be published.";
    if (args.silent !== true) {
      note(diff, "Changes to publish");
    }

    if (args.yes !== true) {
      if (nonInteractive) {
        throw new Error(
          "Publishing requires --yes when running non-interactively",
        );
      }
      const approved = await confirm({
        message: `Publish "${slug}" to ${redactRemote(args.remote)}?`,
        initialValue: false,
      });
      if (isCancel(approved) || !approved) {
        await restoreGitIndex(originalIndex);
        return { success: false, cancelled: true, message: "" };
      }
    }

    if (hasChanges) {
      await git([
        "commit",
        "--quiet",
        "-m",
        args.message?.trim() || `Publish ${slug}`,
      ]);
      commitCreated = true;
      if (
        (await git(["rev-parse", "--verify", "HEAD^{tree}"])) !== stagedTree
      ) {
        throw new Error(
          "A commit hook changed the reviewed package; the local commit was kept but was not published",
        );
      }
    } else if (headTree == null) {
      throw new Error("The skillset has no content to publish");
    }

    await git(
      ["push", "--porcelain", args.remote, `HEAD:refs/heads/skillsets/${slug}`],
      args.remote,
    );
    const head = await git(["rev-parse", "HEAD"]);
    return {
      success: true,
      cancelled: false,
      message: `Published ${slug} at ${head}`,
    };
  } catch (error) {
    if (!commitCreated && originalIndex != null && git != null) {
      try {
        await restoreGitIndex(originalIndex);
      } catch {
        return failure(
          `Publishing failed and the original Git index could not be restored: ${sanitizeGitError({ error, remote: args.remote })}`,
        );
      }
    }
    const detail = sanitizeGitError({ error, remote: args.remote });
    return failure(
      commitCreated
        ? `Publishing failed; the new local commit was kept. ${detail}`
        : `Publishing failed: ${detail}`,
    );
  }
};
