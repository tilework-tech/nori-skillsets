import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import semver from "semver";

import { exchangeRefreshToken } from "@/api/refreshToken.js";
import { loadConfig, type Config } from "@/cli/config.js";
import { getHomeDir } from "@/utils/home.js";

const DEFAULT_ANALYTICS_URL =
  "https://login.norisessions.com/api/analytics/v1/events";
const INSTALL_STATE_SCHEMA_VERSION = 1;
const INSTALL_STATE_FILE = ".nori-install.json";
const REQUEST_TIMEOUT_MS = 250;

const COMMAND_ALLOWLIST = new Set([
  "init",
  "search",
  "download",
  "upload",
  "install",
  "switch",
  "link",
  "unlink",
  "list",
  "list-active",
  "list-agents",
  "current",
  "download-skill",
  "upload-skill",
  "download-subagent",
  "external",
  "dir",
  "install-location",
  "fork",
  "new",
  "register",
  "import-mcp",
  "edit",
  "clear",
  "clear-current",
  "factory-reset",
  "config",
]);

const COMMAND_ALIASES: Readonly<Record<string, string>> = {
  "fork-skillset": "fork",
  "fork-skillsets": "fork",
  "new-skillset": "new",
  "register-skillset": "register",
  "edit-skillset": "edit",
  "edit-skillsets": "edit",
  "switch-skillset": "switch",
  "switch-skillsets": "switch",
  use: "switch",
  "list-skillsets": "list",
  "list-skillset": "list",
  ls: "list",
  la: "list-active",
  "current-skillset": "current",
  location: "install-location",
  cc: "clear-current",
};

type AnalyticsResult = "success" | "failure";
type InstallKind = "first_install" | "update" | "reinstall";

type AnalyticsEnvelope = {
  schema_version: 1;
  event:
    | "skillsets_command_completed"
    | "skillsets_install_started"
    | "skillsets_install_completed";
  activity_id: string;
  occurred_at: string;
  product: "skillsets";
  surface: "cli";
  app_version: string;
  properties?: Record<string, string>;
};

type InstallState = {
  schema_version: number;
  client_id: string;
  opt_out: boolean;
  first_installed_at: string;
  last_updated_at: string;
  last_launched_at: string;
  installed_version: string;
  install_source: string;
};

export type InstallAnalyticsContext = {
  activityId: string;
  installKind: InstallKind;
  currentVersion: string;
};

type ActiveCommand = {
  command: string;
  currentVersion: string;
};

const pendingCaptures = new Set<Promise<void>>();
const installStartedCaptures = new Map<string, Promise<void>>();
let activeCommand: ActiveCommand | null = null;
let pendingLaunchInstallContext: InstallAnalyticsContext | null = null;
let explicitInstallLifecycleClaimed = false;

const getInstallStatePath = (): string =>
  path.join(getHomeDir(), ".nori", "profiles", INSTALL_STATE_FILE);

const getInstallSource = (): string => {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.includes("bun")) return "bun";
  if (userAgent.includes("pnpm")) return "pnpm";
  if (userAgent.includes("yarn")) return "yarn";
  if (userAgent.includes("npm")) return "npm";
  return "unknown";
};

const loadConfigForAnalytics = async (): Promise<Config | null> => {
  try {
    return await loadConfig();
  } catch {
    return null;
  }
};

const isHumanIdentity = (username: string | null | undefined): boolean => {
  if (username == null) return false;
  const normalized = username.trim().toLowerCase();
  return normalized.includes("@") && !normalized.startsWith("nori-service:");
};

const getFirebaseIdToken = async (
  config: Config | null,
  signal: AbortSignal,
): Promise<string | null> => {
  const auth = config?.auth;
  if (!isHumanIdentity(auth?.username)) return null;

  if (
    auth?.idToken != null &&
    auth.idToken !== "" &&
    typeof auth.idTokenExpiresAt === "number" &&
    Date.now() < auth.idTokenExpiresAt
  ) {
    return auth.idToken;
  }

  if (auth?.refreshToken == null || auth.refreshToken === "") return null;

  try {
    const refreshed = await exchangeRefreshToken({
      refreshToken: auth.refreshToken,
      signal,
    });
    return refreshed.idToken;
  } catch {
    return null;
  }
};

