import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import { cancel, confirm, isCancel } from "@clack/prompts";

import { getDefaultAgents, loadConfig, updateConfig } from "@/cli/config.js";
import { markInstall } from "@/cli/features/agentOperations.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { validateGitPackageEntries } from "@/cli/features/gitPackage.js";
import { noninteractive as activateSkillset } from "@/cli/features/install/install.js";
import { withInstallLock } from "@/cli/features/install/installLock.js";
import { isSilentMode, setSilentMode } from "@/cli/logger.js";
import { validateSkillsetName } from "@/cli/prompts/validators.js";
import { readSkillsetMetadata } from "@/norijson/nori.js";
import { getNoriSkillsetsDir } from "@/norijson/skillset.js";
import { resolveInstallDir } from "@/utils/path.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 60_000;
const MINIMUM_GIT_VERSION = { major: 2, minor: 29 } as const;
const FULL_COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
const SSH_BATCH_MODE_DISABLED = /batchmode(?:\s*=\s*|\s+)["']?no\b/iu;
const SUPPORTED_REMOTE_SCHEMES = new Set([
  "file",
  "git",
  "git+ssh",
  "http",
  "https",
  "ssh",
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

const assertSupportedRemote = (args: { remote: string }): void => {
  if (/^[^:/\\]+::/u.test(args.remote)) {
    throw new Error("Git remote-helper URLs are not supported");
  }
  const scheme = args.remote.match(/^([^:/\\]+):\/\//u)?.[1]?.toLowerCase();
  if (scheme != null && !SUPPORTED_REMOTE_SCHEMES.has(scheme)) {
    throw new Error(`Unsupported Git remote scheme "${scheme}"`);
  }
};

const sanitizeDisplayText = (args: { value: string }): string =>
  args.value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "?");

const sanitizeErrorDetail = (error: unknown): string =>
  sanitizeDisplayText({
    value: error instanceof Error ? error.message : String(error),
  });

const SCP_USER_INFO_PATTERN = /^([^@/\\\s:]+)@(\[[^\]\s]+\]|[^/\\\s:]+):/u;

const redactRemote = (args: { remote: string }): string => {
  const { remote } = args;
  const withoutControlCharacters = sanitizeDisplayText({ value: remote });
  const withoutUserInfo = withoutControlCharacters
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/iu, "$1***@")
    .replace(SCP_USER_INFO_PATTERN, "***@$2:");
  try {
    const url = new URL(withoutUserInfo);
    for (const name of [...url.searchParams.keys()]) {
      url.searchParams.set(name, "***");
    }
    if (url.hash.length > 0) url.hash = "#***";
    return url.toString();
  } catch {
    return withoutUserInfo;
  }
};

const credentialFreeRemote = (args: { remote: string }): string => {
  const { remote } = args;
  const protocol = remote
    .match(/^([a-z][a-z0-9+.-]*):\/\//iu)?.[1]
    ?.toLowerCase();
  const withoutUserInfo =
    protocol === "http" || protocol === "https" || protocol === "file"
      ? remote.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/iu, "$1")
      : remote;
  try {
    const url = new URL(withoutUserInfo);
    url.password = "";
    if (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "file:"
    ) {
      url.username = "";
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return withoutUserInfo;
  }
};

const GIT_ROUTING_ENVIRONMENT = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_SHALLOW_FILE",
] as const;

const baseGitEnvironment = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const name of GIT_ROUTING_ENVIRONMENT) delete env[name];
  return env;
};

