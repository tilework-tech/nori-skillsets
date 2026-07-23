import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { confirm, isCancel } from "@clack/prompts";

import { getDefaultAgents, loadConfig } from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { noninteractive as activateSkillset } from "@/cli/features/install/install.js";
import { setSilentMode } from "@/cli/logger.js";
import { validateSkillsetName } from "@/cli/prompts/validators.js";
import { readSkillsetMetadata } from "@/norijson/nori.js";
import { getNoriSkillsetsDir } from "@/norijson/skillset.js";
import { resolveInstallDir } from "@/utils/path.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";

const FULL_COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
const HFS_IGNORED_CODE_POINTS =
  /[\u200C-\u200F\u202A-\u202E\u206A-\u206F\uFEFF]/gu;
const SSH_BATCH_MODE_DISABLED = /batchmode(?:\s*=\s*|\s+)["']?no\b/iu;
const SENSITIVE_QUERY_KEYS = new Set([
  "access_token",
  "api_key",
  "client_secret",
  "key",
  "oauth_token",
  "password",
  "private_token",
  "refresh_token",
  "sig",
  "signature",
  "token",
  "x-amz-credential",
  "x-amz-security-token",
  "x-amz-signature",
]);

type GitInstallArgs = {
  slug: string;
  remote: string;
  pin?: string | null;
  installDir?: string | null;
  trustSource?: boolean | null;
  nonInteractive?: boolean | null;
  silent?: boolean | null;
};

const normalizeQueryKey = (args: { key: string }): string => {
  try {
    return decodeURIComponent(args.key).normalize("NFKC").toLowerCase();
  } catch {
    return args.key.normalize("NFKC").toLowerCase();
  }
};

const sanitizeGitText = (value: string): string =>
  value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/giu, "$1***@")
    .replace(
      /([?&;])([^=&#;\s'"]+)=([^&#;\s'"]*)/gu,
      (match, separator: string, key: string) =>
        SENSITIVE_QUERY_KEYS.has(normalizeQueryKey({ key }))
          ? `${separator}${key}=***`
          : match,
    );

const GIT_ROUTING_ENVIRONMENT = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_SHALLOW_FILE",
] as const;

type GitExecutionSettings = {
  disableTerminalPrompts: boolean;
};

const gitEnvironment = (args: {
  settings: GitExecutionSettings;
}): NodeJS.ProcessEnv => {
  const { settings } = args;
  const environment = { ...process.env };
  for (const name of GIT_ROUTING_ENVIRONMENT) delete environment[name];
  if (settings.disableTerminalPrompts) {
    environment.GIT_TERMINAL_PROMPT = "0";
    const sshCommand = environment.GIT_SSH_COMMAND ?? "ssh";
    if (SSH_BATCH_MODE_DISABLED.test(sshCommand)) {
      throw new Error(
        "GIT_SSH_COMMAND must not disable SSH batch mode for unattended installs",
      );
    }
    environment.GIT_SSH_COMMAND = `${sshCommand} -oBatchMode=yes`;
  }
  return environment;
};

type GitExecution = {
  error: unknown;
  exitCode: string | number | null;
  stderr: string;
  stdout: string;
};

const gitErrorDetail = (result: GitExecution): string => {
  const detail =
    result.stderr ||
    (result.error instanceof Error
      ? result.error.message
      : String(result.error));
  return sanitizeGitText(detail);
};

const executeGit = async (args: {
  command: Array<string>;
  cwd?: string;
  input?: string;
  settings: GitExecutionSettings;
}): Promise<GitExecution> => {
  const { command, cwd, input, settings } = args;
  return new Promise((resolve) => {
    let stdinError: Error | null = null;
    const child = execFile(
      "git",
      command,
      {
        cwd,
        env: gitEnvironment({ settings }),
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const executionError = error ?? stdinError;
        const reportedExitCode =
          executionError != null &&
          "code" in executionError &&
          (typeof executionError.code === "string" ||
            typeof executionError.code === "number")
            ? executionError.code
            : null;
        resolve({
          error: executionError,
          exitCode: executionError == null ? 0 : (reportedExitCode ?? 1),
          stderr: String(stderr).trim(),
          stdout: String(stdout).trim(),
        });
      },
    );
    child.stdin?.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "EPIPE") {
        stdinError = error;
      }
    });
    child.stdin?.end(input);
  });
};

const failedGitCommand = (result: GitExecution): Error =>
  new Error(`Git command failed: ${gitErrorDetail(result)}`);

const runGit = async (args: {
  command: Array<string>;
  cwd?: string;
  settings: GitExecutionSettings;
}): Promise<string> => {
  const { command, cwd, settings } = args;
  const result = await executeGit({ command, cwd, settings });
  if (result.exitCode !== 0) throw failedGitCommand(result);
  return result.stdout;
};

