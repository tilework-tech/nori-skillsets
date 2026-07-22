import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import { confirm, isCancel } from "@clack/prompts";

import { getConfigPath, getDefaultAgents, loadConfig } from "@/cli/config.js";
import {
  removeSkillset,
  switchSkillset,
} from "@/cli/features/agentOperations.js";
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
  resolvedCommit: string;
};

type AcquireGitSkillsetArgs = {
  slug: string;
  remote: string;
  pin?: string | null;
  profilesDir: string;
  trustSource?: boolean | null;
  nonInteractive?: boolean | null;
};

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
    throw new Error(`Git command failed: ${detail}`);
  }
};

const validateRemoteCredentials = (args: { remote: string }): void => {
  const { remote } = args;
  try {
    const url = new URL(remote);
    const embedsHttpUserInfo =
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.username.length > 0 || url.password.length > 0);
    const embedsSecrets =
      embedsHttpUserInfo ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0;
    if (embedsSecrets) {
      throw new Error(
        "Git remote URLs containing embedded credentials are not supported; use your Git credential helper or SSH agent",
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Git remote URLs")) {
      throw error;
    }
    // Local paths and SCP-style SSH remotes are not WHATWG URLs.
  }
};

const normalizeRemote = (args: { remote: string }): string => {
  const { remote } = args;
  try {
    const url = new URL(remote);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    if (/^[^/]+@[^:]+:.+/.test(remote)) return remote;
    return path.resolve(remote);
  }
};

const pathExists = async (args: { filePath: string }): Promise<boolean> => {
  try {
    await fs.access(args.filePath);
    return true;
  } catch {
    return false;
  }
};

const dependencyEntries = (args: {
  group: unknown;
  label: string;
}): Array<string> => {
  if (args.group == null) return [];
  if (
    typeof args.group !== "object" ||
    Array.isArray(args.group) ||
    Object.values(args.group).some((value) => typeof value !== "string")
  ) {
    throw new Error(`Invalid ${args.label} dependency declarations`);
  }
  return Object.keys(args.group);
};