const assertSupportedGitVersion = async (): Promise<void> => {
  let output: string;
  try {
    output = await runGit({
      command: ["--version"],
      nonInteractive: true,
    });
  } catch (error) {
    throw new Error(
      `Unable to run Git: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const match = output.match(/git version (\d+)\.(\d+)/iu);
  if (match == null) {
    throw new Error(`Unable to determine Git version from: ${output}`);
  }
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  if (
    major < MINIMUM_GIT_VERSION.major ||
    (major === MINIMUM_GIT_VERSION.major && minor < MINIMUM_GIT_VERSION.minor)
  ) {
    throw new Error(
      `Git 2.29 or newer is required; found Git ${major}.${minor}`,
    );
  }
};

const isSshRemote = (args: { remote: string }): boolean => {
  const { remote } = args;
  const scheme = remote
    .match(/^([a-z][a-z0-9+.-]*):\/\//iu)?.[1]
    ?.toLowerCase();
  if (scheme != null) return scheme === "ssh" || scheme === "git+ssh";
  if (/^[a-z]:[\\/]/iu.test(remote)) return false;
  return /^[^/\\]+:.+/u.test(remote);
};

const normalizeAcquisitionRemote = (args: { remote: string }): string => {
  const { remote } = args;
  if (
    path.isAbsolute(remote) ||
    /^[a-z][a-z0-9+.-]*:\/\//iu.test(remote) ||
    /^[a-z]:[\\/]/iu.test(remote) ||
    isSshRemote({ remote })
  ) {
    return remote;
  }
  return path.resolve(remote);
};

const quoteShellArgument = (args: { value: string }): string =>
  `'${args.value.replaceAll("'", "'\\''")}'`;

const withBufferedOutput = async (args: {
  operation: () => Promise<void>;
}): Promise<() => void> => {
  const originalConsoleLog = console.log;
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const replayActions: Array<() => void> = [];
  const replayStdoutWrite = originalStdoutWrite.bind(process.stdout) as (
    ...writeArgs: Array<unknown>
  ) => unknown;
  const replayStderrWrite = originalStderrWrite.bind(process.stderr) as (
    ...writeArgs: Array<unknown>
  ) => unknown;
  console.log = (...values) => {
    replayActions.push(() => originalConsoleLog(...values));
  };
  process.stdout.write = ((...writeArgs: Array<unknown>) => {
    replayActions.push(() => {
      replayStdoutWrite(...writeArgs);
    });
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((...writeArgs: Array<unknown>) => {
    replayActions.push(() => {
      replayStderrWrite(...writeArgs);
    });
    return true;
  }) as typeof process.stderr.write;

  try {
    await args.operation();
  } finally {
    console.log = originalConsoleLog;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }

  return () => {
    for (const replay of replayActions) replay();
  };
};

const readSshCommandConfig = async (args: {
  cwd: string;
}): Promise<string | null> => {
  try {
    return (
      await execFileAsync("git", ["config", "--get", "core.sshCommand"], {
        cwd: args.cwd,
        env: baseGitEnvironment(),
        timeout: GIT_TIMEOUT_MS,
      })
    ).stdout.trim();
  } catch (error) {
    if (
      error != null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 1
    ) {
      return null;
    }
    throw error;
  }
};

const sanitizeGitError = (args: {
  value: string;
  remote?: string | null;
}): string => {
  const { remote } = args;
  let { value } = args;
  if (remote != null && remote.length > 0) {
    value = value.replaceAll(remote, redactRemote({ remote }));
    const scpUserInfo = remote.match(SCP_USER_INFO_PATTERN);
    if (scpUserInfo != null) {
      const [, user, host] = scpUserInfo;
      value = value.replaceAll(`${user}@${host}`, `***@${host}`);
    }
  }
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/giu, "$1***@")
    .replace(/([?&][^=&#\s]+)=([^&#\s]+)/giu, "$1=***")
    .replace(/#[^\s]+/gu, "#***")
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, "?");
};

type GitExecution = {
  error: unknown;
  exitCode: string | number | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
};

const executeGit = async (args: {
  command: Array<string>;
  configuredSshCommand?: string | null;
  cwd?: string | null;
  input?: string | null;
  nonInteractive: boolean;
  remote?: string | null;
  useDefaultSshBatchMode?: boolean | null;
}): Promise<GitExecution> => {
  const {
    configuredSshCommand,
    cwd,
    input,
    nonInteractive,
    useDefaultSshBatchMode,
  } = args;
  const env = baseGitEnvironment();
  if (nonInteractive) {
    env.GIT_TERMINAL_PROMPT = "0";
    env.GCM_INTERACTIVE = "Never";
    env.GIT_ASKPASS = "true";
    env.SSH_ASKPASS = "true";
    env.SSH_ASKPASS_REQUIRE = "never";
    const configCount = Number.parseInt(env.GIT_CONFIG_COUNT ?? "0", 10);
    const nextConfigIndex = Number.isNaN(configCount) ? 0 : configCount;
    env.GIT_CONFIG_COUNT = String(nextConfigIndex + 1);
    env[`GIT_CONFIG_KEY_${nextConfigIndex}`] = "credential.interactive";
    env[`GIT_CONFIG_VALUE_${nextConfigIndex}`] = "false";
    const environmentSshCommand = env.GIT_SSH_COMMAND ?? null;
    if (
      useDefaultSshBatchMode === true &&
      (environmentSshCommand != null || env.GIT_SSH == null)
    ) {
      const effectiveSshCommand =
        environmentSshCommand ?? configuredSshCommand ?? null;
      if (
        effectiveSshCommand != null &&
        SSH_BATCH_MODE_DISABLED.test(effectiveSshCommand)
      ) {
        throw new Error(
          "SSH command must not disable SSH batch mode for unattended installs",
        );
      }
      if (effectiveSshCommand == null) {
        env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
      } else if (/^(?:.*[\\/])?ssh(?:\s|$)/u.test(effectiveSshCommand)) {
        env.GIT_SSH_COMMAND = `${effectiveSshCommand} -oBatchMode=yes`;
      }
    }
  }

  return new Promise((resolve) => {
    let stdinError: Error | null = null;
    const child = execFile(
      "git",
      args.command,
      {
        cwd: cwd ?? undefined,
        env,
        maxBuffer: 10 * 1024 * 1024,
        timeout: GIT_TIMEOUT_MS,
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
          timedOut:
            executionError != null &&
            typeof executionError === "object" &&
            (("killed" in executionError && executionError.killed === true) ||
              ("code" in executionError &&
                executionError.code === "ETIMEDOUT")),
        });
      },
    );
    child.stdin?.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "EPIPE") {
        stdinError = error;
      }
    });
    child.stdin?.end(input ?? undefined);
  });
};

const failedGitCommand = (args: {
  result: GitExecution;
  remote?: string | null;
}): Error => {
  const detail =
    args.result.stderr ||
    (args.result.error instanceof Error
      ? args.result.error.message
      : String(args.result.error));
  const sanitized = sanitizeGitError({ value: detail, remote: args.remote });
  return args.result.timedOut
    ? new Error(`Git command timed out after 60 seconds: ${sanitized}`)
    : new Error(`Git command failed: ${sanitized}`);
};

const runGit = async (args: {
  command: Array<string>;
  configuredSshCommand?: string | null;
  cwd?: string | null;
  input?: string | null;
  nonInteractive: boolean;
  remote?: string | null;
  useDefaultSshBatchMode?: boolean | null;
}): Promise<string> => {
  const result = await executeGit(args);
  if (result.exitCode !== 0) {
    throw failedGitCommand({ result, remote: args.remote });
  }
  return result.stdout;
};

const validateCheckout = async (args: {
  checkoutDir: string;
  slug: string;
  nonInteractive: boolean;
}): Promise<void> => {
  const { checkoutDir, slug, nonInteractive } = args;
  validateGitPackageEntries({
    output: await runGit({
      command: ["ls-files", "--stage", "-z"],
      cwd: checkoutDir,
      nonInteractive,
    }),
  });

  let metadata;
  try {
    metadata = await readSkillsetMetadata({ skillsetDir: checkoutDir });
  } catch (error) {
    throw new Error(`Invalid skillset manifest: ${String(error)}`);
  }
  if (metadata.name !== slug) {
    throw new Error(
      `Skillset manifest name "${sanitizeDisplayText({ value: metadata.name })}" does not match requested name "${slug}"`,
    );
  }
  if (metadata.type !== "skillset") {
    throw new Error("Invalid skillset manifest: type must be skillset");
  }
};

const isAncestor = async (args: {
  ancestor: string;
  descendant: string;
  checkoutDir: string;
  nonInteractive: boolean;
}): Promise<boolean> => {
  const result = await executeGit({
    command: ["merge-base", "--is-ancestor", args.ancestor, args.descendant],
    cwd: args.checkoutDir,
    nonInteractive: args.nonInteractive,
  });
  if (result.exitCode === 0) return true;
  if (result.exitCode === 1) return false;
  throw failedGitCommand({ result });
};

const inspectPinnedObject = async (args: {
  checkoutDir: string;
  nonInteractive: boolean;
  pin: string;
}): Promise<{ objectType: string; resolvedCommit: string } | null> => {
  const result = await executeGit({
    command: ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
    cwd: args.checkoutDir,
    input: `${args.pin}\n`,
    nonInteractive: args.nonInteractive,
  });
  if (result.exitCode !== 0) throw failedGitCommand({ result });
  const [resolvedCommit, objectType, ...extra] = result.stdout.split(" ");
  if (
    objectType === "missing" &&
    resolvedCommit === args.pin &&
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
  nonInteractive: boolean;
  pin: string;
}): Promise<string> => {
  const shallow = await runGit({
    command: ["rev-parse", "--is-shallow-repository"],
    cwd: args.checkoutDir,
    nonInteractive: args.nonInteractive,
  });
  if (shallow === "true") {
    throw new Error(
      "Pinned installs require complete history; the Git source is shallow",
    );
  }

  const inspectedObject = await inspectPinnedObject(args);
  if (inspectedObject == null) {
    throw new Error(
      `Pinned commit "${args.pin}" was not found in ${args.branch} history`,
    );
  }
  const { objectType, resolvedCommit } = inspectedObject;
  if (resolvedCommit.toLowerCase() !== args.pin.toLowerCase()) {
    throw new Error(
      "--pin must be a full hexadecimal commit SHA (40 or 64 characters)",
    );
  }
  if (objectType !== "commit") {
    throw new Error(`Pinned object "${args.pin}" does not identify a commit`);
  }
  if (
    !(await isAncestor({
      ancestor: resolvedCommit,
      descendant: args.branchTip,
      checkoutDir: args.checkoutDir,
      nonInteractive: args.nonInteractive,
    }))
  ) {
    throw new Error(
      `Pinned commit "${args.pin}" was not found in ${args.branch} history`,
    );
  }

  await runGit({
    command: ["checkout", "--detach", resolvedCommit],
    cwd: args.checkoutDir,
    nonInteractive: args.nonInteractive,
  });
  return resolvedCommit;
};

const parseRemoteBranchTip = (args: {
  branch: string;
  output: string;
}): string => {
  const records = args.output
    .split("\n")
    .filter((record) => record.trim().length > 0);
  const expectedRef = `refs/heads/${args.branch}`;
  const match =
    records.length === 1 ? /^([0-9a-f]+)\t(.+)$/iu.exec(records[0]) : null;
  if (match == null || match[2] !== expectedRef) {
    throw new Error(`Required branch "${args.branch}" was not found`);
  }
  if (!FULL_COMMIT_SHA.test(match[1])) {
    throw new Error("Git returned an invalid branch-tip object ID");
  }
  return match[1];
};

const acquireCheckout = async (args: {
  branch: string;
  checkoutDir: string;
  nonInteractive: boolean;
  pin?: string | null;
  remote: string;
  slug: string;
}): Promise<string | null> => {
  const { branch, checkoutDir, nonInteractive, pin, slug } = args;
  const remote = normalizeAcquisitionRemote({ remote: args.remote });
  const sourceRef = `refs/heads/${branch}`;
  const trackingRef = `refs/remotes/origin/${branch}`;
  const sshRemote = nonInteractive && isSshRemote({ remote });
  const configuredSshCommand = sshRemote
    ? await readSshCommandConfig({ cwd: checkoutDir })
    : null;
  const useDefaultSshBatchMode = sshRemote;
  const remoteBranchTip = parseRemoteBranchTip({
    branch,
    output: await runGit({
      command: ["ls-remote", "--heads", "--", remote, sourceRef],
      configuredSshCommand,
      nonInteractive,
      remote,
      useDefaultSshBatchMode,
    }),
  });
  if (pin != null && pin.length !== remoteBranchTip.length) {
    throw new Error(
      "--pin must be a full hexadecimal commit SHA (40 or 64 characters)",
    );
  }

  await runGit({
    command: [
      "init",
      "--quiet",
      ...(remoteBranchTip.length === 64 ? ["--object-format=sha256"] : []),
      checkoutDir,
    ],
    nonInteractive,
  });
  try {
    await runGit({
      command: [
        "fetch",
        "--no-tags",
        "--no-write-fetch-head",
        "--update-shallow",
        "--",
        remote,
        `+${sourceRef}:${trackingRef}`,
      ],
      configuredSshCommand,
      cwd: checkoutDir,
      nonInteractive,
      remote,
      useDefaultSshBatchMode,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      /couldn't find remote ref/iu.test(error.message)
    ) {
      throw new Error(`Required branch "${branch}" was not found`);
    }
    throw error;
  }
  const storedRemote = credentialFreeRemote({ remote });
  await runGit({
    command: ["config", "remote.origin.url", storedRemote],
    cwd: checkoutDir,
    nonInteractive,
    remote,
  });
  await runGit({
    command: ["config", "remote.origin.fetch", `+${sourceRef}:${trackingRef}`],
    cwd: checkoutDir,
    nonInteractive,
  });
  await runGit({
    command: ["config", "remote.origin.tagOpt", "--no-tags"],
    cwd: checkoutDir,
    nonInteractive,
  });
  const branchTip = await runGit({
    command: ["rev-parse", "--verify", "--end-of-options", trackingRef],
    cwd: checkoutDir,
    nonInteractive,
  });
  const resolvedCommit =
    pin == null
      ? null
      : await selectPinnedCommit({
          branch,
          branchTip,
          checkoutDir,
          nonInteractive,
          pin,
        });
  if (pin == null) {
    await runGit({
      command: [
        "checkout",
        "--quiet",
        "-b",
        branch,
        "--track",
        `origin/${branch}`,
      ],
      cwd: checkoutDir,
      nonInteractive,
    });
  }
  await validateCheckout({ checkoutDir, nonInteractive, slug });
  return resolvedCommit;
};

const gitInstallMainImpl = async (
  args: GitInstallArgs,
): Promise<CommandStatus> => {
  const nameError = validateSkillsetName({ value: args.slug });
  if (nameError != null) {
    return {
      success: false,
      cancelled: false,
      message: `Failed to install Git-backed skillset: ${sanitizeErrorDetail(nameError)}`,
    };
  }

  const { slug, remote, pin, installDir, trustSource, nonInteractive, silent } =
    args;
  const wasSilent = isSilentMode();
  if (silent === true) setSilentMode({ silent: true });

  try {
    assertSupportedRemote({ remote });
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
        message: `Trust and install ${branch} from ${redactRemote({ remote })}?`,
        initialValue: false,
      });
      if (isCancel(approved) || approved !== true) {
        cancel("Git installation cancelled");
        return { success: false, cancelled: true, message: "" };
      }
    }

    await assertSupportedGitVersion();

    const config = await loadConfig();
    const registry = AgentRegistry.getInstance();
    const agents = getDefaultAgents({ config });
    for (const agent of agents) registry.get({ name: agent });
    const resolvedInstallDir = resolveInstallDir({
      cliInstallDir: installDir,
      configInstallDir: config?.installDir,
      agentDirNames: registry.getAgentDirNames(),
    });
    const identity = `personal/${slug}`;
    const checkoutDir = path.join(getNoriSkillsetsDir(), identity);

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
      resolvedCommit = await acquireCheckout({
        branch,
        checkoutDir,
        nonInteractive: nonInteractive === true || silent === true,
        pin,
        remote,
        slug,
      });
    } catch (error) {
      await fs.rm(checkoutDir, { recursive: true, force: true });
      throw error;
    }

    const recoveryCommand = [
      "sks",
      ...(resolvedInstallDir.source === "cli"
        ? [
            "--install-dir",
            quoteShellArgument({ value: resolvedInstallDir.path }),
          ]
        : []),
      ...(agents.length === 1
        ? ["--agent", quoteShellArgument({ value: agents[0] })]
        : []),
      "switch",
      quoteShellArgument({ value: identity }),
      "--force",
    ].join(" ");

    const replayActivationOutput: Array<() => void> = [];
    try {
      for (const agent of agents) {
        const operation = async () =>
          activateSkillset({
            installDir: resolvedInstallDir.path,
            agent,
            skillset: identity,
            persistActiveSkillset: false,
            persistInstallMarkers: false,
          });
        const replay = await withBufferedOutput({ operation });
        markInstall({
          agent: registry.get({ name: agent }),
          path: resolvedInstallDir.path,
          skillsetName: identity,
        });
        replayActivationOutput.push(replay);
      }
    } catch (error) {
      const detail = sanitizeErrorDetail(error);
      throw new Error(
        `Activation is incomplete; checkout "${identity}" was retained. Fix the reported problem, then run: ${recoveryCommand}. ${detail}`,
      );
    }

    if (resolvedInstallDir.source !== "cli") {
      try {
        await updateConfig({ activeSkillset: identity });
      } catch (error) {
        const detail = sanitizeErrorDetail(error);
        throw new Error(
          `Activation completed, but the active skillset could not be saved; checkout "${identity}" was retained. Fix the reported problem, then run: ${recoveryCommand}. ${detail}`,
        );
      }
    }

    if (silent !== true) {
      for (const replay of replayActivationOutput) replay();
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
      message: `Failed to install Git-backed skillset "${slug}": ${sanitizeErrorDetail(error)}`,
    };
  } finally {
    if (silent === true) setSilentMode({ silent: wasSilent });
  }
};

export const gitInstallMain = async (
  args: GitInstallArgs,
): Promise<CommandStatus> =>
  withInstallLock({ operation: () => gitInstallMainImpl(args) });
