/**
 * Tests for analytics API module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Hoisted mock for proxyFetch
const { mockProxyFetch } = vi.hoisted(() => ({
  mockProxyFetch: vi.fn(),
}));

vi.mock("@/utils/fetch.js", () => ({
  proxyFetch: mockProxyFetch,
  NetworkError: class NetworkError extends Error {
    readonly isNetworkError = true;
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
      this.name = "NetworkError";
    }
  },
}));

import { analyticsApi } from "./analytics.js";
import { ConfigManager } from "./base.js";

// Mock base.js - we need ConfigManager for analytics
vi.mock("./base.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    ConfigManager: {
      loadConfig: vi.fn(),
    },
  };
});

describe("analyticsApi.trackEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProxyFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends analytics to default endpoint when no organizationUrl configured", async () => {
    // Setup: No organizationUrl in config
    vi.mocked(ConfigManager.loadConfig).mockReturnValue({});

    // Execute
    await analyticsApi.trackEvent({
      clientId: "test-client",
      eventName: "test_event",
    });

    // Verify: Should call default endpoint
    expect(mockProxyFetch).toHaveBeenCalledTimes(1);
    expect(mockProxyFetch).toHaveBeenCalledWith(
      "https://demo.tilework.tech/api/analytics/track",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "test-client",
          eventName: "test_event",
        }),
      }),
    );
  });

  it("sends analytics to configured organizationUrl when available", async () => {
    // Setup: Custom organizationUrl in config
    vi.mocked(ConfigManager.loadConfig).mockReturnValue({
      organizationUrl: "https://custom.example.com",
    });

    // Execute
    await analyticsApi.trackEvent({
      clientId: "test-client",
      eventName: "test_event",
      eventParams: { foo: "bar" },
    });

    // Verify: Should call custom endpoint
    expect(mockProxyFetch).toHaveBeenCalledTimes(1);
    expect(mockProxyFetch).toHaveBeenCalledWith(
      "https://custom.example.com/api/analytics/track",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          clientId: "test-client",
          eventName: "test_event",
          eventParams: { foo: "bar" },
        }),
      }),
    );
  });

  it("does not include Authorization header (unauthenticated endpoint)", async () => {
    // Setup
    vi.mocked(ConfigManager.loadConfig).mockReturnValue({});

    // Execute
    await analyticsApi.trackEvent({
      clientId: "test-client",
      eventName: "test_event",
    });

    // Verify: Headers should only have Content-Type, no Authorization
    const fetchCall = mockProxyFetch.mock.calls[0];
    const headers = fetchCall[1].headers;
    expect(headers).toEqual({ "Content-Type": "application/json" });
    expect(headers).not.toHaveProperty("Authorization");
  });

  it("returns success response on successful fetch", async () => {
    // Setup
    vi.mocked(ConfigManager.loadConfig).mockReturnValue({});
    mockProxyFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    // Execute
    const result = await analyticsApi.trackEvent({
      clientId: "test-client",
      eventName: "test_event",
    });

    // Verify
    expect(result).toEqual({ success: true });
  });

  it("includes userId when provided", async () => {
    // Setup
    vi.mocked(ConfigManager.loadConfig).mockReturnValue({});

    // Execute
    await analyticsApi.trackEvent({
      clientId: "test-client",
      userId: "user@example.com",
      eventName: "test_event",
    });

    // Verify
    expect(mockProxyFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          clientId: "test-client",
          userId: "user@example.com",
          eventName: "test_event",
        }),
      }),
    );
  });

  it("handles trailing slash in organizationUrl", async () => {
    // Setup: organizationUrl with trailing slash
    vi.mocked(ConfigManager.loadConfig).mockReturnValue({
      organizationUrl: "https://custom.example.com/",
    });

    // Execute
    await analyticsApi.trackEvent({
      clientId: "test-client",
      eventName: "test_event",
    });

    // Verify: Should not have double slashes
    expect(mockProxyFetch).toHaveBeenCalledWith(
      "https://custom.example.com/api/analytics/track",
      expect.any(Object),
    );
  });

  it("falls back to default URL when ConfigManager.loadConfig returns null", async () => {
    // Setup: loadConfig returns null (no installation found)
    vi.mocked(ConfigManager.loadConfig).mockReturnValue(null);

    // Execute
    await analyticsApi.trackEvent({
      clientId: "test-client",
      eventName: "test_event",
    });

    // Verify: Should still call default endpoint
    expect(mockProxyFetch).toHaveBeenCalledWith(
      "https://demo.tilework.tech/api/analytics/track",
      expect.any(Object),
    );
  });

  it("returns success: false on non-OK HTTP responses", async () => {
    // Setup
    vi.mocked(ConfigManager.loadConfig).mockReturnValue({});
    mockProxyFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    // Execute
    const result = await analyticsApi.trackEvent({
      clientId: "test-client",
      eventName: "test_event",
    });

    // Verify
    expect(result).toEqual({ success: false });
  });
});