const validateMaterializedDependencies = async (args: {
  checkoutDir: string;
  dependencies: unknown;
}): Promise<void> => {
  const { checkoutDir, dependencies } = args;
  if (dependencies == null) return;
  if (typeof dependencies !== "object" || Array.isArray(dependencies)) {
    throw new Error("Invalid skillset dependencies");
  }
  const groups = dependencies as Record<string, unknown>;
  const checks: Array<{ name: string; candidates: Array<string> }> = [];
  for (const name of dependencyEntries({
    group: groups.skills,
    label: "skill",
  })) {
    checks.push({ name, candidates: [path.join("skills", name, "SKILL.md")] });
  }
  for (const name of dependencyEntries({
    group: groups.subagents,
    label: "subagent",
  })) {
    checks.push({
      name,
      candidates: [
        path.join("subagents", name, "SUBAGENT.md"),
        path.join("subagents", `${name}.md`),
      ],
    });
  }
  for (const name of dependencyEntries({
    group: groups.slashCommands,
    label: "slash command",
  })) {
    checks.push({
      name,
      candidates: [path.join("slashcommands", `${name}.md`)],
    });
  }
  for (const check of checks) {
    if (
      path.isAbsolute(check.name) ||
      check.name.includes("/") ||
      check.name.includes("\\") ||
      check.name === "." ||
      check.name === ".."
    ) {
      throw new Error(`Invalid dependency name "${check.name}"`);
    }
    const materialized = await Promise.all(
      check.candidates.map((candidate) =>
        pathExists({ filePath: path.join(checkoutDir, candidate) }),
      ),
    );
    if (!materialized.some(Boolean)) {
      throw new Error(
        `Git-backed skillsets must be self-contained; dependency "${check.name}" is not materialized in the checkout`,
      );
    }
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
  if (
    typeof metadata.name !== "string" ||
    metadata.name.length === 0 ||
    typeof metadata.version !== "string" ||
    metadata.version.length === 0 ||
    metadata.type !== "skillset"
  ) {
    throw new Error(
      "Invalid skillset manifest: name, version, and type=skillset are required",
    );
  }
  if (metadata.name !== slug) {
    throw new Error(
      `Skillset manifest name "${metadata.name}" does not match requested name "${slug}"`,
    );
  }
  for (const [label, content] of [
    ["skills", metadata.skills],
    ["subagents", metadata.subagents],
    ["slashcommands", metadata.slashcommands],
  ] as const) {
    if (content != null && !Array.isArray(content)) {
      throw new Error(`Invalid skillset manifest: ${label} must be an array`);
    }
  }
  await validateMaterializedDependencies({
    checkoutDir,
    dependencies: metadata.dependencies,
  });

  const trackedEntries = await runGit({
    cwd: checkoutDir,
    command: ["ls-files", "--stage"],
  });
  for (const line of trackedEntries.split("\n")) {
    const mode = line.split(" ", 1)[0];
    const trackedPath = line.slice(line.indexOf("\t") + 1);
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
  ref: string;
  trustSource?: boolean | null;
  nonInteractive?: boolean | null;
}): Promise<void> => {
  const { remote, ref, trustSource, nonInteractive } = args;
  if (trustSource === true) return;
  if (nonInteractive === true) {
    throw new Error(
      "Git installs require --trust-source when running non-interactively",
    );
  }
  const approved = await confirm({
    message: `Trust and install ${ref} from ${remote}?`,
    initialValue: false,
  });
  if (isCancel(approved) || approved !== true) {
    throw new Error("Git source was not trusted; installation cancelled");
  }
};

const writeProvenance = async (args: {
  checkoutDir: string;
  remote: string;
  ref: string;
  pin?: string | null;
  resolvedCommit: string;
}): Promise<void> => {
  const { checkoutDir, remote, ref, pin, resolvedCommit } = args;
  const values: Array<[string, string]> = [
    ["nori.sourceRemote", normalizeRemote({ remote })],
    ["nori.sourceRef", ref],
    ["nori.sourceMode", pin == null ? "follow" : "pinned"],
    ["nori.resolvedCommit", resolvedCommit],
    ["nori.trusted", "true"],
  ];
  if (pin != null) values.push(["nori.sourcePin", pin]);
  for (const [key, value] of values) {
    await runGit({
      cwd: checkoutDir,
      command: ["config", "--local", key, value],
    });
  }
};

export const acquireGitSkillset = async (
  args: AcquireGitSkillsetArgs,
): Promise<AcquiredGitSkillset> => {
  const { slug, remote, pin, profilesDir, trustSource, nonInteractive } = args;
  const nameError = validateSkillsetName({ value: slug });
  if (nameError != null) throw new Error(nameError);
  if (pin != null && !/^[0-9a-f]{7,40}$/i.test(pin)) {
    throw new Error(
      "--pin must be a 7- to 40-character hexadecimal commit SHA",
    );
  }
  validateRemoteCredentials({ remote });
  const normalizedRemote = normalizeRemote({ remote });

  const ref = `refs/heads/skillsets/${slug}`;
  const targetDir = path.join(profilesDir, "personal", slug);
  const lockPath = `${targetDir}.install-lock`;
  try {
    await fs.lstat(targetDir);
    throw new Error(`Skillset "personal/${slug}" already exists`);
  } catch (error) {
    if (
      !(error != null && typeof error === "object" && "code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  await approveSource({ remote, ref, trustSource, nonInteractive });
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  let lock;
  try {
    lock = await fs.open(lockPath, "wx", 0o600);
  } catch (error) {
    if (
      error != null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw new Error(
        `An install for "personal/${slug}" is already in progress`,
      );
    }
    throw error;
  }
  await lock.close();
  let temporaryDir: string | null = null;

  try {
    temporaryDir = await fs.mkdtemp(
      path.join(path.dirname(targetDir), `.${slug}-install-`),
    );
    await runGit({
      command: [
        "clone",
        "--single-branch",
        "--branch",
        `skillsets/${slug}`,
        "--",
        normalizedRemote,
        temporaryDir,
      ],
    });

    if (pin != null) {
      try {
        await runGit({
          cwd: temporaryDir,
          command: ["merge-base", "--is-ancestor", `${pin}^{commit}`, "HEAD"],
        });
      } catch {
        throw new Error(`Pinned commit "${pin}" is not reachable from ${ref}`);
      }
      await runGit({
        cwd: temporaryDir,
        command: ["checkout", "--detach", pin],
      });
    }

    const resolvedCommit = await runGit({
      cwd: temporaryDir,
      command: ["rev-parse", "HEAD"],
    });
    await validateCheckout({ checkoutDir: temporaryDir, slug });
    await writeProvenance({
      checkoutDir: temporaryDir,
      remote: normalizedRemote,
      ref,
      pin,
      resolvedCommit,
    });
    if (await pathExists({ filePath: targetDir })) {
      throw new Error(`Skillset "personal/${slug}" already exists`);
    }
    await fs.rename(temporaryDir, targetDir);

    return {
      identity: `personal/${slug}`,
      checkoutDir: targetDir,
      resolvedCommit,
    };
  } catch (error) {
    if (temporaryDir != null) {
      await fs.rm(temporaryDir, { recursive: true, force: true });
    }
    throw error;
  } finally {
    await fs.rm(lockPath, { force: true });
  }
};

type GitInstallArgs = {
  slug: string;
  remote: string;
  pin?: string | null;
  installDir?: string | null;
  trustSource?: boolean | null;
  nonInteractive?: boolean | null;
  silent?: boolean | null;
};

const readOptionalFile = async (args: {
  filePath: string;
}): Promise<Buffer | null> => {
  try {
    return await fs.readFile(args.filePath);
  } catch (error) {
    if (
      error != null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
};

const restoreFile = async (args: {
  filePath: string;
  contents: Buffer | null;
}): Promise<void> => {
  const { filePath, contents } = args;
  if (contents == null) {
    await fs.rm(filePath, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents);
};

export const gitInstallMain = async (
  args: GitInstallArgs,
): Promise<CommandStatus> => {
  const { slug, remote, pin, installDir, trustSource, nonInteractive, silent } =
    args;
  if (silent === true) setSilentMode({ silent: true });
  const configBefore = await loadConfig();
  const configPath = getConfigPath();
  const configContentsBefore = await readOptionalFile({ filePath: configPath });
  const firstInstall = !hasExistingInstallation();
  const agents = getDefaultAgents({ config: configBefore });
  const resolvedInstallDir = resolveInstallDir({
    cliInstallDir: installDir,
    configInstallDir: configBefore?.installDir,
    agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
  });

  let acquired: AcquiredGitSkillset | null = null;
  const mutatedAgents: Array<string> = [];
  try {
    acquired = await acquireGitSkillset({
      slug,
      remote,
      pin,
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
      mutatedAgents.push(agentName);
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
    if (acquired != null) {
      const rollbackErrors: Array<string> = [];
      for (const agentName of mutatedAgents) {
        try {
          await removeSkillset({
            agent: AgentRegistry.getInstance().get({ name: agentName }),
            installDir: resolvedInstallDir.path,
          });
        } catch (rollbackError) {
          rollbackErrors.push(
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
          );
        }
      }
      await fs.rm(acquired.checkoutDir, { recursive: true, force: true });
      await restoreFile({
        filePath: configPath,
        contents: configContentsBefore,
      });
      if (configBefore?.activeSkillset != null) {
        for (const agentName of mutatedAgents) {
          try {
            await activateSkillset({
              installDir: resolvedInstallDir.path,
              agent: agentName,
              skillset: configBefore.activeSkillset,
              persistActiveSkillset: resolvedInstallDir.source !== "cli",
            });
          } catch (rollbackError) {
            rollbackErrors.push(
              rollbackError instanceof Error
                ? rollbackError.message
                : String(rollbackError),
            );
          }
        }
      }
      if (rollbackErrors.length > 0) {
        const originalMessage =
          error instanceof Error ? error.message : String(error);
        return {
          success: false,
          cancelled: false,
          message: `Failed to install Git-backed skillset "${slug}": ${originalMessage}. Rollback was incomplete: ${rollbackErrors.join("; ")}`,
        };
      }
    }
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
