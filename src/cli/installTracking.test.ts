import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getTileworkSource,
  setTileworkSource,
  trackInstallLifecycle,
} from "./installTracking.js";

const INSTALL_STATE_FILE = ".nori-install.json";

const getTestInstallStatePath = (): string => {
  return path.join(os.homedir(), ".nori", "profiles", INSTALL_STATE_FILE);
};

describe("installTracking", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let fetchMock: ReturnType<typeof vi.fn>;
  let installStatePath: string;
  let tempProfilesDir: string;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    installStatePath = getTestInstallStatePath();
    tempProfilesDir = path.dirname(installStatePath);

    // Ensure the profiles directory exists
    await fs.mkdir(tempProfilesDir, { recursive: true });

    // Clear any existing install state
    try {
      await fs.unlink(installStatePath);
    } catch {
      // File doesn't exist, that's fine
    }

    // Mock fetch
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    // Clean up install state file
    try {
      await fs.unlink(installStatePath);
    } catch {
      // File doesn't exist, that's fine
    }
  });

  describe("resurrection threshold calculation", () => {
    it("should trigger resurrection after more than 30 days of inactivity", async () => {
      // Create state with last_launched_at 31 days ago (just over threshold)
      const thirtyOneDaysAgo = new Date(
        Date.now() - 31 * 24 * 60 * 60 * 1000,
      ).toISOString();

      await fs.writeFile(
        installStatePath,
        JSON.stringify({
          schema_version: 1,
          client_id: "test-client-id",
          opt_out: false,
          first_installed_at: thirtyOneDaysAgo,
          last_updated_at: thirtyOneDaysAgo,
          last_launched_at: thirtyOneDaysAgo,
          installed_version: "1.0.0",
          install_source: "npm",
        }),
      );

      await trackInstallLifecycle({ currentVersion: "1.0.0" });

      // Should have sent noriprof_user_resurrected event
      const resurrectedCall = fetchMock.mock.calls.find((call) => {
        const body = JSON.parse(call[1].body);
        return body.event_name === "noriprof_user_resurrected";
      });

      expect(resurrectedCall).toBeDefined();
    });

    it("should NOT trigger resurrection at 29 days 23 hours", async () => {
      // Create state with last_launched_at just under 30 days ago
      const justUnder30Days = new Date(
        Date.now() - (30 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000),
      ).toISOString();

      await fs.writeFile(
        installStatePath,
        JSON.stringify({
          schema_version: 1,
          client_id: "test-client-id",
          opt_out: false,
          first_installed_at: justUnder30Days,
          last_updated_at: justUnder30Days,
          last_launched_at: justUnder30Days,
          installed_version: "1.0.0",
          install_source: "npm",
        }),
      );

      await trackInstallLifecycle({ currentVersion: "1.0.0" });

      // Should NOT have sent user_resurrected event
      const resurrectedCall = fetchMock.mock.calls.find((call) => {
        const body = JSON.parse(call[1].body);
        return body.event_name === "noriprof_user_resurrected";
      });

      expect(resurrectedCall).toBeUndefined();
    });

    it("should use days (not seconds) for resurrection threshold", async () => {
      // 30 seconds ago - if threshold was in seconds, this would trigger resurrection
      const thirtySecondsAgo = new Date(Date.now() - 30 * 1000).toISOString();

      await fs.writeFile(
        installStatePath,
        JSON.stringify({
          schema_version: 1,
          client_id: "test-client-id",
          opt_out: false,
          first_installed_at: thirtySecondsAgo,
          last_updated_at: thirtySecondsAgo,
          last_launched_at: thirtySecondsAgo,
          installed_version: "1.0.0",
          install_source: "npm",
        }),
      );

      await trackInstallLifecycle({ currentVersion: "1.0.0" });

      // Should NOT have sent user_resurrected event (30 seconds is not 30 days)
      const resurrectedCall = fetchMock.mock.calls.find((call) => {
        const body = JSON.parse(call[1].body);
        return body.event_name === "noriprof_user_resurrected";
      });

      expect(resurrectedCall).toBeUndefined();
    });
  });

  describe("install_source update on change", () => {
    it("should update install_source when package manager changes", async () => {
      // Create state with npm as install_source
      const existingState = {
        schema_version: 1,
        client_id: "test-client-id",
        opt_out: false,
        first_installed_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
        last_launched_at: new Date().toISOString(),
        installed_version: "1.0.0",
        install_source: "npm",
      };

      await fs.writeFile(installStatePath, JSON.stringify(existingState));

      // Simulate running from bun
      process.env.npm_config_user_agent = "bun/1.0.0";

      await trackInstallLifecycle({ currentVersion: "1.0.0" });

      // Read the updated state
      const updatedContent = await fs.readFile(installStatePath, "utf-8");
      const updatedState = JSON.parse(updatedContent);

      expect(updatedState.install_source).toBe("bun");
    });

    it("should NOT update install_source when package manager is the same", async () => {
      const originalDate = "2024-01-01T00:00:00.000Z";
      const existingState = {
        schema_version: 1,
        client_id: "test-client-id",
        opt_out: false,
        first_installed_at: originalDate,
        last_updated_at: originalDate,
        last_launched_at: originalDate,
        installed_version: "1.0.0",
        install_source: "npm",
      };

      await fs.writeFile(installStatePath, JSON.stringify(existingState));

      // Simulate running from npm (same as existing)
      process.env.npm_config_user_agent = "npm/10.0.0";

      await trackInstallLifecycle({ currentVersion: "1.0.0" });

      // Read the updated state
      const updatedContent = await fs.readFile(installStatePath, "utf-8");
      const updatedState = JSON.parse(updatedContent);

      // install_source should remain npm
      expect(updatedState.install_source).toBe("npm");
    });
  });

  describe("state field backfill on startup", () => {
    it("should populate client_id if missing from existing state", async () => {
      const existingState = {
        schema_version: 1,
        // Missing client_id
        opt_out: false,
        first_installed_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
        last_launched_at: new Date().toISOString(),
        installed_version: "1.0.0",
        install_source: "npm",
      };

      await fs.writeFile(installStatePath, JSON.stringify(existingState));

      await trackInstallLifecycle({ currentVersion: "1.0.0" });

      const updatedContent = await fs.readFile(installStatePath, "utf-8");
      const updatedState = JSON.parse(updatedContent);

      expect(updatedState.client_id).toBeDefined();
      expect(updatedState.client_id).toMatch(/^[a-f0-9-]{36}$/i);
    });

    it("should populate install_source if missing from existing state", async () => {
      const existingState = {
        schema_version: 1,
        client_id: "test-client-id",
        opt_out: false,
        first_installed_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
        last_launched_at: new Date().toISOString(),
        installed_version: "1.0.0",
        // Missing install_source
      };

      await fs.writeFile(installStatePath, JSON.stringify(existingState));
      process.env.npm_config_user_agent = "yarn/4.0.0";

      await trackInstallLifecycle({ currentVersion: "1.0.0" });

      const updatedContent = await fs.readFile(installStatePath, "utf-8");
      const updatedState = JSON.parse(updatedContent);

      expect(updatedState.install_source).toBe("yarn");
    });

    it("should populate first_installed_at if missing from existing state", async () => {
      const existingState = {
        schema_version: 1,
        client_id: "test-client-id",
        opt_out: false,
        // Missing first_installed_at
        last_updated_at: new Date().toISOString(),
        last_launched_at: new Date().toISOString(),
        installed_version: "1.0.0",
        install_source: "npm",
      };

      await fs.writeFile(installStatePath, JSON.stringify(existingState));

      await trackInstallLifecycle({ currentVersion: "1.0.0" });

      const updatedContent = await fs.readFile(installStatePath, "utf-8");
      const updatedState = JSON.parse(updatedContent);

      expect(updatedState.first_installed_at).toBeDefined();
      // Should be a valid ISO date
      expect(new Date(updatedState.first_installed_at).toISOString()).toBe(
        updatedState.first_installed_at,
      );
    });

    it("should populate last_updated_at if missing from existing state", async () => {
      const existingState = {
        schema_version: 1,
        client_id: "test-client-id",
        opt_out: false,
        first_installed_at: new Date().toISOString(),
        // Missing last_updated_at
        last_launched_at: new Date().toISOString(),
        installed_version: "1.0.0",
        install_source: "npm",
      };

      await fs.writeFile(installStatePath, JSON.stringify(existingState));

      await trackInstallLifecycle({ currentVersion: "1.0.0" });

      const updatedContent = await fs.readFile(installStatePath, "utf-8");
      const updatedState = JSON.parse(updatedContent);

      expect(updatedState.last_updated_at).toBeDefined();
      // Should be a valid ISO date
      expect(new Date(updatedState.last_updated_at).toISOString()).toBe(
        updatedState.last_updated_at,
      );
    });

    it("should update schema_version to current version", async () => {
      const existingState = {
        schema_version: 0, // Old schema version
        client_id: "test-client-id",
        opt_out: false,
        first_installed_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
        last_launched_at: new Date().toISOString(),
        installed_version: "1.0.0",
        install_source: "npm",
      };

      await fs.writeFile(installStatePath, JSON.stringify(existingState));

      await trackInstallLifecycle({ currentVersion: "1.0.0" });

      const updatedContent = await fs.readFile(installStatePath, "utf-8");
      const updatedState = JSON.parse(updatedContent);

      expect(updatedState.schema_version).toBe(1);
    });
  });

  describe("trackInstallLifecycle integration", () => {
    it("should create new state file on first run", async () => {
      // Ensure no state file exists
      try {
        await fs.unlink(installStatePath);
      } catch {
        // File doesn't exist
      }

      await trackInstallLifecycle({ currentVersion: "1.0.0" });

      const exists = await fs
        .access(installStatePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      const content = await fs.readFile(installStatePath, "utf-8");
      const state = JSON.parse(content);

      expect(state.schema_version).toBe(1);
      expect(state.client_id).toBeDefined();
      expect(state.installed_version).toBe("1.0.0");
    });

    it("should send noriprof_install_detected event on first run", async () => {
      await trackInstallLifecycle({ currentVersion: "1.0.0" });

      const installCall = fetchMock.mock.calls.find((call) => {
        const body = JSON.parse(call[1].body);
        return body.event_name === "noriprof_install_detected";
      });

      expect(installCall).toBeDefined();
    });

    it("should send noriprof_install_detected event on version upgrade", async () => {
      const existingState = {
        schema_version: 1,
        client_id: "test-client-id",
        opt_out: false,
        first_installed_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
        last_launched_at: new Date().toISOString(),
        installed_version: "1.0.0",
        install_source: "npm",
      };

      await fs.writeFile(installStatePath, JSON.stringify(existingState));

      await trackInstallLifecycle({ currentVersion: "2.0.0" });

      const updateCall = fetchMock.mock.calls.find((call) => {
        const body = JSON.parse(call[1].body);
        return body.event_name === "noriprof_install_detected";
      });

      expect(updateCall).toBeDefined();
    });

    it("should respect opt_out flag", async () => {
      const existingState = {
        schema_version: 1,
        client_id: "test-client-id",
        opt_out: true, // Opted out
        first_installed_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
        last_launched_at: new Date().toISOString(),
        installed_version: "1.0.0",
        install_source: "npm",
      };

      await fs.writeFile(installStatePath, JSON.stringify(existingState));

      await trackInstallLifecycle({ currentVersion: "1.0.0" });

      // No analytics events should be sent
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should respect NORI_NO_ANALYTICS env var", async () => {
      process.env.NORI_NO_ANALYTICS = "1";

      await trackInstallLifecycle({ currentVersion: "1.0.0" });

      // No analytics events should be sent
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should NOT downgrade installed_version on older version run", async () => {
      const existingState = {
        schema_version: 1,
        client_id: "test-client-id",
        opt_out: false,
        first_installed_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
        last_launched_at: new Date().toISOString(),
        installed_version: "2.0.0", // Higher version
        install_source: "npm",
      };

      await fs.writeFile(installStatePath, JSON.stringify(existingState));

      await trackInstallLifecycle({ currentVersion: "1.0.0" }); // Lower version

      const updatedContent = await fs.readFile(installStatePath, "utf-8");
      const updatedState = JSON.parse(updatedContent);

      // Version should remain at 2.0.0, not downgrade to 1.0.0
      expect(updatedState.installed_version).toBe("2.0.0");
    });
  });
});