const isOptedOut = (state: InstallState | null): boolean =>
  process.env.NORI_NO_ANALYTICS === "1" || state?.opt_out === true;

const capture = async (envelope: AnalyticsEnvelope): Promise<void> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const state = await readInstallState();
    if (isOptedOut(state)) return;

    const config = await loadConfigForAnalytics();
    const idToken = await getFirebaseIdToken(config, controller.signal);
    if (idToken == null) return;

    await fetch(process.env.NORI_ANALYTICS_URL ?? DEFAULT_ANALYTICS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    });
  } catch {
    // Analytics is best-effort and must never affect CLI behavior.
  } finally {
    clearTimeout(timeout);
  }
};

const queueCapture = (
  envelope: AnalyticsEnvelope,
  after: Promise<void> = Promise.resolve(),
): Promise<void> => {
  const request = after
    .then(() => capture(envelope))
    .catch(() => undefined)
    .finally(() => pendingCaptures.delete(request));
  pendingCaptures.add(request);
  return request;
};

const buildEnvelope = (args: {
  event: AnalyticsEnvelope["event"];
  currentVersion: string;
  activityId?: string;
  properties?: Record<string, string>;
}): AnalyticsEnvelope => {
  const { event, currentVersion, activityId, properties } = args;
  return {
    schema_version: 1,
    event,
    activity_id: activityId ?? randomUUID(),
    occurred_at: new Date().toISOString(),
    product: "skillsets",
    surface: "cli",
    app_version: currentVersion,
    ...(properties == null ? {} : { properties }),
  };
};

export const flushProductAnalytics = async (args: {
  timeoutMs: number;
}): Promise<void> => {
  const requests = [...pendingCaptures];
  if (requests.length === 0) return;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled(requests),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, Math.max(0, args.timeoutMs));
        timeout.unref?.();
      }),
    ]);
  } catch {
    // Analytics is best-effort.
  } finally {
    if (timeout != null) clearTimeout(timeout);
    for (const request of requests) pendingCaptures.delete(request);
  }
};

export const readInstallState = async (): Promise<InstallState | null> => {
  try {
    return JSON.parse(
      await fs.readFile(getInstallStatePath(), "utf8"),
    ) as InstallState;
  } catch {
    return null;
  }
};

const writeInstallState = async (state: InstallState): Promise<void> => {
  const statePath = getInstallStatePath();
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
};

const classifyInstall = (args: {
  previousVersion: string | null;
  currentVersion: string;
  explicitInstall: boolean;
}): InstallKind | null => {
  const { previousVersion, currentVersion, explicitInstall } = args;
  if (previousVersion == null) return "first_install";
  if (
    semver.valid(previousVersion) != null &&
    semver.valid(currentVersion) != null &&
    semver.gt(currentVersion, previousVersion)
  ) {
    return "update";
  }
  return explicitInstall ? "reinstall" : null;
};

export const trackInstallStarted = async (args: {
  currentVersion: string;
  explicitInstall?: boolean;
}): Promise<InstallAnalyticsContext | null> => {
  try {
    const now = new Date().toISOString();
    const previous = await readInstallState();
    const installKind = classifyInstall({
      previousVersion: previous?.installed_version ?? null,
      currentVersion: args.currentVersion,
      explicitInstall: args.explicitInstall === true,
    });
    const shouldAdvanceVersion =
      previous == null ||
      (semver.valid(args.currentVersion) != null &&
        semver.valid(previous.installed_version) != null &&
        semver.gt(args.currentVersion, previous.installed_version));

    const state: InstallState = {
      schema_version: INSTALL_STATE_SCHEMA_VERSION,
      client_id: previous?.client_id || randomUUID(),
      opt_out: previous?.opt_out === true,
      first_installed_at: previous?.first_installed_at || now,
      last_updated_at: shouldAdvanceVersion
        ? now
        : previous?.last_updated_at || now,
      last_launched_at: now,
      installed_version: shouldAdvanceVersion
        ? args.currentVersion
        : previous?.installed_version || args.currentVersion,
      install_source: previous?.install_source || getInstallSource(),
    };
    await writeInstallState(state);

    if (installKind == null || isOptedOut(state)) return null;

    const context: InstallAnalyticsContext = {
      activityId: randomUUID(),
      installKind,
      currentVersion: args.currentVersion,
    };
    const startedCapture = queueCapture(
      buildEnvelope({
        event: "skillsets_install_started",
        activityId: context.activityId,
        currentVersion: context.currentVersion,
        properties: { install_kind: context.installKind },
      }),
    );
    installStartedCaptures.set(context.activityId, startedCapture);
    return context;
  } catch {
    return null;
  }
};

