import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import { cancel, confirm, isCancel } from "@clack/prompts";

import { getDefaultAgents, loadConfig, updateConfig } from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
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

type GitInstallArgs = {
  slug: string;
  remote: string;
  installDir?: string | null;
  trustSource?: boolean | null;
  nonInteractive?: boolean | null;
  silent?: boolean | null;
};

const assertSupportedRemote = (args: { remote: string }): void => {
  if (/^[^:/\\]+::/u.test(args.remote)) {
    throw new Error("Git remote-helper URLs are not supported");
  }
};

const redactRemote = (args: { remote: string }): string => {
  const { remote } = args;
  const withoutControlCharacters = remote.replace(
    /[\u0000-\u001f\u007f]/gu,
    "?",
  );
  const withoutUserInfo = withoutControlCharacters.replace(
    /^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/iu,
    "$1***@",
  );
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

const assertSupportedGitVersion = async (): Promise<void> => {
  let output: string;
  try {
    output = (
      await execFileAsync("git", ["--version"], { timeout: GIT_TIMEOUT_MS })
    ).stdout.trim();
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
  const scheme = remote.match(/^([a-z][a-z0-9+.-]*):\/\//iu)?.[1];
  if (scheme != null) return scheme === "ssh" || scheme === "git+ssh";
  if (/^[a-z]:[\\/]/iu.test(remote)) return false;
  return /^[^/\\]+:.+/u.test(remote);
};

const quoteShellArgument = (args: { value: string }): string =>
  `'${args.value.replaceAll("'", "'\\''")}'`;

const readSshCommandConfig = async (args: {
  cwd: string;
}): Promise<string | null> => {
  try {
    return (
      await execFileAsync("git", ["config", "--get", "core.sshCommand"], {
        cwd: args.cwd,
        env: process.env,
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
  }
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/giu, "$1***@")
    .replace(/([?&][^=&#\s]+)=([^&#\s]+)/giu, "$1=***")
    .replace(/#[^\s]+/gu, "#***");
};

const runGit = async (args: {
  command: Array<string>;
  cwd?: string | null;
  nonInteractive: boolean;
  remote?: string | null;
  useDefaultSshBatchMode?: boolean | null;
}): Promise<string> => {
  const { cwd, nonInteractive, remote, useDefaultSshBatchMode } = args;
  const command = nonInteractive
    ? ["-c", "credential.interactive=false", ...args.command]
    : args.command;
  const env = { ...process.env };
  if (nonInteractive) {
    env.GIT_TERMINAL_PROMPT = "0";
    env.GCM_INTERACTIVE = "Never";
    env.GIT_ASKPASS = "true";
    env.SSH_ASKPASS = "true";
    env.SSH_ASKPASS_REQUIRE = "never";
    if (
      useDefaultSshBatchMode === true &&
      env.GIT_SSH_COMMAND == null &&
      env.GIT_SSH == null
    ) {
      env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
    }
  }
  try {
    return (
      await execFileAsync("git", command, {
        cwd: cwd ?? undefined,
        env,
        maxBuffer: 10 * 1024 * 1024,
        timeout: GIT_TIMEOUT_MS,
      })
    ).stdout.trim();
  } catch (error) {
    const timedOut =
      error != null &&
      typeof error === "object" &&
      (("killed" in error && error.killed === true) ||
        ("code" in error && error.code === "ETIMEDOUT"));
    const detail =
      error != null && typeof error === "object" && "stderr" in error
        ? String(error.stderr).trim() ||
          (error instanceof Error ? error.message : String(error))
        : String(error);
    const sanitized = sanitizeGitError({ value: detail, remote });
    if (timedOut) {
      throw new Error(`Git command timed out after 60 seconds: ${sanitized}`);
    }
    throw new Error(`Git command failed: ${sanitized}`);
  }
};

const validateCheckout = async (args: {
  checkoutDir: string;
  slug: string;
  nonInteractive: boolean;
}): Promise<void> => {
  const { checkoutDir, slug, nonInteractive } = args;
  const entries = await runGit({
    command: ["ls-files", "--stage", "-z"],
    cwd: checkoutDir,
    nonInteractive,
  });
  let manifestMode: string | null = null;
  for (const entry of entries.split("\0").filter((value) => value.length > 0)) {
    const match = entry.match(/^(\d{6}) [0-9a-f]+ \d+\t([\s\S]+)$/u);
    if (match == null)
      throw new Error("Unable to validate tracked Git entries");
    const [, mode, filePath] = match;
    if (mode === "120000") {
      throw new Error("Git-backed skillsets cannot contain symbolic links");
    }
    if (mode === "160000") {
      throw new Error("Git-backed skillsets cannot contain submodules");
    }
    if (filePath === ".nori-version") {
      throw new Error(
        "Git-backed skillsets cannot contain Registry provenance (.nori-version)",
      );
    }
    if (filePath === "nori.json") manifestMode = mode;
  }
  if (manifestMode !== "100644" && manifestMode !== "100755") {
    throw new Error("Git-backed skillsets require a regular tracked nori.json");
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

const acquireCheckout = async (args: {
  branch: string;
  checkoutDir: string;
  nonInteractive: boolean;
  remote: string;
}): Promise<void> => {
  const { branch, checkoutDir, nonInteractive, remote } = args;
  const sourceRef = `refs/heads/${branch}`;
  const trackingRef = `refs/remotes/origin/${branch}`;
  await runGit({
    command: ["init", "--quiet", checkoutDir],
    nonInteractive,
  });
  const sshRemote = nonInteractive && isSshRemote({ remote });
  const configuredSshCommand = sshRemote
    ? await readSshCommandConfig({ cwd: checkoutDir })
    : null;
  const useDefaultSshBatchMode =
    sshRemote &&
    process.env.GIT_SSH_COMMAND == null &&
    process.env.GIT_SSH == null &&
    configuredSshCommand == null;
  try {
    await runGit({
      command: [
        "fetch",
        "--depth",
        "1",
        "--no-tags",
        "--no-write-fetch-head",
        "--",
        remote,
        `+${sourceRef}:${trackingRef}`,
      ],
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
};

const gitInstallMainImpl = async (
  args: GitInstallArgs,
): Promise<CommandStatus> => {
  const { slug, remote, installDir, trustSource, nonInteractive, silent } =
    args;
  const wasSilent = isSilentMode();
  if (silent === true) setSilentMode({ silent: true });

  try {
    assertSupportedRemote({ remote });

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

    try {
      await acquireCheckout({
        branch,
        checkoutDir,
        nonInteractive: nonInteractive === true || silent === true,
        remote,
      });
      await validateCheckout({
        checkoutDir,
        slug,
        nonInteractive: nonInteractive === true || silent === true,
      });
    } catch (error) {
      await fs.rm(checkoutDir, { recursive: true, force: true });
      throw error;
    }

    try {
      for (const agent of agents) {
        await activateSkillset({
          installDir: resolvedInstallDir.path,
          agent,
          skillset: identity,
          persistActiveSkillset: false,
          silent,
        });
      }
      if (resolvedInstallDir.source !== "cli") {
        await updateConfig({ activeSkillset: identity });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
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
      throw new Error(
        `Activation is incomplete; checkout "${identity}" was retained. Fix the reported problem, then run: ${recoveryCommand}. ${detail}`,
      );
    }

    return {
      success: true,
      cancelled: false,
      message: `Installed and activated Git-backed skillset "${identity}"`,
    };
  } catch (error) {
    return {
      success: false,
      cancelled: false,
      message: `Failed to install Git-backed skillset "${slug}": ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    if (silent === true) setSilentMode({ silent: wasSilent });
  }
};

export const gitInstallMain = async (
  args: GitInstallArgs,
): Promise<CommandStatus> => {
  const nameError = validateSkillsetName({ value: args.slug });
  if (nameError != null) {
    return {
      success: false,
      cancelled: false,
      message: `Failed to install Git-backed skillset: ${nameError}`,
    };
  }

  try {
    return await withInstallLock({
      operation: () => gitInstallMainImpl(args),
    });
  } catch (error) {
    return {
      success: false,
      cancelled: false,
      message: `Failed to install Git-backed skillset "${args.slug}": ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};
