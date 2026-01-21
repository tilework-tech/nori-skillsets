# Implementation Plan: Analytics API Spec Compliance

## Overview

Update all analytics event requests in the `codex-analytics-pass-y` worktree to comply with the new analytics proxy API specification defined in `../registrar/PLAN_ANALYTICS_PROXY.md`.

## Current State Analysis

### Files Sending Analytics Events

| File | Events Sent | Current Structure |
|------|-------------|-------------------|
| `src/cli/installTracking.ts` | `app_install`, `app_update`, `session_start`, `user_resurrected` | New structure (flat `properties` object) |
| `src/cli/commands/install/install.ts` | `plugin_install_started`, `plugin_install_completed` | Legacy (static `clientId: "plugin-installer"`) |
| `src/cli/commands/uninstall/uninstall.ts` | `plugin_uninstall_started`, `plugin_uninstall_completed` | Legacy |
| `src/cli/features/claude-code/hooks/config/autoupdate.ts` | `nori_session_started` | Legacy |
| `src/cli/features/cursor-agent/hooks/config/autoupdate.ts` | `nori_session_started` | Legacy |

### Problems with Current Implementation

1. **installTracking.ts**: Uses incorrect field names (`event` instead of `event_name`, `properties` instead of `event_params`, missing required `tilework_*` fields)

2. **Legacy trackEvent** (in `src/cli/analytics.ts`):
   - Uses static `clientId: "plugin-installer"` (violates GA4 best practices)
   - Uses camelCase field names (legacy format)
   - No `tilework_source`, `tilework_session_id`, `tilework_timestamp`
   - No `tilework_cli_*` parameters

## Target API Contract

Per `PLAN_ANALYTICS_PROXY.md`, all events must have:

```typescript
{
  client_id: string;           // Deterministic UUID from SHA256(nori_salt:hostname:username)
  user_id?: string | null;     // User email if authenticated
  event_name: string;          // Event identifier
  event_params: {
    // REQUIRED for all events
    tilework_source: string;          // "nori-skillsets"
    tilework_session_id: string;      // Unix timestamp in seconds
    tilework_timestamp: string;       // ISO 8601 timestamp

    // CLI-specific (prefixed with tilework_cli_*)
    tilework_cli_executable_name?: string;
    tilework_cli_installed_version?: string;
    tilework_cli_install_source?: string;      // "npm", "bun", "pnpm", "yarn", "unknown"
    tilework_cli_days_since_install?: number;
    tilework_cli_node_version?: string;        // Node.js version
    tilework_cli_profile?: string;             // Current skillset/profile name (e.g., "senior-swe")
    tilework_cli_install_type?: string;        // "paid" or "free"
    tilework_cli_is_first_install?: boolean;   // Only for install events
    tilework_cli_previous_version?: string;    // Only for upgrade events
    tilework_cli_update_available?: boolean;   // Only for session start (from autoupdate hook)
    tilework_cli_non_interactive?: boolean;    // Only for install/uninstall commands

    // Additional event-specific params
    [key: string]: unknown;
  };
}
```

## Legacy Event Params Preservation

The following params were sent by legacy events and must be preserved:

| Legacy Param | New Param | Source |
|--------------|-----------|--------|
| `installed_version` | `tilework_cli_installed_version` | autoupdate.ts |
| `update_available` | `tilework_cli_update_available` | autoupdate.ts |
| `install_type` | `tilework_cli_install_type` | autoupdate.ts, install.ts, uninstall.ts |
| `non_interactive` | `tilework_cli_non_interactive` | install.ts |
| `node_version` | `tilework_cli_node_version` | installTracking.ts (already captured) |
| (new) | `tilework_cli_profile` | config.agents[agent].profile.baseProfile |

## Implementation Steps

### Step 1: Create Shared Analytics Types and Constants

**File**: `src/cli/installTracking.ts`

Add new type definitions and constants:

```typescript
// Constants
const TILEWORK_SOURCE = "nori-skillsets";

// Type definitions matching API spec
type AnalyticsEventRequest = {
  client_id: string;
  user_id?: string | null;
  event_name: string;
  event_params: EventParams;
};

type EventParams = {
  tilework_source: string;
  tilework_session_id: string;
  tilework_timestamp: string;
  [key: string]: unknown;
};

type CLIEventParams = EventParams & {
  // Core CLI params (always present)
  tilework_cli_executable_name: string;
  tilework_cli_installed_version: string;
  tilework_cli_install_source: string;
  tilework_cli_days_since_install: number;
  tilework_cli_node_version: string;
  tilework_cli_profile: string | null;       // Current skillset/profile name
  tilework_cli_install_type: string;         // "paid" or "free"

  // Event-specific params (optional)
  tilework_cli_is_first_install?: boolean;   // install events only
  tilework_cli_previous_version?: string;    // upgrade events only
  tilework_cli_update_available?: boolean;   // session start only
  tilework_cli_non_interactive?: boolean;    // install/uninstall commands only
};
```