export const trackInstallCompleted = async (args: {
  context: InstallAnalyticsContext | null;
  result: AnalyticsResult;
}): Promise<void> => {
  if (args.context == null) return;
  const startedCapture =
    installStartedCaptures.get(args.context.activityId) ?? Promise.resolve();
  const completedCapture = queueCapture(
    buildEnvelope({
      event: "skillsets_install_completed",
      activityId: args.context.activityId,
      currentVersion: args.context.currentVersion,
      properties: {
        install_kind: args.context.installKind,
        result: args.result,
      },
    }),
    startedCapture,
  );
  void completedCapture.finally(() => {
    installStartedCaptures.delete(args.context!.activityId);
  });
  if (pendingLaunchInstallContext?.activityId === args.context.activityId) {
    pendingLaunchInstallContext = null;
  }
};

export const beginLaunchInstallLifecycle = async (args: {
  currentVersion: string;
}): Promise<void> => {
  explicitInstallLifecycleClaimed = false;
  pendingLaunchInstallContext = await trackInstallStarted({
    currentVersion: args.currentVersion,
  });
};

export const claimInstallLifecycleForExplicitRun = async (args: {
  currentVersion: string;
}): Promise<InstallAnalyticsContext | null> => {
  if (explicitInstallLifecycleClaimed) return null;
  explicitInstallLifecycleClaimed = true;

  if (pendingLaunchInstallContext != null) {
    return pendingLaunchInstallContext;
  }

  pendingLaunchInstallContext = await trackInstallStarted({
    currentVersion: args.currentVersion,
    explicitInstall: true,
  });
  return pendingLaunchInstallContext;
};

export const completeUnclaimedInstallLifecycle = async (): Promise<void> => {
  if (explicitInstallLifecycleClaimed) return;
  const context = pendingLaunchInstallContext;
  pendingLaunchInstallContext = null;
  await trackInstallCompleted({ context, result: "success" });
};

export const trackInstallLifecycle = async (args: {
  currentVersion: string;
  explicitInstall?: boolean;
}): Promise<void> => {
  const context = await trackInstallStarted(args);
  await trackInstallCompleted({ context, result: "success" });
};

export const canonicalAnalyticsCommand = (command: string): string | null => {
  const canonical = COMMAND_ALIASES[command] ?? command;
  return COMMAND_ALLOWLIST.has(canonical) ? canonical : null;
};

export const trackCommandCompleted = async (args: {
  command: string;
  result: AnalyticsResult;
  currentVersion: string;
}): Promise<void> => {
  const command = canonicalAnalyticsCommand(args.command);
  if (command == null) return;
  queueCapture(
    buildEnvelope({
      event: "skillsets_command_completed",
      currentVersion: args.currentVersion,
      properties: { command, result: args.result },
    }),
  );
};

export const setActiveCommandForAnalytics = (args: {
  command: string;
  currentVersion: string;
}): void => {
  const command = canonicalAnalyticsCommand(args.command);
  activeCommand =
    command == null ? null : { command, currentVersion: args.currentVersion };
};

export const clearActiveCommandForAnalytics = (): void => {
  activeCommand = null;
};

export const trackActiveCommandSuccess = async (): Promise<void> => {
  const current = activeCommand;
  activeCommand = null;
  if (current == null) return;
  await trackCommandCompleted({ ...current, result: "success" });
};

export const trackActiveCommandFailure = async (): Promise<void> => {
  const current = activeCommand;
  activeCommand = null;
  if (current == null) return;
  await trackCommandCompleted({ ...current, result: "failure" });
};

export const exitAfterAnalyticsFailure = async (): Promise<never> => {
  await completeUnclaimedInstallLifecycle();
  await trackActiveCommandFailure();
  await flushProductAnalytics({ timeoutMs: 250 });
  process.exit(1);
};