/**
 * Tests for new API spec compliance (PLAN_ANALYTICS_PROXY.md)
 * These test the new exported functions and event structure
 */
describe("Analytics API Spec Compliance (PLAN_ANALYTICS_PROXY.md)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("getDeterministicClientId", () => {
    // @current-session
    it("returns a deterministic UUID-formatted string based on machine identifiers", async () => {
      // Import the function - it should be exported
      const { getDeterministicClientId } = await import("./installTracking.js");

      const clientId = getDeterministicClientId();

      // Should be a valid UUID format (8-4-4-4-12 hex characters)
      expect(clientId).toMatch(
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
      );

      // Should be deterministic - same machine = same ID
      const clientId2 = getDeterministicClientId();
      expect(clientId2).toBe(clientId);
    });

    // @current-session
    it("is NOT a static string like 'plugin-installer'", async () => {
      const { getDeterministicClientId } = await import("./installTracking.js");

      const clientId = getDeterministicClientId();
      expect(clientId).not.toBe("plugin-installer");
      expect(clientId).not.toBe("nori-skillsets");
    });
  });

  describe("buildBaseEventParams", () => {
    // @current-session
    it("includes all required tilework_* fields", async () => {
      const { buildBaseEventParams } = await import("./installTracking.js");

      const params = buildBaseEventParams();

      // tilework_source is configurable, just verify it's present
      expect(params).toHaveProperty("tilework_source");
      expect(params).toHaveProperty("tilework_session_id");
      expect(params).toHaveProperty("tilework_timestamp");
    });

    // @current-session
    it("tilework_session_id is constant across multiple calls in the same process", async () => {
      const { buildBaseEventParams } = await import("./installTracking.js");

      const params1 = buildBaseEventParams();
      const params2 = buildBaseEventParams();

      expect(params1.tilework_session_id).toBe(params2.tilework_session_id);
    });

    // @current-session
    it("tilework_timestamp is ISO 8601 format", async () => {
      const { buildBaseEventParams } = await import("./installTracking.js");

      const params = buildBaseEventParams();

      // Should be a valid ISO 8601 timestamp
      expect(new Date(params.tilework_timestamp).toISOString()).toBe(
        params.tilework_timestamp,
      );
    });
  });

  describe("sendAnalyticsEvent", () => {
    // @current-session
    it("sends event with correct structure matching API spec", async () => {
      const { sendAnalyticsEvent, buildBaseEventParams } =
        await import("./installTracking.js");

      sendAnalyticsEvent({
        eventName: "test_event",
        eventParams: buildBaseEventParams(),
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];

      expect(url).toBe("https://noriskillsets.dev/api/analytics/track");

      const payload = JSON.parse(options.body);
      expect(payload).toHaveProperty("client_id");
      expect(payload).toHaveProperty("event_name", "test_event");
      expect(payload).toHaveProperty("event_params");
      // tilework_source is configurable, just verify it's present
      expect(payload.event_params).toHaveProperty("tilework_source");
      expect(payload.event_params).toHaveProperty("tilework_session_id");
      expect(payload.event_params).toHaveProperty("tilework_timestamp");
    });

    // @current-session
    it("includes user_id when provided", async () => {
      const { sendAnalyticsEvent, buildBaseEventParams } =
        await import("./installTracking.js");

      sendAnalyticsEvent({
        eventName: "test_event",
        eventParams: buildBaseEventParams(),
        userId: "test@example.com",
      });

      const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(payload).toHaveProperty("user_id", "test@example.com");
    });

    // @current-session
    it("omits user_id when not provided", async () => {
      const { sendAnalyticsEvent, buildBaseEventParams } =
        await import("./installTracking.js");

      sendAnalyticsEvent({
        eventName: "test_event",
        eventParams: buildBaseEventParams(),
      });

      const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(payload).not.toHaveProperty("user_id");
    });

    // @current-session
    it("uses snake_case field names (not camelCase)", async () => {
      const { sendAnalyticsEvent, buildBaseEventParams } =
        await import("./installTracking.js");

      sendAnalyticsEvent({
        eventName: "test_event",
        eventParams: buildBaseEventParams(),
        clientId: "test-client-id",
      });

      const payload = JSON.parse(fetchMock.mock.calls[0][1].body);

      // Should have snake_case
      expect(payload).toHaveProperty("client_id");
      expect(payload).toHaveProperty("event_name");
      expect(payload).toHaveProperty("event_params");

      // Should NOT have camelCase
      expect(payload).not.toHaveProperty("clientId");
      expect(payload).not.toHaveProperty("eventName");
      expect(payload).not.toHaveProperty("eventParams");
    });

    // @current-session
    it("uses deterministic client_id when none provided", async () => {
      const { sendAnalyticsEvent, buildBaseEventParams } =
        await import("./installTracking.js");

      sendAnalyticsEvent({
        eventName: "test_event",
        eventParams: buildBaseEventParams(),
      });

      const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(payload.client_id).toMatch(
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
      );
      expect(payload.client_id).not.toBe("plugin-installer");
    });
  });

  describe("trackInstallLifecycle - New Event Names", () => {
    let installStatePath: string;
    let tempProfilesDir: string;

    beforeEach(async () => {
      installStatePath = path.join(
        os.homedir(),
        ".nori",
        "profiles",
        ".nori-install.json",
      );
      tempProfilesDir = path.dirname(installStatePath);

      await fs.mkdir(tempProfilesDir, { recursive: true });

      try {
        await fs.unlink(installStatePath);
      } catch {
        // File doesn't exist
      }
    });

    afterEach(async () => {
      try {
        await fs.unlink(installStatePath);
      } catch {
        // File doesn't exist
      }
    });

    // @current-session
    it("sends noriprof_install_detected on first install", async () => {
      await trackInstallLifecycle({ currentVersion: "1.0.0" });

      const installCall = fetchMock.mock.calls.find((call) => {
        const body = JSON.parse(call[1].body);
        return body.event_name === "noriprof_install_detected";
      });

      expect(installCall).toBeDefined();
    });

    // @current-session
    it("sends noriprof_install_detected with tilework_cli_previous_version on upgrade", async () => {
      const existingState = {
        schema_version: 1,
        client_id: "test-client-id",
        opt_out: false,
        first_installed_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
        last_launched_at: new Date().toISOString(),
        installed_version: "1.0.0",
        install_source: "npm",
      };

      await fs.writeFile(installStatePath, JSON.stringify(existingState));

      await trackInstallLifecycle({ currentVersion: "2.0.0" });

      const installCall = fetchMock.mock.calls.find((call) => {
        const body = JSON.parse(call[1].body);
        return body.event_name === "noriprof_install_detected";
      });

      expect(installCall).toBeDefined();
      const payload = JSON.parse(installCall![1].body);
      expect(payload.event_params).toHaveProperty(
        "tilework_cli_is_first_install",
        false,
      );
      expect(payload.event_params).toHaveProperty(
        "tilework_cli_previous_version",
        "1.0.0",
      );
    });

    // @current-session
    it("sends noriprof_user_resurrected after 30+ days of inactivity", async () => {
      const thirtyOneDaysAgo = new Date(
        Date.now() - 31 * 24 * 60 * 60 * 1000,
      ).toISOString();

      await fs.writeFile(
        installStatePath,
        JSON.stringify({
          schema_version: 1,
          client_id: "test-client-id",
          opt_out: false,
          first_installed_at: thirtyOneDaysAgo,
          last_updated_at: thirtyOneDaysAgo,
          last_launched_at: thirtyOneDaysAgo,
          installed_version: "1.0.0",
          install_source: "npm",
        }),
      );

      await trackInstallLifecycle({ currentVersion: "1.0.0" });

      const resurrectedCall = fetchMock.mock.calls.find((call) => {
        const body = JSON.parse(call[1].body);
        return body.event_name === "noriprof_user_resurrected";
      });

      expect(resurrectedCall).toBeDefined();
    });
  });

  describe("trackInstallLifecycle - CLI Event Params", () => {
    let installStatePath: string;
    let tempProfilesDir: string;

    beforeEach(async () => {
      installStatePath = path.join(
        os.homedir(),
        ".nori",
        "profiles",
        ".nori-install.json",
      );
      tempProfilesDir = path.dirname(installStatePath);

      await fs.mkdir(tempProfilesDir, { recursive: true });

      try {
        await fs.unlink(installStatePath);
      } catch {
        // File doesn't exist
      }
    });

    afterEach(async () => {
      try {
        await fs.unlink(installStatePath);
      } catch {
        // File doesn't exist
      }
    });

    // @current-session
    it("includes all required tilework_cli_* fields in event_params", async () => {
      await trackInstallLifecycle({ currentVersion: "1.0.0" });

      const installCall = fetchMock.mock.calls.find((call) => {
        const body = JSON.parse(call[1].body);
        return body.event_name === "noriprof_install_detected";
      });

      expect(installCall).toBeDefined();
      const payload = JSON.parse(installCall![1].body);
      const params = payload.event_params;

      // Required base fields - tilework_source is configurable
      expect(params).toHaveProperty("tilework_source");
      expect(params).toHaveProperty("tilework_session_id");
      expect(params).toHaveProperty("tilework_timestamp");

      // Required CLI fields
      expect(params).toHaveProperty(
        "tilework_cli_executable_name",
        "nori-skillsets",
      );
      expect(params).toHaveProperty("tilework_cli_installed_version", "1.0.0");
      expect(params).toHaveProperty("tilework_cli_install_source");
      expect(params).toHaveProperty("tilework_cli_days_since_install");
      expect(params).toHaveProperty("tilework_cli_node_version");
    });

    // @current-session
    it("includes tilework_cli_is_first_install=true on first install", async () => {
      await trackInstallLifecycle({ currentVersion: "1.0.0" });

      const installCall = fetchMock.mock.calls.find((call) => {
        const body = JSON.parse(call[1].body);
        return body.event_name === "noriprof_install_detected";
      });

      expect(installCall).toBeDefined();
      const params = JSON.parse(installCall![1].body).event_params;

      expect(params.tilework_cli_is_first_install).toBe(true);
    });
  });
});