### Step 2: Create Reusable Helper Functions

**File**: `src/cli/installTracking.ts`

Add these exported functions:

```typescript
/**
 * Session ID generated once per process lifetime.
 * Per GA4 spec, all events in the same session should share this ID.
 */
const SESSION_ID = Math.floor(Date.now() / 1000).toString();

/**
 * Build the base event params required for ALL events.
 * Note: tilework_session_id is constant for the process lifetime,
 * while tilework_timestamp captures when each event is sent.
 */
export const buildBaseEventParams = (): EventParams => {
  return {
    tilework_source: TILEWORK_SOURCE,
    tilework_session_id: SESSION_ID,
    tilework_timestamp: new Date().toISOString(),
  };
};

/**
 * Build CLI-specific event params
 * Requires install state and config to be loaded first
 */
export const buildCLIEventParams = async (args: {
  state: InstallState;
  currentVersion: string;
  agentName?: string | null;
}): Promise<CLIEventParams> => {
  const { state, currentVersion, agentName } = args;
  const baseParams = buildBaseEventParams();

  const daysSinceInstall = Math.floor(
    (Date.now() - new Date(state.first_installed_at).getTime()) /
    (1000 * 60 * 60 * 24)
  );

  // Load config to get profile and install type
  const config = await getConfigForAnalytics();
  const profile = getProfileFromConfig({ config, agentName: agentName ?? "claude-code" });
  const installType = config?.auth ? "paid" : "free";

  return {
    ...baseParams,
    tilework_cli_executable_name: "nori-ai",
    tilework_cli_installed_version: currentVersion,
    tilework_cli_install_source: state.install_source,
    tilework_cli_days_since_install: daysSinceInstall,
    tilework_cli_node_version: process.versions.node,
    tilework_cli_profile: profile,
    tilework_cli_install_type: installType,
  };
};

/**
 * Get config for analytics (helper to avoid circular deps)
 */
const getConfigForAnalytics = async (): Promise<Config | null> => {
  try {
    const allInstallations = getInstallDirs({ currentDir: process.cwd() });
    if (allInstallations.length === 0) {
      return null;
    }
    const installDir = allInstallations[0];
    return await loadConfig({ installDir });
  } catch {
    return null;
  }
};

/**
 * Get profile name from config for a specific agent
 */
const getProfileFromConfig = (args: {
  config: Config | null;
  agentName: string;
}): string | null => {
  const { config, agentName } = args;
  if (config == null) {
    return null;
  }

  const agentConfig = config.agents?.[agentName];
  if (agentConfig?.profile?.baseProfile != null) {
    return agentConfig.profile.baseProfile;
  }

  // Fallback to legacy profile field
  if (config.profile?.baseProfile != null) {
    return config.profile.baseProfile;
  }

  return null;
};

/**
 * Get deterministic client ID (exported for use by other modules)
 */
export { getDeterministicClientId };

/**
 * Get user ID from config (email if authenticated)
 */
export const getUserId = async (): Promise<string | null> => {
  try {
    const allInstallations = getInstallDirs({ currentDir: process.cwd() });
    if (allInstallations.length === 0) {
      return null;
    }
    const installDir = allInstallations[0];
    const diskConfig = await loadConfig({ installDir });
    return diskConfig?.auth?.username || null;
  } catch {
    return null;
  }
};

/**
 * Send analytics event with proper structure
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
    .catch(() => {})
    .finally(() => clearTimeout(timeout));
};
```

### Step 3: Update trackInstallLifecycle

**File**: `src/cli/installTracking.ts`

Update the main function to use new event structure:

```typescript
export const trackInstallLifecycle = async (args: {
  currentVersion: string;
}): Promise<void> => {
  const { currentVersion } = args;

  try {
    const now = new Date().toISOString();
    const stateFromDisk = await readInstallState();
    const userId = await getUserId();

    let state = stateFromDisk;
    let isFirstInstall = false;
    let previousVersion: string | null = null;
    let eventToSend: "nori_install_completed" | null = null;

    if (state == null) {
      // First install
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
      eventToSend = "nori_install_completed";
      isFirstInstall = true;
    } else {
      // Existing install - check for version change
      if (!state.client_id) {
        state.client_id = getDeterministicClientId();
      }
      state.install_source = getInstallSource();

      if (
        semver.valid(currentVersion) != null &&
        semver.valid(state.installed_version) != null &&
        currentVersion !== state.installed_version
      ) {
        previousVersion = state.installed_version;
        state.installed_version = currentVersion;
        state.last_updated_at = now;
        eventToSend = "nori_install_completed";
        isFirstInstall = false;
      }
    }

    const isResurrected = stateFromDisk
      ? shouldTriggerResurrection(stateFromDisk)
      : false;

    state.last_launched_at = now;
    // ... rest of state updates ...

    await writeInstallState(state);

    if (isOptedOut(state)) {
      return;
    }

    // Build CLI event params
    const cliParams = buildCLIEventParams({ state, currentVersion });

    // Send resurrection event if applicable
    if (isResurrected) {
      sendAnalyticsEvent({
        eventName: "nori_user_resurrected",
        eventParams: cliParams,
        clientId: state.client_id,
        userId,
      });
    }

    // Send install/upgrade event if applicable
    if (eventToSend != null) {
      const installParams: CLIEventParams = {
        ...cliParams,
        tilework_cli_is_first_install: isFirstInstall,
      };
      if (previousVersion != null) {
        installParams.tilework_cli_previous_version = previousVersion;
      }

      sendAnalyticsEvent({
        eventName: eventToSend,
        eventParams: installParams,
        clientId: state.client_id,
        userId,
      });
    }

    // Always send session start
    sendAnalyticsEvent({
      eventName: "nori_session_start",
      eventParams: cliParams,
      clientId: state.client_id,
      userId,
    });
  } catch {
    // Silent failure
  }
};
```

### Step 4: Update Legacy analytics.ts

**File**: `src/cli/analytics.ts`

Replace the legacy implementation to delegate to installTracking:

```typescript
import {
  buildBaseEventParams,
  getDeterministicClientId,
  getUserId,
  sendAnalyticsEvent,
} from "@/cli/installTracking.js";

/**
 * Track analytics event (legacy API - delegates to new implementation)
 * @deprecated Use sendAnalyticsEvent from installTracking.ts directly
 */
export const trackEvent = async (args: {
  eventName: string;
  eventParams?: Record<string, any> | null;
}): Promise<void> => {
  const { eventName, eventParams } = args;

  try {
    const userId = await getUserId();
    const baseParams = buildBaseEventParams();

    sendAnalyticsEvent({
      eventName,
      eventParams: {
        ...baseParams,
        ...eventParams,
      },
      clientId: getDeterministicClientId(),
      userId,
    });
  } catch {
    // Silent failure
  }
};
```

### Step 5: Update Event Names in Callers

Update event names to match the spec (snake_case, `nori_` prefix):

| Current Event Name | New Event Name |
|-------------------|----------------|
| `plugin_install_started` | `nori_install_started` |
| `plugin_install_completed` | `nori_install_completed` |
| `plugin_uninstall_started` | `nori_uninstall_started` |
| `plugin_uninstall_completed` | `nori_uninstall_completed` |
| `nori_session_started` | `nori_session_start` |

**Files to update**:
- `src/cli/commands/install/install.ts` (4 calls)
- `src/cli/commands/uninstall/uninstall.ts` (2 calls)
- `src/cli/features/claude-code/hooks/config/autoupdate.ts` (1 call)
- `src/cli/features/cursor-agent/hooks/config/autoupdate.ts` (1 call)

### Step 6: Deprecate/Remove api/analytics.ts

**Option A** (Recommended): Keep for backward compatibility but mark as deprecated

The `api/analytics.ts` module is also used for other API calls (reports). Update it to:
1. Keep the report-related functions
2. Mark `trackEvent` as deprecated
3. Update tests accordingly

**Option B**: Remove entirely if no other callers exist

### Step 7: Update Tests

**Files**:
- `src/cli/installTracking.test.ts` - Update to test new event structure
- `src/api/analytics.test.ts` - Update or deprecate
- Mock the new helper functions where needed

### Step 8: Update Documentation

**Files**:
- `src/cli/docs.md`
- `src/api/docs.md`

## Event Mapping Summary

### Base CLI Params (all events)