const isAncestor = async (args: {
  ancestor: string;
  descendant: string;
  checkoutDir: string;
  settings: GitExecutionSettings;
}): Promise<boolean> => {
  const { ancestor, descendant, checkoutDir, settings } = args;
  const result = await executeGit({
    command: ["merge-base", "--is-ancestor", ancestor, descendant],
    cwd: checkoutDir,
    settings,
  });
  if (result.exitCode === 0) return true;
  if (result.exitCode === 1) return false;
  throw failedGitCommand(result);
};

const resolveRequiredBranchTip = async (args: {
  branch: string;
  checkoutDir: string;
  settings: GitExecutionSettings;
}): Promise<string> => {
  const { branch, checkoutDir, settings } = args;
  const result = await executeGit({
    command: [
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `refs/heads/${branch}`,
    ],
    cwd: checkoutDir,
    settings,
  });
  if (result.exitCode === 0) return result.stdout;
  if (result.exitCode === 1) {
    throw new Error(`Required branch "${branch}" was not found in Git source`);
  }
  throw failedGitCommand(result);
};

const inspectPinnedObject = async (args: {
  checkoutDir: string;
  pin: string;
  settings: GitExecutionSettings;
}): Promise<{ objectType: string; resolvedCommit: string } | null> => {
  const { checkoutDir, pin, settings } = args;
  const result = await executeGit({
    command: ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
    cwd: checkoutDir,
    input: `${pin}\n`,
    settings,
  });
  if (result.exitCode !== 0) throw failedGitCommand(result);
  const [resolvedCommit, objectType, ...extra] = result.stdout.split(" ");
  if (
    objectType === "missing" &&
    resolvedCommit === pin &&
    extra.length === 0
  ) {
    return null;
  }
  if (
    resolvedCommit == null ||
    objectType == null ||
    extra.length > 0 ||
    !FULL_COMMIT_SHA.test(resolvedCommit)
  ) {
    throw new Error("Git returned invalid object inspection output");
  }
  return { objectType, resolvedCommit };
};

const selectPinnedCommit = async (args: {
  branch: string;
  branchTip: string;
  checkoutDir: string;
  pin: string;
  settings: GitExecutionSettings;
}): Promise<string> => {
  const { branch, branchTip, checkoutDir, pin, settings } = args;
  const shallow = await runGit({
    command: ["rev-parse", "--is-shallow-repository"],
    cwd: checkoutDir,
    settings,
  });
  if (shallow === "true") {
    throw new Error(
      "Pinned installs require complete history; the Git source is shallow",
    );
  }

  const inspectedObject = await inspectPinnedObject({
    checkoutDir,
    pin,
    settings,
  });
  if (inspectedObject == null) {
    throw new Error(
      `Pinned commit "${pin}" was not found in ${branch} history`,
    );
  }
  const { objectType, resolvedCommit } = inspectedObject;
  if (resolvedCommit.toLowerCase() !== pin.toLowerCase()) {
    throw new Error(
      "--pin must be a full hexadecimal commit SHA (40 or 64 characters)",
    );
  }
  if (objectType !== "commit") {
    throw new Error(`Pinned object "${pin}" does not identify a commit`);
  }
  if (
    !(await isAncestor({
      ancestor: resolvedCommit,
      descendant: branchTip,
      checkoutDir,
      settings,
    }))
  ) {
    throw new Error(
      `Pinned commit "${pin}" was not found in ${branch} history`,
    );
  }

  await runGit({
    command: ["checkout", "--detach", resolvedCommit],
    cwd: checkoutDir,
    settings,
  });
  return resolvedCommit;
};

type TrackedEntry = {
  mode: string;
  path: string;
};

const normalizeReservedRootPath = (args: { path: string }): string => {
  const [rootEntry = ""] = args.path.split("/");
  return rootEntry
    .normalize("NFKC")
    .replace(HFS_IGNORED_CODE_POINTS, "")
    .toLowerCase();
};

const parseTrackedEntries = (args: { output: string }): Array<TrackedEntry> => {
  const records = args.output.split("\0").filter((record) => record.length > 0);
  return records.map((record) => {
    const match = /^(\d{6}) [0-9a-f]+ \d+\t([\s\S]+)$/u.exec(record);
    if (match == null) {
      throw new Error("Git returned invalid tracked-entry output");
    }
    return { mode: match[1], path: match[2] };
  });
};