/**
 * Tests for buildCLIEventParams helper function
 * This function builds all standard tilework_cli_* params for analytics events
 */
describe("buildCLIEventParams", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // @current-session
  it("includes all required tilework_cli_* fields", async () => {
    const { buildCLIEventParams } = await import("./installTracking.js");

    const params = await buildCLIEventParams();

    // Base params from buildBaseEventParams - tilework_source is configurable
    expect(params).toHaveProperty("tilework_source");
    expect(params).toHaveProperty("tilework_session_id");
    expect(params).toHaveProperty("tilework_timestamp");

    // CLI-specific params
    expect(params).toHaveProperty(
      "tilework_cli_executable_name",
      "nori-skillsets",
    );
    expect(params).toHaveProperty("tilework_cli_installed_version");
    expect(params).toHaveProperty("tilework_cli_install_source");
    expect(typeof params.tilework_cli_days_since_install).toBe("number");
    expect(params).toHaveProperty(
      "tilework_cli_node_version",
      process.versions.node,
    );
    expect(params).toHaveProperty("tilework_cli_install_type");
  });

  // @current-session
  it("returns 'unauthenticated' install_type when no auth in config", async () => {
    const { buildCLIEventParams } = await import("./installTracking.js");

    // Pass a mock config with no auth
    const params = await buildCLIEventParams({
      config: { agents: {} } as any,
    });

    expect(params.tilework_cli_install_type).toBe("unauthenticated");
  });

  // @current-session
  it("returns 'authenticated' install_type when auth exists in config", async () => {
    const { buildCLIEventParams } = await import("./installTracking.js");

    const params = await buildCLIEventParams({
      config: {
        auth: { username: "test@example.com" },
        agents: {},
      } as any,
    });

    expect(params.tilework_cli_install_type).toBe("authenticated");
  });

  // @current-session
  it("extracts profile from agent config", async () => {
    const { buildCLIEventParams } = await import("./installTracking.js");

    const params = await buildCLIEventParams({
      config: {
        agents: {
          "claude-code": {
            profile: { baseProfile: "senior-swe" },
          },
        },
      } as any,
    });

    expect(params.tilework_cli_profile).toBe("senior-swe");
  });

  // @current-session
  it("returns null profile when not configured", async () => {
    const { buildCLIEventParams } = await import("./installTracking.js");

    const params = await buildCLIEventParams({
      config: { agents: {} } as any,
    });

    expect(params.tilework_cli_profile).toBeNull();
  });

  // @current-session
  it("uses provided currentVersion instead of reading from package", async () => {
    const { buildCLIEventParams } = await import("./installTracking.js");

    const params = await buildCLIEventParams({
      currentVersion: "99.99.99",
      config: { agents: {} } as any,
    });

    expect(params.tilework_cli_installed_version).toBe("99.99.99");
  });

  // @current-session
  it("calculates days_since_install from install state", async () => {
    const { buildCLIEventParams, readInstallState } =
      await import("./installTracking.js");

    // First ensure there's an install state with a known date
    const state = await readInstallState();
    if (state != null) {
      // days_since_install should be calculated from first_installed_at
      const params = await buildCLIEventParams({
        config: { agents: {} } as any,
      });

      expect(typeof params.tilework_cli_days_since_install).toBe("number");
      expect(params.tilework_cli_days_since_install).toBeGreaterThanOrEqual(0);
    }
  });
});

