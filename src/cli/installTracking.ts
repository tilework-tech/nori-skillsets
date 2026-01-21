import { promises as fs } from "fs";
import { createHash } from "node:crypto";
import * as os from "os";
import * as path from "path";

import semver from "semver";

import { loadConfig, type Config } from "@/cli/config.js";
import { getCurrentPackageVersion } from "@/cli/version.js";
import { getInstallDirs } from "@/utils/path.js";

const DEFAULT_ANALYTICS_URL = "https://noriskillsets.dev/api/analytics/track";
const INSTALL_STATE_SCHEMA_VERSION = 1;
const INSTALL_STATE_FILE = ".nori-install.json";
const RESURRECTION_THRESHOLD_DAYS = 30;
const TILEWORK_SOURCE = "nori-skillsets";

/**
 * Session ID generated once per process lifetime.
 * Per GA4 spec, all events in the same session should share this ID.
 * Using Unix timestamp in seconds as recommended.
 */
const SESSION_ID = Math.floor(Date.now() / 1000).toString();

/**
 * Type definitions matching the PLAN_ANALYTICS_PROXY.md API spec
 */
export type EventParams = {
  tilework_source: string;
  tilework_session_id: string;
  tilework_timestamp: string;
  [key: string]: unknown;
};

/**
 * CLI-specific event params extending base EventParams
 */
export type CLIEventParams = EventParams & {
  tilework_cli_executable_name: string;
  tilework_cli_installed_version: string;
  tilework_cli_install_source: string;
  tilework_cli_days_since_install: number;
  tilework_cli_node_version: string;
  tilework_cli_profile: string | null;
  tilework_cli_install_type: "paid" | "free";
};

