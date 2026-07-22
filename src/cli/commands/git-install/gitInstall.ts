import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

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

const sanitizeGitError = (value: string): string =>
  value
    .replace(/(https?:\/\/)[^@\s/]+@/giu, "$1***@")
    .replace(/([?&](?:access_token|key|signature|token)=)[^&\s]+/giu, "$1***");

const GIT_ROUTING_ENVIRONMENT = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
] as const;

const gitEnvironment = (): NodeJS.ProcessEnv => {
  const environment = { ...process.env };
  for (const name of GIT_ROUTING_ENVIRONMENT) delete environment[name];
  return environment;
};

const gitErrorDetail = (error: unknown): string => {
  const detail =
    error != null && typeof error === "object" && "stderr" in error
      ? String(error.stderr).trim() ||
        (error instanceof Error ? error.message : String(error))
      : String(error);
  return sanitizeGitError(detail);
};

const runGit = async (args: Array<string>, cwd?: string): Promise<string> => {
  try {
    return (
      await execFileAsync("git", args, {
        cwd,
        env: gitEnvironment(),
        maxBuffer: 10 * 1024 * 1024,
      })
    ).stdout.trim();
  } catch (error) {
    throw new Error(`Git command failed: ${gitErrorDetail(error)}`);
  }
};

const isAncestor = async (args: {
  ancestor: string;
  descendant: string;
  checkoutDir: string;
}): Promise<boolean> => {
  const { ancestor, descendant, checkoutDir } = args;
  try {
    await execFileAsync(
      "git",
      ["merge-base", "--is-ancestor", ancestor, descendant],
      {
        cwd: checkoutDir,
        env: gitEnvironment(),
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    return true;
  } catch (error) {
    if (
      error != null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 1
    ) {
      return false;
    }
    throw new Error(`Git command failed: ${gitErrorDetail(error)}`);
  }
};

const selectPinnedCommit = async (args: {
  branch: string;
  checkoutDir: string;
  pin: string;
}): Promise<string> => {
  const { branch, checkoutDir, pin } = args;
  const shallow = await runGit(
    ["rev-parse", "--is-shallow-repository"],
    checkoutDir,
  );
  if (shallow === "true") {
    throw new Error(
      "Pinned installs require complete history; the Git source is shallow",
    );
  }

  const branchTip = await runGit(["rev-parse", "HEAD"], checkoutDir);
  let objectType: string;
  try {
    objectType = await runGit(["cat-file", "-t", pin], checkoutDir);
  } catch {
    throw new Error(
      `Pinned commit "${pin}" was not found in ${branch} history`,
    );
  }
  if (objectType !== "commit") {
    throw new Error(`Pinned object "${pin}" does not identify a commit`);
  }

  const resolvedCommit = await runGit(
    ["rev-parse", "--verify", "--end-of-options", pin],
    checkoutDir,
  );
  if (
    !(await isAncestor({
      ancestor: resolvedCommit,
      descendant: branchTip,
      checkoutDir,
    }))
  ) {
    throw new Error(
      `Pinned commit "${pin}" was not found in ${branch} history`,
    );
  }

  await runGit(["checkout", "--detach", resolvedCommit], checkoutDir);
  return resolvedCommit;
};

const validateCheckout = async (args: {
  checkoutDir: string;
  slug: string;
}): Promise<void> => {
  const { checkoutDir, slug } = args;
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

  const entries = await runGit(["ls-files", "--stage"], checkoutDir);
  if (/^\d{6} [0-9a-f]+ \d+\t\.nori-version$/mu.test(entries)) {
    throw new Error(
      "Git-backed skillsets cannot contain Registry provenance (.nori-version)",
    );
  }
  if (/^120000 /mu.test(entries)) {
    throw new Error("Git-backed skillsets cannot contain symbolic links");
  }
  if (/^160000 /mu.test(entries)) {
    throw new Error("Git-backed skillsets cannot contain submodules");
  }
};

const acquireGitCheckout = async (args: {
  branch: string;
  checkoutDir: string;
  pin?: string | null;
  remote: string;
  slug: string;
}): Promise<string | null> => {
  const { branch, checkoutDir, pin, remote, slug } = args;
  const cloneArgs = ["clone", "--single-branch", "--branch", branch];
  if (pin != null) cloneArgs.push("--no-checkout");
  cloneArgs.push("--", remote, checkoutDir);
  await runGit(cloneArgs);

  const resolvedCommit =
    pin == null ? null : await selectPinnedCommit({ branch, checkoutDir, pin });
  await validateCheckout({ checkoutDir, slug });
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
        message: `Trust and install ${branch} from ${remote}?`,
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