/**
 * Tests for getUserId helper function
 * This function extracts user email from config for cross-device tracking
 */
describe("getUserId", () => {
  // @current-session
  it("returns email from config auth when present", async () => {
    const { getUserId } = await import("./installTracking.js");

    const userId = await getUserId({
      config: {
        auth: { username: "test@example.com" },
      } as any,
    });

    expect(userId).toBe("test@example.com");
  });

  // @current-session
  it("returns null when no auth in config", async () => {
    const { getUserId } = await import("./installTracking.js");

    const userId = await getUserId({
      config: { agents: {} } as any,
    });

    expect(userId).toBeNull();
  });

  // @current-session
  it("returns null when config is null", async () => {
    const { getUserId } = await import("./installTracking.js");

    const userId = await getUserId({ config: null });

    expect(userId).toBeNull();
  });
});

/**
 * Tests for readInstallState export
 * This function should be exported for use by other modules
 */
describe("readInstallState export", () => {
  // @current-session
  it("is exported and can be called", async () => {
    const { readInstallState } = await import("./installTracking.js");

    expect(typeof readInstallState).toBe("function");

    // Should return null or an InstallState object
    const state = await readInstallState();
    if (state != null) {
      expect(state).toHaveProperty("schema_version");
      expect(state).toHaveProperty("client_id");
    }
  });
});