type AnalyticsEventRequest = {
  client_id: string;
  user_id?: string | null;
  event_name: string;
  event_params: EventParams;
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

const getInstallStatePath = (): string => {
  return path.join(os.homedir(), ".nori", "profiles", INSTALL_STATE_FILE);
};

const isOptedOut = (state: InstallState | null): boolean => {
  if (process.env.NORI_NO_ANALYTICS === "1") {
    return true;
  }

  return state?.opt_out === true;
};

const getInstallSource = (): string => {
  const userAgent = process.env.npm_config_user_agent ?? "";

  if (userAgent.includes("bun")) {
    return "bun";
  }

  if (userAgent.includes("pnpm")) {
    return "pnpm";
  }

  if (userAgent.includes("yarn")) {
    return "yarn";
  }

  if (userAgent.includes("npm")) {
    return "npm";
  }

  return "unknown";
};

const formatHashAsUuid = (hash: string): string => {
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");
};

export const getDeterministicClientId = (): string => {
  let username = "unknown";
  try {
    username = os.userInfo().username;
  } catch {
    username = process.env.USER ?? process.env.USERNAME ?? "unknown";
  }

  const hostname = os.hostname();
  const hash = createHash("sha256")
    .update(`nori_salt:${hostname}:${username}`)
    .digest("hex");
  return formatHashAsUuid(hash);
};

/**
 * Build the base event params required for ALL events.
 * Note: tilework_session_id is constant for the process lifetime,
 * while tilework_timestamp captures when each event is sent.
 * @returns Base event params with tilework_source, tilework_session_id, and tilework_timestamp
 */
export const buildBaseEventParams = (): EventParams => {
  return {
    tilework_source: TILEWORK_SOURCE,
    tilework_session_id: SESSION_ID,
    tilework_timestamp: new Date().toISOString(),
  };
};

/**
 * Send analytics event with proper structure matching PLAN_ANALYTICS_PROXY.md
 * @param args - Event arguments
 * @param args.eventName - Name of the event (e.g., "claude_session_started")
 * @param args.eventParams - Event parameters including tilework_* fields
 * @param args.clientId - Optional client ID (defaults to deterministic ID)
 * @param args.userId - Optional user ID for cross-device tracking
 */
export const sendAnalyticsEvent = (args: {
  eventName: string;
  eventParams: EventParams;
  clientId?: string | null;
  userId?: string | null;
}): void => {
  const { eventName, eventParams, clientId, userId } = args;

  const payload: AnalyticsEventRequest = {
    client_id: clientId ?? getDeterministicClientId(),
    event_name: eventName,
    event_params: eventParams,
  };

  if (userId != null) {
    payload.user_id = userId;
  }

  const analyticsUrl = process.env.NORI_ANALYTICS_URL ?? DEFAULT_ANALYTICS_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  timeout.unref?.();

  void fetch(analyticsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
    .catch(() => {
      // Silent failure
    })
    .finally(() => {
      clearTimeout(timeout);
    });
};

/**
 * Load config for analytics without failing.
 * @returns Config or null if not found
 */
const loadConfigForAnalytics = async (): Promise<Config | null> => {
  try {
    const installations = getInstallDirs({ currentDir: process.cwd() });
    if (installations.length === 0) return null;
    return await loadConfig({ installDir: installations[0] });
  } catch {
    return null;
  }
};

/**
 * Get user ID (email) from config for cross-device tracking.
 * @param args - Optional arguments
 * @param args.config - Pre-loaded config (optional, will load if not provided).
 *   Pass `null` explicitly to skip loading config and return null.
 *
 * @returns User email or null if not authenticated
 */
export const getUserId = async (args?: {
  config?: Config | null;
}): Promise<string | null> => {
  // If config is explicitly passed (even if null), use it. Only load from disk
  // when config is not provided at all (args is undefined or config key is missing).
  const hasExplicitConfig = args != null && "config" in args;
  const config = hasExplicitConfig
    ? args.config
    : await loadConfigForAnalytics();
  return config?.auth?.username ?? null;
};

/**
 * Build CLI-specific event params with all standard tilework_cli_* fields.
 * Loads config and install state to populate fields automatically.
 * @param args - Optional arguments
 * @param args.config - Pre-loaded config (optional, will load if not provided)
 * @param args.agentName - Agent name for profile lookup (default: "claude-code")
 * @param args.currentVersion - Current CLI version (optional, reads from package if not provided)
 *
 * @returns CLI event params including base params and all tilework_cli_* fields
 */
export const buildCLIEventParams = async (args?: {
  config?: Config | null;
  agentName?: string | null;
  currentVersion?: string | null;
}): Promise<CLIEventParams> => {
  const { config: providedConfig, agentName, currentVersion } = args ?? {};

  // Load config if not provided
  const config = providedConfig ?? (await loadConfigForAnalytics());

  // Load install state for days_since_install and install_source
  const state = await readInstallState();

  // Get version
  const version = currentVersion ?? getCurrentPackageVersion() ?? "unknown";

  // Calculate days since install
  const daysSinceInstall =
    state?.first_installed_at != null
      ? Math.floor(
          (Date.now() - new Date(state.first_installed_at).getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : 0;

  // Get profile from config
  const agent = agentName ?? "claude-code";
  const profile = config?.agents?.[agent]?.profile?.baseProfile ?? null;

  // Determine install type
  const installType: "paid" | "free" =
    config?.auth?.username != null ? "paid" : "free";

  return {
    ...buildBaseEventParams(),
    tilework_cli_executable_name: "nori-ai",
    tilework_cli_installed_version: version,
    tilework_cli_install_source: state?.install_source ?? getInstallSource(),
    tilework_cli_days_since_install: daysSinceInstall,
    tilework_cli_node_version: process.versions.node,
    tilework_cli_profile: profile,
    tilework_cli_install_type: installType,
  };
};

/**
 * Read install state from disk.
 * @returns Install state or null if not found
 */
export const readInstallState = async (): Promise<InstallState | null> => {
  const filePath = getInstallStatePath();

  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as InstallState;
  } catch {
    return null;
  }
};

const writeInstallState = async (state: InstallState): Promise<void> => {
  const filePath = getInstallStatePath();
  const dirPath = path.dirname(filePath);

  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`);
};

const shouldTriggerResurrection = (state: InstallState): boolean => {
  if (!state.last_launched_at) {
    return false;
  }

  const lastLaunch = new Date(state.last_launched_at).getTime();
  if (Number.isNaN(lastLaunch)) {
    return false;
  }

  const thresholdMs = RESURRECTION_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - lastLaunch > thresholdMs;
};

export const trackInstallLifecycle = async (args: {
  currentVersion: string;
}): Promise<void> => {
  const { currentVersion } = args;

  try {
    const now = new Date().toISOString();
    const stateFromDisk = await readInstallState();

    let state = stateFromDisk;
    let isFirstInstall = false;
    let previousVersion: string | null = null;
    let shouldSendInstallEvent = false;

    if (state == null) {
      const clientId = getDeterministicClientId();
      state = {
        schema_version: INSTALL_STATE_SCHEMA_VERSION,
        client_id: clientId,
        opt_out: false,
        first_installed_at: now,
        last_updated_at: now,
        last_launched_at: now,
        installed_version: currentVersion,
        install_source: getInstallSource(),
      };
      shouldSendInstallEvent = true;
      isFirstInstall = true;
    } else {
      if (!state.client_id) {
        state.client_id = getDeterministicClientId();
      }

      // Always update install_source to current value (user may have switched package managers)
      state.install_source = getInstallSource();

      if (
        semver.valid(currentVersion) != null &&
        semver.valid(state.installed_version) != null &&
        semver.gt(currentVersion, state.installed_version)
      ) {
        previousVersion = state.installed_version;
        state.installed_version = currentVersion;
        state.last_updated_at = now;
        shouldSendInstallEvent = true;
        isFirstInstall = false;
      }
    }

    const isResurrected = stateFromDisk
      ? shouldTriggerResurrection(stateFromDisk)
      : false;

    state.last_launched_at = now;
    state.schema_version = INSTALL_STATE_SCHEMA_VERSION;

    if (!state.first_installed_at) {
      state.first_installed_at = now;
    }

    if (!state.last_updated_at) {
      state.last_updated_at = now;
    }

    await writeInstallState(state);

    if (isOptedOut(state)) {
      return;
    }

    // Calculate days since install
    const daysSinceInstall = Math.floor(
      (Date.now() - new Date(state.first_installed_at).getTime()) /
        (1000 * 60 * 60 * 24),
    );

    // Build CLI-specific event params per PLAN_ANALYTICS_PROXY.md
    const cliEventParams: EventParams = {
      ...buildBaseEventParams(),
      tilework_cli_executable_name: "nori-ai",
      tilework_cli_installed_version: currentVersion,
      tilework_cli_install_source: state.install_source,
      tilework_cli_days_since_install: daysSinceInstall,
      tilework_cli_node_version: process.versions.node,
    };

    // Send resurrection event if applicable
    if (isResurrected) {
      sendAnalyticsEvent({
        eventName: "noriprof_user_resurrected",
        eventParams: cliEventParams,
        clientId: state.client_id,
      });
    }

    // Send install/upgrade event if applicable
    if (shouldSendInstallEvent) {
      const installParams: EventParams = {
        ...cliEventParams,
        tilework_cli_is_first_install: isFirstInstall,
      };
      if (previousVersion != null) {
        installParams.tilework_cli_previous_version = previousVersion;
      }

      sendAnalyticsEvent({
        eventName: "noriprof_install_detected",
        eventParams: installParams,
        clientId: state.client_id,
      });
    }
  } catch {
    // Silent failure - analytics should never block CLI
  }
};