const validateCheckout = async (args: {
  checkoutDir: string;
  slug: string;
  settings: GitExecutionSettings;
}): Promise<void> => {
  const { checkoutDir, slug, settings } = args;
  const entries = parseTrackedEntries({
    output: await runGit({
      command: ["ls-files", "--stage", "-z"],
      cwd: checkoutDir,
      settings,
    }),
  });
  if (
    entries.some(
      (entry) =>
        normalizeReservedRootPath({ path: entry.path }) === ".nori-version",
    )
  ) {
    throw new Error(
      "Git-backed skillsets cannot contain Registry provenance (.nori-version)",
    );
  }
  if (entries.some((entry) => entry.mode === "120000")) {
    throw new Error("Git-backed skillsets cannot contain symbolic links");
  }
  if (entries.some((entry) => entry.mode === "160000")) {
    throw new Error("Git-backed skillsets cannot contain submodules");
  }
  const manifestAliases = entries.filter(
    (entry) => normalizeReservedRootPath({ path: entry.path }) === "nori.json",
  );
  const manifest = manifestAliases[0];
  if (
    manifestAliases.length !== 1 ||
    manifest == null ||
    manifest.path !== "nori.json" ||
    (manifest.mode !== "100644" && manifest.mode !== "100755")
  ) {
    throw new Error(
      "Git-backed skillsets require an exact root nori.json regular file",
    );
  }

  let metadata;
  try {
    metadata = await readSkillsetMetadata({ skillsetDir: checkoutDir });
  } catch (error) {
    throw new Error(`Invalid skillset manifest: ${String(error)}`);
  }
  if (metadata.name !== slug) {
    throw new Error(
      `Skillset manifest name "${metadata.name}" does not match requested name "${slug}"`,
    );
  }
  if (metadata.type !== "skillset") {
    throw new Error("Invalid skillset manifest: type must be skillset");
  }
};

const acquireGitCheckout = async (args: {
  branch: string;
  checkoutDir: string;
  pin?: string | null;
  remote: string;
  settings: GitExecutionSettings;
  slug: string;
}): Promise<string | null> => {
  const { branch, checkoutDir, pin, remote, settings, slug } = args;
  const cloneArgs = [
    "clone",
    "--single-branch",
    "--branch",
    branch,
    "--no-reject-shallow",
  ];
  if (pin != null) cloneArgs.push("--no-checkout");
  cloneArgs.push("--", remote, checkoutDir);
  await runGit({ command: cloneArgs, settings });

  const branchTip = await resolveRequiredBranchTip({
    branch,
    checkoutDir,
    settings,
  });
  const resolvedCommit =
    pin == null
      ? null
      : await selectPinnedCommit({
          branch,
          branchTip,
          checkoutDir,
          pin,
          settings,
        });
  await validateCheckout({ checkoutDir, settings, slug });
  return resolvedCommit;
};

export const gitInstallMain = async (
  args: GitInstallArgs,
): Promise<CommandStatus> => {
  const { slug, remote, pin, installDir, trustSource, nonInteractive, silent } =
    args;
  if (silent === true) setSilentMode({ silent: true });

  try {
    const nameError = validateSkillsetName({ value: slug });
    if (nameError != null) throw new Error(nameError);
    if (pin != null && !FULL_COMMIT_SHA.test(pin)) {
      throw new Error(
        "--pin must be a full hexadecimal commit SHA (40 or 64 characters)",
      );
    }

    const branch = `skillsets/${slug}`;
    if (trustSource !== true) {
      if (nonInteractive === true || silent === true) {
        throw new Error(
          "Git installs require --trust-source when running non-interactively",
        );
      }
      const approved = await confirm({
        message: `Trust and install ${branch} from ${sanitizeGitText(remote)}?`,
        initialValue: false,
      });
      if (isCancel(approved) || approved !== true) {
        throw new Error("Git source was not trusted; installation cancelled");
      }
    }

    const config = await loadConfig();
    const registry = AgentRegistry.getInstance();
    const resolvedInstallDir = resolveInstallDir({
      cliInstallDir: installDir,
      configInstallDir: config?.installDir,
      agentDirNames: registry.getAgentDirNames(),
    });
    const identity = `personal/${slug}`;
    const checkoutDir = path.join(getNoriSkillsetsDir(), identity);
    const settings: GitExecutionSettings = {
      disableTerminalPrompts: nonInteractive === true || silent === true,
    };

    await fs.mkdir(path.dirname(checkoutDir), { recursive: true });
    try {
      await fs.mkdir(checkoutDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`Skillset "${identity}" already exists`);
      }
      throw error;
    }

    let resolvedCommit: string | null = null;
    try {
      resolvedCommit = await acquireGitCheckout({
        branch,
        checkoutDir,
        pin,
        remote,
        settings,
        slug,
      });
    } catch (error) {
      await fs.rm(checkoutDir, { recursive: true, force: true });
      throw error;
    }

    for (const agent of getDefaultAgents({ config })) {
      await activateSkillset({
        installDir: resolvedInstallDir.path,
        agent,
        skillset: identity,
        persistActiveSkillset: resolvedInstallDir.source !== "cli",
      });
    }

    return {
      success: true,
      cancelled: false,
      message:
        resolvedCommit == null
          ? `Installed and activated Git-backed skillset "${identity}"`
          : `Installed and activated Git-backed skillset "${identity}" at ${resolvedCommit}`,
    };
  } catch (error) {
    return {
      success: false,
      cancelled: false,
      message: `Failed to install Git-backed skillset "${slug}": ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    if (silent === true) setSilentMode({ silent: false });
  }
};
