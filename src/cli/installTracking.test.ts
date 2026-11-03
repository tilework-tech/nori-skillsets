import { promises as fs } from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as installTracking from "./installTracking.js";

type ProductAnalyticsExports = {
  flushProductAnalytics: (args: { timeoutMs: number }) => Promise<void>;
  trackCommandCompleted: (args: {
    command: string;
    result: "success" | "failure";
    currentVersion: string;
  }) => Promise<void>;
  trackInstallLifecycle: (args: {
    currentVersion: string;
    explicitInstall?: boolean;
  }) => Promise<void>;
};

const productAnalytics =
  installTracking as unknown as Partial<ProductAnalyticsExports>;
const flushProductAnalytics =
  productAnalytics.flushProductAnalytics ?? (async () => undefined);
const trackCommandCompleted =
  productAnalytics.trackCommandCompleted ?? (async () => undefined);
const trackInstallLifecycle =
  productAnalytics.trackInstallLifecycle ??
  installTracking.trackInstallLifecycle;

type AnalyticsRequest = {
  schema_version: number;
  event: string;
  activity_id: string;
  occurred_at: string;
  product: string;
  surface: string;
  app_version: string;
  properties?: Record<string, unknown>;
};

const ANALYTICS_URL = "http://127.0.0.1:19500/api/analytics/v1/events";
const FIREBASE_TOKEN_URL_PREFIX = "https://securetoken.googleapis.com/v1/token";

const getConfigPath = (): string =>
  path.join(process.env.NORI_GLOBAL_CONFIG!, ".nori-config.json");

const getInstallStatePath = (): string =>
  path.join(
    process.env.NORI_GLOBAL_CONFIG!,
    ".nori",
    "profiles",
    ".nori-install.json",
  );

const writeConfig = async (auth: Record<string, unknown>): Promise<void> => {
  await fs.writeFile(
    getConfigPath(),
    `${JSON.stringify({
      installDir: path.join(process.env.NORI_GLOBAL_CONFIG!, ".claude"),
      auth: {
        username: "user@example.com",
        organizationUrl: "https://acme.noriskillsets.dev",
        ...auth,
      },
    })}\n`,
  );
};

const writeInstallState = async (
  overrides: Record<string, unknown> = {},
): Promise<void> => {
  const now = new Date().toISOString();
  await fs.mkdir(path.dirname(getInstallStatePath()), { recursive: true });
  await fs.writeFile(
    getInstallStatePath(),
    `${JSON.stringify({
      schema_version: 1,
      client_id: "c4f24cc9-acde-4d20-87e1-1d6bfa8e7a67",
      opt_out: false,
      first_installed_at: now,
      last_updated_at: now,
      last_launched_at: now,
      installed_version: "1.0.0",
      install_source: "npm",
      ...overrides,
    })}\n`,
  );
};

const analyticsCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => String(url) === ANALYTICS_URL);

const analyticsBodies = (
  fetchMock: ReturnType<typeof vi.fn>,
): Array<AnalyticsRequest> =>
  analyticsCalls(fetchMock).map(([, init]) =>
    JSON.parse(String((init as RequestInit).body)),
  );

