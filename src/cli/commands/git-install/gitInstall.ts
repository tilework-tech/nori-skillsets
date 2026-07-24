import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import { cancel, confirm, isCancel } from "@clack/prompts";

import { getDefaultAgents, loadConfig, updateConfig } from "@/cli/config.js";
import { markInstall } from "@/cli/features/agentOperations.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import {
  assertSupportedGitVersion,
  assertSupportedRemote,
  baseGitEnvironment,
  credentialFreeRemote,
  executeGit,
  failedGitCommand,
  GIT_TIMEOUT_MS,
  isAncestor,
  isSshRemote,
  normalizeAcquisitionRemote,
  redactRemote,
  runGit,
  sanitizeDisplayText,
  validateGitPackageEntries,
} from "@/cli/features/gitPackage.js";
import { noninteractive as activateSkillset } from "@/cli/features/install/install.js";
import { withInstallLock } from "@/cli/features/install/installLock.js";
import { isSilentMode, setSilentMode } from "@/cli/logger.js";
import { validateSkillsetName } from "@/cli/prompts/validators.js";
import { readSkillsetMetadata } from "@/norijson/nori.js";
import { getNoriSkillsetsDir } from "@/norijson/skillset.js";
import { resolveInstallDir } from "@/utils/path.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";

const execFileAsync = promisify(execFile);
const FULL_COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;

type GitInstallArgs = {
  slug: string;
  remote: string;
  pin?: string | null;
  installDir?: string | null;
  trustSource?: boolean | null;
  nonInteractive?: boolean | null;
  silent?: boolean | null;
};

const sanitizeErrorDetail = (error: unknown): string =>
  sanitizeDisplayText({
    value: error instanceof Error ? error.message : String(error),
  });

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
