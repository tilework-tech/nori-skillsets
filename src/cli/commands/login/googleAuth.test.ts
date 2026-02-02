/**
 * Tests for the Google OAuth authentication module
 */

import * as http from "http";
import * as net from "net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  exchangeCodeForTokens,
  findAvailablePort,
  generateState,
  getGoogleAuthUrl,
  startAuthServer,
  validateOAuthCredentials,
} from "./googleAuth.js";

describe("googleAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findAvailablePort", () => {
    it("should find an available port", async () => {
      const port = await findAvailablePort({ startPort: 9876 });

      expect(port).toBeGreaterThanOrEqual(9876);
      expect(port).toBeLessThan(9886);

      // Verify the port is actually available by briefly binding to it
      const server = net.createServer();
      await new Promise<void>((resolve, reject) => {
        server.listen(port, () => {
          server.close(() => resolve());
        });
        server.on("error", reject);
      });
    });

    it("should skip ports that are already in use", async () => {
      // Occupy port 9876
      const blockingServer = net.createServer();
      await new Promise<void>((resolve) => {
        blockingServer.listen(9876, () => resolve());
      });

      try {
        const port = await findAvailablePort({
          startPort: 9876,
          maxAttempts: 5,
        });

        // Should find a port that is NOT 9876
        expect(port).toBeGreaterThan(9876);
        expect(port).toBeLessThan(9881);
      } finally {
        await new Promise<void>((resolve) => {
          blockingServer.close(() => resolve());
        });
      }
    });

    it("should throw if no ports are available within maxAttempts", async () => {
      // Occupy several ports
      const servers: Array<net.Server> = [];
      for (let i = 0; i < 3; i++) {
        const server = net.createServer();
        await new Promise<void>((resolve) => {
          server.listen(9876 + i, () => resolve());
        });
        servers.push(server);
      }

      try {
        await expect(
          findAvailablePort({ startPort: 9876, maxAttempts: 3 }),
        ).rejects.toThrow();
      } finally {
        for (const server of servers) {
          await new Promise<void>((resolve) => {
            server.close(() => resolve());
          });
        }
      }
    });
  });

  describe("getGoogleAuthUrl", () => {
    it("should build a valid Google OAuth URL with required parameters", () => {
      const url = getGoogleAuthUrl({
        clientId: "test-client-id",
        redirectUri: "http://localhost:9876",
        state: "test-state-nonce",
      });

      const parsed = new URL(url);
      expect(parsed.origin).toBe("https://accounts.google.com");
      expect(parsed.pathname).toBe("/o/oauth2/v2/auth");
      expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
      expect(parsed.searchParams.get("redirect_uri")).toBe(
        "http://localhost:9876",
      );
      expect(parsed.searchParams.get("state")).toBe("test-state-nonce");
      expect(parsed.searchParams.get("response_type")).toBe("code");
      expect(parsed.searchParams.get("scope")).toContain("openid");
      expect(parsed.searchParams.get("scope")).toContain("email");
      expect(parsed.searchParams.get("access_type")).toBe("offline");
    });
  });

  describe("generateState", () => {
    it("should generate a random hex string", () => {
      const state = generateState();

      expect(state).toMatch(/^[0-9a-f]+$/);
      expect(state.length).toBe(32); // 16 bytes = 32 hex chars
    });

    it("should generate unique values on each call", () => {
      const state1 = generateState();
      const state2 = generateState();

      expect(state1).not.toBe(state2);
    });
  });

  describe("startAuthServer", () => {
    let server: http.Server | null = null;

    /**
     * Helper to make an HTTP GET request to the local server without using global fetch
     * @param url - The URL to request
     */
    const httpGet = (url: string): Promise<{ statusCode: number }> => {
      return new Promise((resolve, reject) => {
        http
          .get(url, (res) => {
            // Consume response data to free up memory
            res.resume();
            resolve({ statusCode: res.statusCode ?? 0 });
          })
          .on("error", reject);
      });
    };

    afterEach(async () => {
      if (server != null) {
        await new Promise<void>((resolve) => {
          server!.close(() => resolve());
        });
        server = null;
      }
    });

    it("should capture the authorization code from the OAuth callback", async () => {
      const expectedState = "test-state-123";

      const authPromise = startAuthServer({
        port: 9877,
        expectedState,
        timeoutMs: 5000,
      });

      // Simulate Google redirecting the browser to our local server
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const response = await httpGet(
        `http://localhost:9877?code=auth-code-xyz&state=${expectedState}`,
      );
      expect(response.statusCode).toBe(200);

      const result = await authPromise;
      expect(result.code).toBe("auth-code-xyz");
      server = result.server;
    });

    it("should reject when state parameter does not match (CSRF protection)", async () => {
      const authPromise = startAuthServer({
        port: 9878,
        expectedState: "correct-state",
        timeoutMs: 5000,
      });

      // Wait for server to start, then simulate callback with wrong state
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      // Fire off the request and await the rejection concurrently
      const [rejection] = await Promise.allSettled([
        authPromise,
        httpGet("http://localhost:9878?code=stolen-code&state=wrong-state"),
      ]);

      expect(rejection.status).toBe("rejected");
      expect((rejection as PromiseRejectedResult).reason.message).toMatch(
        /state/i,
      );
    });

    it("should reject when Google returns an error (user denies consent)", async () => {
      const authPromise = startAuthServer({
        port: 9879,
        expectedState: "test-state",
        timeoutMs: 5000,
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const [rejection] = await Promise.allSettled([
        authPromise,
        httpGet("http://localhost:9879?error=access_denied&state=test-state"),
      ]);

      expect(rejection.status).toBe("rejected");
      expect((rejection as PromiseRejectedResult).reason.message).toMatch(
        /denied|access_denied/i,
      );
    });

    it("should reject on timeout when no callback arrives", async () => {
      await expect(
        startAuthServer({
          port: 9880,
          expectedState: "test-state",
          timeoutMs: 500, // Short timeout for testing
        }),
      ).rejects.toThrow(/timed out/i);
    });
  });

  describe("exchangeCodeForTokens", () => {
    it("should exchange an authorization code for Google tokens", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id_token: "google-id-token-abc",
            access_token: "google-access-token-xyz",
            token_type: "Bearer",
            expires_in: 3600,
          }),
      });

      const result = await exchangeCodeForTokens({
        code: "auth-code-123",
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        redirectUri: "http://localhost:9876",
      });

      expect(result.idToken).toBe("google-id-token-abc");
      expect(result.accessToken).toBe("google-access-token-xyz");

      // Verify the token exchange request was made correctly
      expect(mockFetch).toHaveBeenCalledWith(
        "https://oauth2.googleapis.com/token",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/x-www-form-urlencoded",
          }),
        }),
      );

      // Verify request body contains required parameters
      const callArgs = mockFetch.mock.calls[0];
      const body = callArgs[1].body as string;
      expect(body).toContain("code=auth-code-123");
      expect(body).toContain("client_id=test-client-id");
      expect(body).toContain("client_secret=test-client-secret");
      expect(body).toContain(
        `redirect_uri=${encodeURIComponent("http://localhost:9876")}`,
      );
      expect(body).toContain("grant_type=authorization_code");
    });

    it("should throw when token exchange fails", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({
            error: "invalid_grant",
            error_description: "Code has expired",
          }),
      });

      await expect(
        exchangeCodeForTokens({
          code: "expired-code",
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
          redirectUri: "http://localhost:9876",
        }),
      ).rejects.toThrow();
    });

    it("should throw when network request fails", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      await expect(
        exchangeCodeForTokens({
          code: "some-code",
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
          redirectUri: "http://localhost:9876",
        }),
      ).rejects.toThrow();
    });
  });

  describe("validateOAuthCredentials", () => {
    it("should not throw when real credentials are configured", () => {
      expect(() => validateOAuthCredentials()).not.toThrow();
    });
  });
});
