import { execFile } from "node:child_process";
import * as path from "node:path";

const HFS_IGNORED_CODE_POINTS =
  /[\u200C-\u200F\u202A-\u202E\u206A-\u206F\uFEFF]/gu;

export type TrackedGitEntry = {
  mode: string;
  path: string;
};

const normalizeReservedRootPath = (entryPath: string): string => {
  const [rootEntry = ""] = entryPath.split("/");
  return rootEntry
    .normalize("NFKC")
    .replace(HFS_IGNORED_CODE_POINTS, "")
    .toLowerCase();
};

export const validateGitPackageEntries = (args: {
  output: string;
}): Array<TrackedGitEntry> => {
  const entries = args.output
    .split("\0")
    .filter((record) => record.length > 0)
    .map((record) => {
      const match = /^(\d{6}) [0-9a-f]+ \d+\t([\s\S]+)$/u.exec(record);
      if (match == null) {
        throw new Error("Git returned invalid tracked-entry output");
      }
      return { mode: match[1], path: match[2] };
    });

  if (
    entries.some(
      (entry) => normalizeReservedRootPath(entry.path) === ".nori-version",
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

  const manifests = entries.filter(
    (entry) => normalizeReservedRootPath(entry.path) === "nori.json",
  );
  const manifest = manifests[0];
  if (
    manifests.length !== 1 ||
    manifest == null ||
    manifest.path !== "nori.json" ||
    (manifest.mode !== "100644" && manifest.mode !== "100755")
  ) {
    throw new Error(
      "Git-backed skillsets require an exact root nori.json regular file",
    );
  }

  return entries;
};

export const GIT_TIMEOUT_MS = 60_000;
const MINIMUM_GIT_VERSION = { major: 2, minor: 29 } as const;
const SSH_BATCH_MODE_DISABLED = /batchmode(?:\s*=\s*|\s+)["']?no\b/iu;
const SUPPORTED_REMOTE_SCHEMES = new Set([
  "file",
  "git",
  "git+ssh",
  "http",
  "https",
  "ssh",
]);
const SCP_USER_INFO_PATTERN = /^([^@/\\\s:]+)@(\[[^\]\s]+\]|[^/\\\s:]+):/u;
const GIT_ROUTING_ENVIRONMENT = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_SHALLOW_FILE",
] as const;

export const sanitizeDisplayText = (args: { value: string }): string =>
  args.value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "?");

export const assertSupportedRemote = (args: { remote: string }): void => {
  if (/^[^:/\\]+::/u.test(args.remote)) {
    throw new Error("Git remote-helper URLs are not supported");
  }
  const scheme = args.remote.match(/^([^:/\\]+):\/\//u)?.[1]?.toLowerCase();
  if (scheme != null && !SUPPORTED_REMOTE_SCHEMES.has(scheme)) {
    throw new Error(`Unsupported Git remote scheme "${scheme}"`);
  }
};

export const redactRemote = (args: { remote: string }): string => {
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

export const credentialFreeRemote = (args: { remote: string }): string => {
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

export const baseGitEnvironment = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const name of GIT_ROUTING_ENVIRONMENT) delete env[name];
  return env;
};

export const isSshRemote = (args: { remote: string }): boolean => {
  const { remote } = args;
  const scheme = remote
    .match(/^([a-z][a-z0-9+.-]*):\/\//iu)?.[1]
    ?.toLowerCase();
  if (scheme != null) return scheme === "ssh" || scheme === "git+ssh";
  if (/^[a-z]:[\\/]/iu.test(remote)) return false;
  return /^[^/\\]+:.+/u.test(remote);
};

export const normalizeAcquisitionRemote = (args: {
  remote: string;
}): string => {
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

export const sanitizeGitError = (args: {
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

export type GitExecution = {
  error: unknown;
  exitCode: string | number | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
};

export const executeGit = async (args: {
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

export const failedGitCommand = (args: {
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

export const runGit = async (args: {
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

export const assertSupportedGitVersion = async (): Promise<void> => {
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

export const isAncestor = async (args: {
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
