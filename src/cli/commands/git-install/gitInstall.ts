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

type GitInstallArgs = {
  slug: string;
  remote: string;
  installDir?: string | null;
  trustSource?: boolean | null;
  nonInteractive?: boolean | null;
  silent?: boolean | null;
};

const sanitizeGitError = (value: string): string =>
  value
    .replace(/(https?:\/\/)[^@\s/]+@/giu, "$1***@")
    .replace(/([?&](?:access_token|key|signature|token)=)[^&\s]+/giu, "$1***");

const runGit = async (args: Array<string>, cwd?: string): Promise<string> => {
  try {
    return (
      await execFileAsync("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 })
    ).stdout.trim();
  } catch (error) {
    const detail =
      error != null && typeof error === "object" && "stderr" in error
        ? String(error.stderr).trim() ||
          (error instanceof Error ? error.message : String(error))
        : String(error);
    throw new Error(`Git command failed: ${sanitizeGitError(detail)}`);
  }
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

export const gitInstallMain = async (
  args: GitInstallArgs,
): Promise<CommandStatus> => {
  const { slug, remote, installDir, trustSource, nonInteractive, silent } =
    args;
  if (silent === true) setSilentMode({ silent: true });

  try {
    const nameError = validateSkillsetName({ value: slug });
    if (nameError != null) throw new Error(nameError);

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

    try {
      await runGit([
        "clone",
        "--single-branch",
        "--branch",
        branch,
        "--",
        remote,
        checkoutDir,
      ]);
      await validateCheckout({ checkoutDir, slug });
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
      message: `Installed and activated Git-backed skillset "${identity}"`,
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
