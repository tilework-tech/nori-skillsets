/**
 * Tests for nori-registry-search intercepted slash command
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the registrar API
vi.mock("@/api/registrar.js", () => ({
  registrarApi: {
    searchPackages: vi.fn(),
    searchPackagesOnRegistry: vi.fn(),
  },
  REGISTRAR_URL: "https://registrar.tilework.tech",
}));

// Mock the registry auth module
vi.mock("@/api/registryAuth.js", () => ({
  getRegistryAuthToken: vi.fn(),
}));

import { registrarApi, REGISTRAR_URL } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";

import type { HookInput } from "./types.js";

import { noriRegistrySearch } from "./nori-registry-search.js";

// Unicode symbols for cursor-agent output (no ANSI codes)
const SUCCESS_SYMBOL = "\u2713"; // ✓
const ERROR_SYMBOL = "\u2717"; // ✗

// ANSI pattern to verify output contains no escape codes
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/;

/**
 * Strip ANSI escape codes from a string for plain text comparison
 * Note: cursor-agent output no longer contains ANSI codes, but this
 * function is kept for backwards compatibility with existing tests.
 *
 * @param str - The string to process
 *
 * @returns The string with any ANSI codes removed
 */
const stripAnsi = (str: string): string => {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
};

describe("nori-registry-search", () => {
  let testDir: string;
  let configPath: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test directory structure simulating a Nori installation
    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-registry-search-test-"),
    );
    configPath = path.join(testDir, ".nori-config.json");

    // Create initial config
    await fs.writeFile(
      configPath,
      JSON.stringify({
        profile: {
          baseProfile: "senior-swe",
        },
      }),
    );
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  const createInput = (args: {
    prompt: string;
    cwd?: string | null;
  }): HookInput => {
    const { prompt, cwd } = args;
    return {
      prompt,
      cwd: cwd ?? testDir,

      hook_event_name: "beforeSubmitPrompt",
    };
  };

  describe("matchers", () => {
    it("should have valid regex matchers", () => {
      expect(noriRegistrySearch.matchers).toBeInstanceOf(Array);
      expect(noriRegistrySearch.matchers.length).toBeGreaterThan(0);

      for (const matcher of noriRegistrySearch.matchers) {
        expect(() => new RegExp(matcher)).not.toThrow();
      }
    });

    it("should match /nori-registry-search query", () => {
      const hasMatch = noriRegistrySearch.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-registry-search test");
      });
      expect(hasMatch).toBe(true);
    });

    it("should match /nori-registry-search with multiple words", () => {
      const hasMatch = noriRegistrySearch.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-registry-search typescript react");
      });
      expect(hasMatch).toBe(true);
    });

    it("should match /nori-registry-search without query (shows help)", () => {
      const matchesWithoutQuery = noriRegistrySearch.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-registry-search");
      });
      expect(matchesWithoutQuery).toBe(true);
    });
  });

  describe("run function", () => {
    it("should show help message when no query provided", async () => {
      const input = createInput({
        prompt: "/nori-registry-search",
      });
      const result = await noriRegistrySearch.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Usage:");
      expect(plainReason).toContain("/nori-registry-search <query>");
    });

    it("should return error when no installation found", async () => {
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-registry-search-no-install-"),
      );

      try {
        const input = createInput({
          prompt: "/nori-registry-search test",
          cwd: noInstallDir,
        });
        const result = await noriRegistrySearch.run({ input });

        expect(result).not.toBeNull();
        expect(result!.decision).toBe("block");
        expect(stripAnsi(result!.reason!)).toContain(
          "No Nori installation found",
        );
      } finally {
        await fs.rm(noInstallDir, { recursive: true, force: true });
      }
    });

    it("should display search results when packages found", async () => {
      const mockPackages = [
        {
          id: "pkg-1",
          name: "test-profile",
          description: "A test profile for developers",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "pkg-2",
          name: "another-profile",
          description: "Another great profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-02T00:00:00.000Z",
          updatedAt: "2024-01-02T00:00:00.000Z",
        },
      ];

      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue(
        mockPackages,
      );

      const input = createInput({
        prompt: "/nori-registry-search test",
      });
      const result = await noriRegistrySearch.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("test-profile");
      expect(plainReason).toContain("another-profile");
      expect(plainReason).toContain("A test profile");

      // Verify API was called with correct query
      expect(registrarApi.searchPackagesOnRegistry).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "test",
          registryUrl: REGISTRAR_URL,
        }),
      );
    });

    it("should display no results message when empty", async () => {
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue([]);

      const input = createInput({
        prompt: "/nori-registry-search nonexistent",
      });
      const result = await noriRegistrySearch.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(stripAnsi(result!.reason!)).toContain("No profiles found");
    });

    it("should handle network errors gracefully", async () => {
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockRejectedValue(
        new Error("Network error: Failed to fetch"),
      );

      const input = createInput({
        prompt: "/nori-registry-search test",
      });
      const result = await noriRegistrySearch.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(stripAnsi(result!.reason!)).toContain("Failed");
    });

    it("should pass multi-word query to API", async () => {
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue([]);

      const input = createInput({
        prompt: "/nori-registry-search typescript react developer",
      });
      await noriRegistrySearch.run({ input });

      expect(registrarApi.searchPackagesOnRegistry).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "typescript react developer",
        }),
      );
    });
  });

  describe("output formatting (no ANSI codes)", () => {
    it("should format success results with success symbol and no ANSI codes", async () => {
      const mockPackages = [
        {
          id: "pkg-1",
          name: "test-profile",
          description: "A test profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue(
        mockPackages,
      );

      const input = createInput({
        prompt: "/nori-registry-search test",
      });
      const result = await noriRegistrySearch.run({ input });

      expect(result).not.toBeNull();
      expect(result!.reason).toContain(SUCCESS_SYMBOL);
      expect(result!.reason).not.toMatch(ANSI_PATTERN);
    });

    it("should format no results message with success symbol and no ANSI codes", async () => {
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue([]);

      const input = createInput({
        prompt: "/nori-registry-search nonexistent",
      });
      const result = await noriRegistrySearch.run({ input });

      expect(result).not.toBeNull();
      expect(result!.reason).toContain(SUCCESS_SYMBOL);
      expect(result!.reason).not.toMatch(ANSI_PATTERN);
    });

    it("should format error messages with error symbol and no ANSI codes", async () => {
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockRejectedValue(
        new Error("Network error"),
      );

      const input = createInput({
        prompt: "/nori-registry-search test",
      });
      const result = await noriRegistrySearch.run({ input });

      expect(result).not.toBeNull();
      expect(result!.reason).toContain(ERROR_SYMBOL);
      expect(result!.reason).not.toMatch(ANSI_PATTERN);
    });

    it("should format no installation error with error symbol and no ANSI codes", async () => {
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-search-no-install-"),
      );

      try {
        const input = createInput({
          prompt: "/nori-registry-search test",
          cwd: noInstallDir,
        });
        const result = await noriRegistrySearch.run({ input });

        expect(result).not.toBeNull();
        expect(result!.reason).toContain(ERROR_SYMBOL);
        expect(result!.reason).not.toMatch(ANSI_PATTERN);
      } finally {
        await fs.rm(noInstallDir, { recursive: true, force: true });
      }
    });

    it("should format help message with success symbol and no ANSI codes", async () => {
      const input = createInput({
        prompt: "/nori-registry-search",
      });
      const result = await noriRegistrySearch.run({ input });

      expect(result).not.toBeNull();
      expect(result!.reason).toContain(SUCCESS_SYMBOL);
      expect(result!.reason).not.toMatch(ANSI_PATTERN);
    });
  });

  describe("multi-registry search", () => {
    it("should search public registry and display results grouped by URL", async () => {
      const mockPackages = [
        {
          id: "pkg-1",
          name: "test-profile",
          description: "A test profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue(
        mockPackages,
      );

      const input = createInput({
        prompt: "/nori-registry-search test",
      });
      const result = await noriRegistrySearch.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      // Should display the registry URL
      expect(plainReason).toContain(REGISTRAR_URL);
      // Should display the package with arrow notation
      expect(plainReason).toContain("-> test-profile");

      // Verify searchPackagesOnRegistry was called with public registry
      expect(registrarApi.searchPackagesOnRegistry).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "test",
          registryUrl: REGISTRAR_URL,
        }),
      );
    });

    it("should search both public and private registries when registryAuths configured", async () => {
      // Create config with private registry auth
      await fs.writeFile(
        configPath,
        JSON.stringify({
          profile: { baseProfile: "senior-swe" },
          registryAuths: [
            {
              username: "user@example.com",
              password: "secret",
              registryUrl: "https://private.registry.com",
            },
          ],
        }),
      );

      const publicPackages = [
        {
          id: "pkg-1",
          name: "public-profile",
          description: "A public profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      const privatePackages = [
        {
          id: "pkg-2",
          name: "private-profile",
          description: "A private profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      vi.mocked(registrarApi.searchPackagesOnRegistry)
        .mockResolvedValueOnce(publicPackages) // Public registry
        .mockResolvedValueOnce(privatePackages); // Private registry

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      const input = createInput({
        prompt: "/nori-registry-search test",
      });
      const result = await noriRegistrySearch.run({ input });

      expect(result).not.toBeNull();
      const plainReason = stripAnsi(result!.reason!);

      // Should display both registry URLs
      expect(plainReason).toContain(REGISTRAR_URL);
      expect(plainReason).toContain("https://private.registry.com");

      // Should display packages from both registries
      expect(plainReason).toContain("-> public-profile");
      expect(plainReason).toContain("-> private-profile");

      // Verify both registries were searched
      expect(registrarApi.searchPackagesOnRegistry).toHaveBeenCalledTimes(2);

      // Verify private registry was called with auth token
      expect(registrarApi.searchPackagesOnRegistry).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "test",
          registryUrl: "https://private.registry.com",
          authToken: "mock-auth-token",
        }),
      );
    });

    it("should skip duplicate registry when registryAuth matches public registry URL", async () => {
      // Create config with registryAuth that matches the public registry
      await fs.writeFile(
        configPath,
        JSON.stringify({
          profile: { baseProfile: "senior-swe" },
          registryAuths: [
            {
              username: "user@example.com",
              password: "secret",
              registryUrl: REGISTRAR_URL,
            },
          ],
        }),
      );

      const mockPackages = [
        {
          id: "pkg-1",
          name: "test-profile",
          description: "A test profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue(
        mockPackages,
      );

      const input = createInput({
        prompt: "/nori-registry-search test",
      });
      await noriRegistrySearch.run({ input });

      // Should only search once (public registry), not twice
      expect(registrarApi.searchPackagesOnRegistry).toHaveBeenCalledTimes(1);
    });

    it("should continue searching other registries when one fails with error", async () => {
      // Create config with two private registries
      await fs.writeFile(
        configPath,
        JSON.stringify({
          profile: { baseProfile: "senior-swe" },
          registryAuths: [
            {
              username: "user@example.com",
              password: "secret",
              registryUrl: "https://failing.registry.com",
            },
            {
              username: "user@example.com",
              password: "secret",
              registryUrl: "https://working.registry.com",
            },
          ],
        }),
      );

      const publicPackages = [
        {
          id: "pkg-1",
          name: "public-profile",
          description: "A public profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      const workingPackages = [
        {
          id: "pkg-2",
          name: "working-profile",
          description: "A working profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      // Mock sequence:
      // 1. Public registry search (success) - no auth needed
      // 2. First private registry: auth token fails, so search never called
      // 3. Second private registry: auth token succeeds, search succeeds
      vi.mocked(registrarApi.searchPackagesOnRegistry)
        .mockResolvedValueOnce(publicPackages) // Public registry
        .mockResolvedValueOnce(workingPackages); // Working private registry (failing one doesn't call search)

      vi.mocked(getRegistryAuthToken)
        .mockRejectedValueOnce(new Error("Auth failed")) // First private registry auth fails
        .mockResolvedValueOnce("mock-auth-token"); // Second private registry auth succeeds

      const input = createInput({
        prompt: "/nori-registry-search test",
      });
      const result = await noriRegistrySearch.run({ input });

      expect(result).not.toBeNull();
      const plainReason = stripAnsi(result!.reason!);

      // Should still show results from working registries
      expect(plainReason).toContain("-> public-profile");
      expect(plainReason).toContain("-> working-profile");

      // Should show error for failing registry
      expect(plainReason).toContain("https://failing.registry.com");
      expect(plainReason).toContain("Error:");
    });

    it("should skip registries with no results in output", async () => {
      // Create config with private registry
      await fs.writeFile(
        configPath,
        JSON.stringify({
          profile: { baseProfile: "senior-swe" },
          registryAuths: [
            {
              username: "user@example.com",
              password: "secret",
              registryUrl: "https://empty.registry.com",
            },
          ],
        }),
      );

      const publicPackages = [
        {
          id: "pkg-1",
          name: "public-profile",
          description: "A public profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      vi.mocked(registrarApi.searchPackagesOnRegistry)
        .mockResolvedValueOnce(publicPackages) // Public registry has results
        .mockResolvedValueOnce([]); // Private registry empty

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      const input = createInput({
        prompt: "/nori-registry-search test",
      });
      const result = await noriRegistrySearch.run({ input });

      expect(result).not.toBeNull();
      const plainReason = stripAnsi(result!.reason!);

      // Should show public registry results
      expect(plainReason).toContain(REGISTRAR_URL);
      expect(plainReason).toContain("-> public-profile");

      // Should NOT show empty registry URL
      expect(plainReason).not.toContain("https://empty.registry.com");
    });

    it("should display no results message when all registries return empty", async () => {
      // Create config with private registry
      await fs.writeFile(
        configPath,
        JSON.stringify({
          profile: { baseProfile: "senior-swe" },
          registryAuths: [
            {
              username: "user@example.com",
              password: "secret",
              registryUrl: "https://private.registry.com",
            },
          ],
        }),
      );

      vi.mocked(registrarApi.searchPackagesOnRegistry)
        .mockResolvedValueOnce([]) // Public registry empty
        .mockResolvedValueOnce([]); // Private registry empty

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      const input = createInput({
        prompt: "/nori-registry-search nonexistent",
      });
      const result = await noriRegistrySearch.run({ input });

      expect(result).not.toBeNull();
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("No profiles found");
    });

    it("should display package description after colon", async () => {
      const mockPackages = [
        {
          id: "pkg-1",
          name: "my-profile",
          description: "This is a great profile for developers",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue(
        mockPackages,
      );

      const input = createInput({
        prompt: "/nori-registry-search test",
      });
      const result = await noriRegistrySearch.run({ input });

      expect(result).not.toBeNull();
      const plainReason = stripAnsi(result!.reason!);
      // Format should be "-> name: description"
      expect(plainReason).toContain(
        "-> my-profile: This is a great profile for developers",
      );
    });
  });
});
