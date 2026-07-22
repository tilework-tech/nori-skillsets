import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import { confirm, isCancel } from "@clack/prompts";

import { getDefaultAgents, loadConfig } from "@/cli/config.js";
import { switchSkillset } from "@/cli/features/agentOperations.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { noninteractive as activateSkillset } from "@/cli/features/install/install.js";
import { hasExistingInstallation } from "@/cli/features/install/installState.js";
import { setSilentMode } from "@/cli/logger.js";
import { validateSkillsetName } from "@/cli/prompts/validators.js";
import { readSkillsetMetadata } from "@/norijson/nori.js";
import { getNoriSkillsetsDir } from "@/norijson/skillset.js";
import { resolveInstallDir } from "@/utils/path.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";

const execFileAsync = promisify(execFile);

export type AcquiredGitSkillset = {
  identity: string;
  checkoutDir: string;
};

type AcquireGitSkillsetArgs = {
  slug: string;
  remote: string;
  profilesDir: string;
  trustSource?: boolean | null;
  nonInteractive?: boolean | null;
};

const sanitizeGitError = (value: string): string =>
  value
    .replace(/(https?:\/\/)[^@\s/]+@/giu, "$1***@")
    .replace(/([?&](?:access_token|key|signature|token)=)[^&\s]+/giu, "$1***");

const runGit = async (args: {
  cwd?: string;
  command: ReadonlyArray<string>;
}): Promise<string> => {
  const { cwd, command } = args;
  try {
    const result = await execFileAsync("git", command, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return result.stdout.trim();
  } catch (error) {
    const detail =
      error != null && typeof error === "object" && "stderr" in error
        ? String(error.stderr).trim()
        : error instanceof Error
          ? error.message
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
    throw new Error(
      `Invalid skillset manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (metadata.name !== slug) {
    throw new Error(
      `Skillset manifest name "${metadata.name}" does not match requested name "${slug}"`,
    );
  }
  if (metadata.type !== "skillset") {
    throw new Error("Invalid skillset manifest: type must be skillset");
  }

  const trackedEntries = await runGit({
    cwd: checkoutDir,
    command: ["ls-files", "--stage"],
  });
  for (const line of trackedEntries.split("\n")) {
    const entry = /^(\d{6}) [0-9a-f]+ \d+\t(.+)$/u.exec(line);
    if (entry == null) continue;
    const [, mode, trackedPath] = entry;
    if (trackedPath === ".nori-version") {
      throw new Error(
        "Git-backed skillsets cannot contain Registry provenance (.nori-version)",
      );
    }
    if (mode === "120000") {
      throw new Error("Git-backed skillsets cannot contain symbolic links");
    }
    if (mode === "160000") {
      throw new Error("Git-backed skillsets cannot contain submodules");
    }
  }
};

const approveSource = async (args: {
  remote: string;
  branch: string;
  trustSource?: boolean | null;
  nonInteractive?: boolean | null;
}): Promise<void> => {
  const { remote, branch, trustSource, nonInteractive } = args;
  if (trustSource === true) return;
  if (nonInteractive === true) {
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
};

export const acquireGitSkillset = async (
  args: AcquireGitSkillsetArgs,
): Promise<AcquiredGitSkillset> => {
  const { slug, remote, profilesDir, trustSource, nonInteractive } = args;
  const nameError = validateSkillsetName({ value: slug });
  if (nameError != null) throw new Error(nameError);

  const branch = `skillsets/${slug}`;
  const targetDir = path.join(profilesDir, "personal", slug);
  await approveSource({ remote, branch, trustSource, nonInteractive });
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  try {
    await fs.mkdir(targetDir);
  } catch (error) {
    if (
      error != null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw new Error(`Skillset "personal/${slug}" already exists`);
    }
    throw error;
  }

  try {
    await runGit({
      command: [
        "clone",
        "--no-local",
        "--single-branch",
        "--depth",
        "1",
        "--branch",
        branch,
        "--",
        remote,
        targetDir,
      ],
    });
    await validateCheckout({ checkoutDir: targetDir, slug });
    return {
      identity: `personal/${slug}`,
      checkoutDir: targetDir,
    };
  } catch (error) {
    await fs.rm(targetDir, { recursive: true, force: true });
    throw error;
  }
};

type GitInstallArgs = {
  slug: string;
  remote: string;
  installDir?: string | null;
  trustSource?: boolean | null;
  nonInteractive?: boolean | null;
  silent?: boolean | null;
};

export const gitInstallMain = async (
  args: GitInstallArgs,
): Promise<CommandStatus> => {
  const { slug, remote, installDir, trustSource, nonInteractive, silent } =
    args;
  if (silent === true) setSilentMode({ silent: true });
  try {
    const config = await loadConfig();
    const firstInstall = !hasExistingInstallation();
    const agents = getDefaultAgents({ config });
    const resolvedInstallDir = resolveInstallDir({
      cliInstallDir: installDir,
      configInstallDir: config?.installDir,
      agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
    });
    const acquired = await acquireGitSkillset({
      slug,
      remote,
      profilesDir: getNoriSkillsetsDir(),
      trustSource,
      nonInteractive: nonInteractive === true || silent === true,
    });

    for (const agentName of agents) {
      const agent = AgentRegistry.getInstance().get({ name: agentName });
      if (!firstInstall) {
        await switchSkillset({
          agent,
          installDir: resolvedInstallDir.path,
          skillsetName: acquired.identity,
        });
      }
      await activateSkillset({
        installDir: resolvedInstallDir.path,
        agent: agentName,
        skillset: acquired.identity,
        persistActiveSkillset: resolvedInstallDir.source !== "cli",
      });
    }

    return {
      success: true,
      cancelled: false,
      message: `Installed and activated Git-backed skillset "${acquired.identity}"`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      cancelled: false,
      message: `Failed to install Git-backed skillset "${slug}": ${message}`,
    };
  } finally {
    if (silent === true) setSilentMode({ silent: false });
  }
};