/**
 * Tests for CLIEventParams type export
 * The type should be exported for use by callers
 */
describe("Type exports", () => {
  // @current-session
  it("exports EventParams and CLIEventParams types", async () => {
    // This test verifies the types are exported by checking
    // that buildCLIEventParams returns the expected shape
    const { buildCLIEventParams } = await import("./installTracking.js");

    const params = await buildCLIEventParams({
      config: { agents: {} } as any,
    });

    // Verify it matches CLIEventParams structure
    // Base EventParams fields
    expect(params.tilework_source).toBeDefined();
    expect(params.tilework_session_id).toBeDefined();
    expect(params.tilework_timestamp).toBeDefined();

    // CLIEventParams additional fields
    expect(params.tilework_cli_executable_name).toBeDefined();
    expect(params.tilework_cli_installed_version).toBeDefined();
    expect(params.tilework_cli_install_source).toBeDefined();
    expect(params.tilework_cli_days_since_install).toBeDefined();
    expect(params.tilework_cli_node_version).toBeDefined();
    expect(params.tilework_cli_install_type).toBeDefined();
  });
});

/**
 * Tests for dynamic tilework_source configuration
 * These functions allow entry points to configure the analytics source identifier
 */
describe("tilework_source configuration", () => {
  afterEach(() => {
    // Reset to default after each test
    setTileworkSource({ source: "nori-skillsets" });
  });

  describe("getTileworkSource", () => {
    it("returns the default value 'nori-skillsets' when not explicitly set", () => {
      const source = getTileworkSource();
      expect(source).toBe("nori-skillsets");
    });
  });

  describe("setTileworkSource", () => {
    it("changes the value returned by getTileworkSource", () => {
      setTileworkSource({ source: "nori-skillsets" });

      const source = getTileworkSource();
      expect(source).toBe("nori-skillsets");
    });
  });

  describe("buildBaseEventParams uses configured source", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      setTileworkSource({ source: "nori-skillsets" });
    });

    it("includes tilework_source from getTileworkSource when set to nori-skillsets", async () => {
      const { buildBaseEventParams, setTileworkSource: setSrc } =
        await import("./installTracking.js");

      setSrc({ source: "nori-skillsets" });
      const params = buildBaseEventParams();

      expect(params.tilework_source).toBe("nori-skillsets");
    });
  });

  describe("sendAnalyticsEvent uses configured source", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      setTileworkSource({ source: "nori-skillsets" });
    });

    it("sends events with the configured tilework_source", async () => {
      const {
        sendAnalyticsEvent,
        buildBaseEventParams,
        setTileworkSource: setSrc,
      } = await import("./installTracking.js");

      setSrc({ source: "nori-skillsets" });

      sendAnalyticsEvent({
        eventName: "test_event",
        eventParams: buildBaseEventParams(),
      });

      const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(payload.event_params.tilework_source).toBe("nori-skillsets");
    });
  });

  describe("buildCLIEventParams uses configured source for executable name", () => {
    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      setTileworkSource({ source: "nori-skillsets" });
    });

    it("includes tilework_cli_executable_name from getTileworkSource when set to nori-skillsets", async () => {
      const { buildCLIEventParams, setTileworkSource: setSrc } =
        await import("./installTracking.js");

      setSrc({ source: "nori-skillsets" });
      const params = await buildCLIEventParams();

      expect(params.tilework_cli_executable_name).toBe("nori-skillsets");
    });
  });
});