describe("authenticated product analytics", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let testHome: string;

  beforeEach(async () => {
    testHome = await fs.mkdtemp("/tmp/nori-skillsets-analytics-");
    process.env.NORI_GLOBAL_CONFIG = testHome;
    process.env.NORI_ANALYTICS_URL = ANALYTICS_URL;
    delete process.env.NORI_NO_ANALYTICS;

    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ accepted: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    if (typeof flushProductAnalytics === "function") {
      await flushProductAnalytics({ timeoutMs: 20 });
    }
    delete process.env.NORI_GLOBAL_CONFIG;
    delete process.env.NORI_ANALYTICS_URL;
    delete process.env.NORI_NO_ANALYTICS;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await fs.rm(testHome, { recursive: true, force: true });
  });

  it("uses a direct unexpired Firebase ID token and the exact v1 envelope", async () => {
    await writeConfig({
      idToken: "firebase-id-token",
      idTokenExpiresAt: Date.now() + 60_000,
      apiToken: `nori_acme_${"a".repeat(64)}`,
    });
    await writeInstallState();

    await trackCommandCompleted({
      command: "install",
      result: "success",
      currentVersion: "2.4.0",
    });
    await flushProductAnalytics({ timeoutMs: 100 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ANALYTICS_URL);
    expect(init.headers).toEqual({
      Authorization: "Bearer firebase-id-token",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(String(init.body)) as AnalyticsRequest;
    expect(body).toEqual({
      schema_version: 1,
      event: "skillsets_command_completed",
      activity_id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
      occurred_at: expect.stringMatching(/Z$/),
      product: "skillsets",
      surface: "cli",
      app_version: "2.4.0",
      properties: { command: "install", result: "success" },
    });
  });

  it("exchanges a refresh token and never sends an API token", async () => {
    await writeConfig({
      refreshToken: "firebase-refresh-token",
      apiToken: `nori_acme_${"b".repeat(64)}`,
    });
    await writeInstallState();

    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith(FIREBASE_TOKEN_URL_PREFIX)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id_token: "refreshed-firebase-token",
            refresh_token: "rotated-refresh-token",
            expires_in: "3600",
            token_type: "Bearer",
            user_id: "firebase-user",
            project_id: "tilework-e18c5",
          }),
        };
      }
      return { ok: true, status: 202, json: async () => ({ accepted: true }) };
    });

    await trackCommandCompleted({
      command: "current",
      result: "success",
      currentVersion: "2.4.0",
    });
    await flushProductAnalytics({ timeoutMs: 100 });

    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      expect.stringMatching(
        /^https:\/\/securetoken\.googleapis\.com\/v1\/token/,
      ),
    );
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal).toBeInstanceOf(
      AbortSignal,
    );
    const analyticsCall = analyticsCalls(fetchMock)[0] as [string, RequestInit];
    expect(analyticsCall[1].headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer refreshed-firebase-token",
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(
      `nori_acme_${"b".repeat(64)}`,
    );
  });

  it.each([
    [
      "API-token-only configuration",
      { apiToken: `nori_acme_${"c".repeat(64)}` },
    ],
    [
      "broker service identity",
      {
        username: "nori-service:session-123",
        idToken: "service-token",
        idTokenExpiresAt: Date.now() + 60_000,
      },
    ],
    ["anonymous configuration", {}],
  ])("skips %s", async (_caseName, auth) => {
    await writeConfig(auth);
    await writeInstallState();

    await trackCommandCompleted({
      command: "current",
      result: "success",
      currentVersion: "2.4.0",
    });
    await flushProductAnalytics({ timeoutMs: 100 });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["environment", "durable state"])(
    "honors the %s analytics opt-out",
    async (optOut) => {
      await writeConfig({
        idToken: "firebase-id-token",
        idTokenExpiresAt: Date.now() + 60_000,
      });
      await writeInstallState({ opt_out: optOut === "durable state" });
      if (optOut === "environment") {
        process.env.NORI_NO_ANALYTICS = "1";
      }

      await trackCommandCompleted({
        command: "current",
        result: "success",
        currentVersion: "2.4.0",
      });
      await flushProductAnalytics({ timeoutMs: 100 });

      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    [null, "1.0.0", "first_install"],
    ["1.0.0", "2.0.0", "update"],
  ])(
    "classifies lifecycle from %s to %s as %s",
    async (previousVersion, currentVersion, installKind) => {
      await writeConfig({
        idToken: "firebase-id-token",
        idTokenExpiresAt: Date.now() + 60_000,
      });
      if (previousVersion != null) {
        await writeInstallState({ installed_version: previousVersion });
      }

      await trackInstallLifecycle({ currentVersion });
      await flushProductAnalytics({ timeoutMs: 100 });

      expect(analyticsBodies(fetchMock)).toEqual([
        expect.objectContaining({
          event: "skillsets_install_started",
          properties: { install_kind: installKind },
        }),
        expect.objectContaining({
          event: "skillsets_install_completed",
          properties: { install_kind: installKind, result: "success" },
        }),
      ]);
    },
  );

  it("classifies an explicit same-version installer run as reinstall", async () => {
    await writeConfig({
      idToken: "firebase-id-token",
      idTokenExpiresAt: Date.now() + 60_000,
    });
    await writeInstallState({ installed_version: "2.4.0" });

    await trackInstallLifecycle({
      currentVersion: "2.4.0",
      explicitInstall: true,
    });
    await flushProductAnalytics({ timeoutMs: 100 });

    expect(analyticsBodies(fetchMock)).toEqual([
      expect.objectContaining({
        event: "skillsets_install_started",
        properties: { install_kind: "reinstall" },
      }),
      expect.objectContaining({
        event: "skillsets_install_completed",
        properties: { install_kind: "reinstall", result: "success" },
      }),
    ]);
  });

  it("does not emit lifecycle events on an ordinary launch of the same version", async () => {
    await writeConfig({
      idToken: "firebase-id-token",
      idTokenExpiresAt: Date.now() + 60_000,
    });
    await writeInstallState({ installed_version: "2.4.0" });

    await trackInstallLifecycle({ currentVersion: "2.4.0" });
    await flushProductAnalytics({ timeoutMs: 100 });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not emit or move state backward on an ordinary lower-version launch", async () => {
    await writeConfig({
      idToken: "firebase-id-token",
      idTokenExpiresAt: Date.now() + 60_000,
    });
    await writeInstallState({ installed_version: "2.4.0" });

    await trackInstallLifecycle({ currentVersion: "2.3.0" });
    await flushProductAnalytics({ timeoutMs: 100 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      JSON.parse(await fs.readFile(getInstallStatePath(), "utf8"))
        .installed_version,
    ).toBe("2.4.0");
  });

  it("persists first-install state before capture and is silent on the next launch", async () => {
    await writeConfig({
      idToken: "firebase-id-token",
      idTokenExpiresAt: Date.now() + 60_000,
    });

    await trackInstallLifecycle({ currentVersion: "2.4.0" });
    await flushProductAnalytics({ timeoutMs: 100 });
    const state = JSON.parse(
      await fs.readFile(getInstallStatePath(), "utf8"),
    ) as Record<string, unknown>;
    expect(state.installed_version).toBe("2.4.0");
    expect(state.first_installed_at).toEqual(expect.any(String));
    expect(analyticsCalls(fetchMock)).toHaveLength(2);

    fetchMock.mockClear();
    await trackInstallLifecycle({ currentVersion: "2.4.0" });
    await flushProductAnalytics({ timeoutMs: 100 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
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
  ])(
    "emits only the canonical allowlisted command identifier %s",
    async (command) => {
      await writeConfig({
        idToken: "firebase-id-token",
        idTokenExpiresAt: Date.now() + 60_000,
      });
      await writeInstallState();

      await trackCommandCompleted({
        command,
        result: "success",
        currentVersion: "2.4.0",
      });
      await flushProductAnalytics({ timeoutMs: 100 });

      expect(analyticsBodies(fetchMock)[0]).toEqual(
        expect.objectContaining({
          event: "skillsets_command_completed",
          properties: { command, result: "success" },
        }),
      );
    },
  );

  it.each([
    "login",
    "logout",
    "syntax",
    "help",
    "version",
    "completion",
    "install --private",
  ])("never sends excluded or raw command value %s", async (command) => {
    await writeConfig({
      idToken: "firebase-id-token",
      idTokenExpiresAt: Date.now() + 60_000,
    });
    await writeInstallState();

    await trackCommandCompleted({
      command,
      result: "success",
      currentVersion: "2.4.0",
    });
    await flushProductAnalytics({ timeoutMs: 100 });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bounds final flush and never changes output or exit state", async () => {
    await writeConfig({
      idToken: "firebase-id-token",
      idTokenExpiresAt: Date.now() + 60_000,
    });
    await writeInstallState();
    const stdout = vi.spyOn(process.stdout, "write");
    const stderr = vi.spyOn(process.stderr, "write");
    const originalExitCode = process.exitCode;
    fetchMock.mockImplementation(() => new Promise(() => undefined));

    await trackCommandCompleted({
      command: "current",
      result: "success",
      currentVersion: "2.4.0",
    });
    const startedAt = Date.now();
    await flushProductAnalytics({ timeoutMs: 25 });

    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(originalExitCode);
  });

  it("swallows HTTP failures after sending one stable activity envelope", async () => {
    await writeConfig({
      idToken: "firebase-id-token",
      idTokenExpiresAt: Date.now() + 60_000,
    });
    await writeInstallState();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "unavailable" }),
    });

    await expect(
      trackCommandCompleted({
        command: "current",
        result: "success",
        currentVersion: "2.4.0",
      }),
    ).resolves.toBeUndefined();
    await expect(
      flushProductAnalytics({ timeoutMs: 100 }),
    ).resolves.toBeUndefined();
    expect(analyticsCalls(fetchMock)).toHaveLength(1);
    expect(analyticsBodies(fetchMock)[0]?.activity_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/i,
    );
  });
});