All CLI events include these params:
- `tilework_source` = "nori-skillsets"
- `tilework_session_id` = Unix timestamp seconds
- `tilework_timestamp` = ISO 8601
- `tilework_cli_executable_name` = "nori-ai"
- `tilework_cli_installed_version` = current version
- `tilework_cli_install_source` = "npm" | "bun" | "pnpm" | "yarn" | "unknown"
- `tilework_cli_days_since_install` = integer
- `tilework_cli_node_version` = process.versions.node
- `tilework_cli_profile` = profile name or null (e.g., "senior-swe")
- `tilework_cli_install_type` = "paid" | "free"

### Event-Specific Params

| Event | When Sent | Additional Params |
|-------|-----------|-------------------|
| `nori_install_completed` | First install or version change | `tilework_cli_is_first_install`, `tilework_cli_previous_version` (on upgrade only) |
| `nori_session_start` | Every CLI launch (from autoupdate hook) | `tilework_cli_update_available` |
| `nori_user_resurrected` | Return after 30+ days | (none) |
| `nori_install_started` | Install command begins | `tilework_cli_non_interactive` |
| `nori_install_completed` | Install command ends | `tilework_cli_non_interactive` |
| `nori_uninstall_started` | Uninstall command begins | (none) |
| `nori_uninstall_completed` | Uninstall command ends | (none) |

### Example: nori_session_start Event

Note: `tilework_session_id` is constant for all events in the same CLI invocation, while `tilework_timestamp` reflects when each individual event was sent.

```json
{
  "client_id": "c4f24cc9-acde-4d20-87e1-1d6bfa8e7a67",
  "user_id": "clifford@tilework.tech",
  "event_name": "nori_session_start",
  "event_params": {
    "tilework_source": "nori-skillsets",
    "tilework_session_id": "1705681200",
    "tilework_timestamp": "2025-01-20T10:30:00.000Z",
    "tilework_cli_executable_name": "nori-ai",
    "tilework_cli_installed_version": "1.2.3",
    "tilework_cli_install_source": "npm",
    "tilework_cli_days_since_install": 5,
    "tilework_cli_node_version": "20.10.0",
    "tilework_cli_profile": "senior-swe",
    "tilework_cli_install_type": "paid",
    "tilework_cli_update_available": true
  }
}
```

## File Changes Summary

| File | Action |
|------|--------|
| `src/cli/installTracking.ts` | Major refactor - add types, helpers, update event structure |
| `src/cli/analytics.ts` | Refactor to delegate to installTracking |
| `src/api/analytics.ts` | Update types for new spec (snake_case) |
| `src/cli/commands/install/install.ts` | Update event names |
| `src/cli/commands/uninstall/uninstall.ts` | Update event names |
| `src/cli/features/claude-code/hooks/config/autoupdate.ts` | Update event name |
| `src/cli/features/cursor-agent/hooks/config/autoupdate.ts` | Update event name |
| `src/cli/installTracking.test.ts` | Update tests for new structure |
| `src/api/analytics.test.ts` | Update tests |

## Verification Checklist

### Required Fields (all events)
- [ ] All events include `client_id` (deterministic UUID, not static string)
- [ ] All events include `event_name` (snake_case)
- [ ] All events include `event_params.tilework_source` = "nori-skillsets"
- [ ] All events include `event_params.tilework_session_id` (Unix timestamp seconds, **constant per process**)
- [ ] All events include `event_params.tilework_timestamp` (ISO 8601, **generated per event**)

### CLI-Specific Fields (all CLI events)
- [ ] `tilework_cli_executable_name` = "nori-ai"
- [ ] `tilework_cli_installed_version` (semver string)
- [ ] `tilework_cli_install_source` ("npm", "bun", "pnpm", "yarn", "unknown")
- [ ] `tilework_cli_days_since_install` (integer)
- [ ] `tilework_cli_node_version` (process.versions.node)
- [ ] `tilework_cli_profile` (string or null - current skillset name)
- [ ] `tilework_cli_install_type` ("paid" or "free")

### Event-Specific Fields
- [ ] `nori_install_completed` includes `tilework_cli_is_first_install`
- [ ] `nori_install_completed` (upgrade) includes `tilework_cli_previous_version`
- [ ] `nori_session_start` includes `tilework_cli_update_available`
- [ ] `nori_install_started` includes `tilework_cli_non_interactive`
- [ ] `nori_install_completed` (command) includes `tilework_cli_non_interactive`

### Quality Checks
- [ ] All tests pass
- [ ] `npm run lint` passes
- [ ] `npm run format` passes
- [ ] No legacy `clientId: "plugin-installer"` remaining
- [ ] No camelCase field names in payloads
- [ ] `tilework_session_id` is generated once per process (not per event)
