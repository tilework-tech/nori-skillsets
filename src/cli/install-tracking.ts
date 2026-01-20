import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import semver from "semver";

type InstallState = {
  schema_version: 1;
  client_id: string;
  opt_out: boolean;
  first_installed_at: string;
  last_updated_at: string;
  last_launched_at: string;
  installed_version: string;
  install_source: string;
};

const DEFAULT_ANALYTICS_URL =
  "https://noriskillsets.dev/api/analytics/track";
const INSTALL_STATE_PATH = path.join(
  os.homedir(),
  ".nori",
  "profiles",
  ".nori-install.json",
);
const RESURRECTION_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

const ensureInstallStateDir = async (): Promise<void> => {
  await fs.mkdir(path.dirname(INSTALL_STATE_PATH), { recursive: true });
};

const parseInstallState = (raw: string): InstallState | null => {
  try {
    return JSON.parse(raw) as InstallState;
  } catch {
    return null;
  }
};

const readInstallState = async (): Promise<InstallState | null> => {
  try {
    const raw = await fs.readFile(INSTALL_STATE_PATH, "utf8");
    return parseInstallState(raw);
  } catch {
    return null;
  }
};

const writeInstallState = async (state: InstallState): Promise<void> => {
  await ensureInstallStateDir();
  await fs.writeFile(INSTALL_STATE_PATH, JSON.stringify(state, null, 2));
};

const deriveClientId = (): string => {
  const hostname = os.hostname();
  const username = os.userInfo().username;
  const hash = createHash("sha256")
    .update(`nori_salt:${hostname}:${username}`)
    .digest("hex");

  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(
    12,
    16,
  )}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
};

const detectInstallSource = (): string => {
  const agent = process.env.npm_config_user_agent ?? "";

  if (agent.includes("bun")) {
    return "bun";
  }

  if (agent.includes("pnpm")) {
    return "pnpm";
  }

  if (agent.includes("yarn")) {
    return "yarn";
  }

  if (agent.includes("npm")) {
    return "npm";
  }

  return "unknown";
};

const shouldOptOut = (state: InstallState): boolean => {
  if (process.env.NORI_NO_ANALYTICS === "1") {
    return true;
  }

  return state.opt_out === true;
};

const isCiEnv = (): boolean =>
  Boolean(
    process.env.CI ||
      process.env.GITHUB_ACTIONS ||
      process.env.GITLAB_CI ||
      process.env.BUILDKITE ||
      process.env.CIRCLECI ||
      process.env.TRAVIS ||
      process.env.BITBUCKET_BUILD_NUMBER,
  );

const isResurrected = (
  lastLaunchedAt: string | null | undefined,
  now: Date,
): boolean => {
  if (!lastLaunchedAt) {
    return false;
  }

  const last = Date.parse(lastLaunchedAt);
  if (Number.isNaN(last)) {
    return false;
  }

  return now.getTime() - last > RESURRECTION_THRESHOLD_MS;
};

const fireAndForget = (promise: Promise<void>): void => {
  void promise.catch(() => undefined);
};

const sendAnalyticsEvent = async (args: {
  event: string;
  clientId: string;
  sessionId: string;
  timestamp: string;
  version: string;
}): Promise<void> => {
  const { event, clientId, sessionId, timestamp, version } = args;
  const endpoint =
    process.env.NORI_ANALYTICS_URL ?? DEFAULT_ANALYTICS_URL;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  timeout.unref?.();

  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        client_id: clientId,
        session_id: sessionId,
        timestamp,
        properties: {
          version,
          os: process.platform,
          arch: process.arch,
          node_version: process.versions.node,
          is_ci: isCiEnv(),
        },
      }),
      signal: controller.signal,
    });
  } catch {
    // Silent failure - analytics should never block CLI usage
  } finally {
    clearTimeout(timeout);
  }
};

export const trackInstallLifecycle = async (args: {
  runningVersion: string;
}): Promise<void> => {
  const now = new Date();
  const timestamp = now.toISOString();
  const sessionId = randomUUID();
  const runningVersion = args.runningVersion || "unknown";

  const existingState = await readInstallState();
  const clientId = existingState?.client_id ?? deriveClientId();
  const installSource =
    existingState?.install_source ?? detectInstallSource();

  const state: InstallState = {
    schema_version: 1,
    client_id: clientId,
    opt_out: existingState?.opt_out ?? false,
    first_installed_at: existingState?.first_installed_at ?? timestamp,
    last_updated_at: existingState?.last_updated_at ?? timestamp,
    last_launched_at: existingState?.last_launched_at ?? timestamp,
    installed_version: existingState?.installed_version ?? runningVersion,
    install_source: installSource,
  };

  const events: string[] = [];
  if (!existingState) {
    state.first_installed_at = timestamp;
    state.last_updated_at = timestamp;
    state.installed_version = runningVersion;
    events.push("app_install");
  } else {
    if (
      semver.valid(runningVersion) != null &&
      semver.valid(state.installed_version) != null &&
      semver.gt(runningVersion, state.installed_version)
    ) {
      state.installed_version = runningVersion;
      state.last_updated_at = timestamp;
      events.push("app_update");
    }

    if (isResurrected(state.last_launched_at, now)) {
      events.push("user_resurrected");
    }
  }

  state.last_launched_at = timestamp;

  await writeInstallState(state);

  if (shouldOptOut(state)) {
    return;
  }

  const orderedEvents = [
    ...events.filter((event) => event === "user_resurrected"),
    ...events.filter((event) => event !== "user_resurrected"),
    "session_start",
  ];

  orderedEvents.forEach((event) => {
    fireAndForget(
      sendAnalyticsEvent({
        event,
        clientId: state.client_id,
        sessionId,
        timestamp,
        version: runningVersion,
      }),
    );
  });
};
