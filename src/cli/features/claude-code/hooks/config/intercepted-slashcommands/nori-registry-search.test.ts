/**
 * Tests for nori-registry-search intercepted slash command
 * Searches both public registry (no auth) and org registry (with auth)
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the registrar API
vi.mock("@/api/registrar.js", () => ({
  REGISTRAR_URL: "https://noriskillsets.dev",
  registrarApi: {
    searchPackages: vi.fn(),
    searchPackagesOnRegistry: vi.fn(),
  },
}));

// Mock the registry auth module
vi.mock("@/api/registryAuth.js", () => ({
  getRegistryAuthToken: vi.fn(),
}));

import { registrarApi, REGISTRAR_URL } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { stripAnsi } from "@/cli/features/test-utils/index.js";

import type { HookInput } from "./types.js";

import { noriRegistrySearch } from "./nori-registry-search.js";

describe("nori-registry-search", () => {
  let testDir: string;
  let configPath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-registry-search-test-"),
    );
    configPath = path.join(testDir, ".nori-config.json");
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
      session_id: "test-session",
      transcript_path: "",
      permission_mode: "default",
      hook_event_name: "UserPromptSubmit",
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

    it("should match bare /nori-registry-search command", () => {
      const hasMatch = noriRegistrySearch.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-registry-search");
      });
      expect(hasMatch).toBe(true);
    });
  });

  describe("help message", () => {
    it("should show help when no query provided", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
          auth: {
            username: "user@example.com",
            organizationUrl: "https://myorg.tilework.tech",
            refreshToken: "token",
          },
        }),
      );

      const result = await noriRegistrySearch.run({
        input: createInput({ prompt: "/nori-registry-search" }),
      });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Usage:");
      expect(plainReason).toContain("/nori-registry-search");
    });
  });

  describe("org registry search", () => {
    it("should search org registry derived from config.auth", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
          auth: {
            username: "user@example.com",
            organizationUrl: "https://myorg.tilework.tech",
            refreshToken: "mock-token",
          },
        }),
      );

      const mockPackages = [
        {
          id: "1",
          name: "test-profile",
          description: "A test profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue(
        mockPackages,
      );
      // Also mock public registry to return empty (no results there)
      vi.mocked(registrarApi.searchPackages).mockResolvedValue([]);
      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      const result = await noriRegistrySearch.run({
        input: createInput({ prompt: "/nori-registry-search test" }),
      });

      expect(registrarApi.searchPackagesOnRegistry).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "test",
          registryUrl: "https://myorg.nori-registry.ai",
          authToken: "mock-auth-token",
        }),
      );

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("https://myorg.nori-registry.ai");
      expect(plainReason).toContain("-> test-profile");
    });

    it("should display no results message when empty", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
          auth: {
            username: "user@example.com",
            organizationUrl: "https://myorg.tilework.tech",
            refreshToken: "token",
          },
        }),
      );

      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue([]);
      // Also mock public registry to return empty
      vi.mocked(registrarApi.searchPackages).mockResolvedValue([]);
      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      const result = await noriRegistrySearch.run({
        input: createInput({ prompt: "/nori-registry-search nonexistent" }),
      });

      expect(result).not.toBeNull();
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason.toLowerCase()).toMatch(/no|failed/);
    });

    it("should handle API errors gracefully", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
          auth: {
            username: "user@example.com",
            organizationUrl: "https://myorg.tilework.tech",
            refreshToken: "token",
          },
        }),
      );

      vi.mocked(registrarApi.searchPackagesOnRegistry).mockRejectedValue(
        new Error("Network error"),
      );
      // Also mock public registry to fail
      vi.mocked(registrarApi.searchPackages).mockRejectedValue(
        new Error("Network error"),
      );
      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      const result = await noriRegistrySearch.run({
        input: createInput({ prompt: "/nori-registry-search test" }),
      });

      expect(result).not.toBeNull();
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason.toLowerCase()).toContain("error");
    });

    it("should search public registry without auth when no org auth configured", async () => {
      const mockPublicPackages = [
        {
          id: "1",
          name: "public-profile",
          description: "A public profile",
          authorEmail: "public@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];
      vi.mocked(registrarApi.searchPackages).mockResolvedValue(
        mockPublicPackages,
      );

      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        }),
      );

      const result = await noriRegistrySearch.run({
        input: createInput({ prompt: "/nori-registry-search test" }),
      });

      // Should search public registry without auth
      expect(registrarApi.searchPackages).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "test",
        }),
      );
      // Should NOT search org registry since no auth
      expect(registrarApi.searchPackagesOnRegistry).not.toHaveBeenCalled();
      expect(result).not.toBeNull();
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain(REGISTRAR_URL);
      expect(plainReason).toContain("-> public-profile");
    });
  });

  describe("combined registry search", () => {
    it("should search both org registry and public registry when auth configured", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
          auth: {
            username: "user@example.com",
            organizationUrl: "https://myorg.tilework.tech",
            refreshToken: "mock-token",
          },
        }),
      );

      const mockOrgPackages = [
        {
          id: "1",
          name: "org-profile",
          description: "An org profile",
          authorEmail: "org@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];
      const mockPublicPackages = [
        {
          id: "2",
          name: "public-profile",
          description: "A public profile",
          authorEmail: "public@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue(
        mockOrgPackages,
      );
      vi.mocked(registrarApi.searchPackages).mockResolvedValue(
        mockPublicPackages,
      );
      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      const result = await noriRegistrySearch.run({
        input: createInput({ prompt: "/nori-registry-search profile" }),
      });

      // Should search org registry with auth
      expect(registrarApi.searchPackagesOnRegistry).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "profile",
          registryUrl: "https://myorg.nori-registry.ai",
          authToken: "mock-auth-token",
        }),
      );
      // Should also search public registry without auth
      expect(registrarApi.searchPackages).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "profile",
        }),
      );

      expect(result).not.toBeNull();
      const plainReason = stripAnsi(result!.reason!);
      // Org results should appear first (private first, then public)
      expect(plainReason).toContain("https://myorg.nori-registry.ai");
      expect(plainReason).toContain("-> org-profile");
      expect(plainReason).toContain(REGISTRAR_URL);
      expect(plainReason).toContain("-> public-profile");
    });

    it("should show org results before public results", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
          auth: {
            username: "user@example.com",
            organizationUrl: "https://myorg.tilework.tech",
            refreshToken: "mock-token",
          },
        }),
      );

      const mockOrgPackages = [
        {
          id: "1",
          name: "org-profile",
          description: "An org profile",
          authorEmail: "org@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];
      const mockPublicPackages = [
        {
          id: "2",
          name: "public-profile",
          description: "A public profile",
          authorEmail: "public@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue(
        mockOrgPackages,
      );
      vi.mocked(registrarApi.searchPackages).mockResolvedValue(
        mockPublicPackages,
      );
      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      const result = await noriRegistrySearch.run({
        input: createInput({ prompt: "/nori-registry-search profile" }),
      });

      expect(result).not.toBeNull();
      const plainReason = stripAnsi(result!.reason!);
      // Org registry URL should appear before public registry URL
      const orgIndex = plainReason.indexOf("https://myorg.nori-registry.ai");
      const publicIndex = plainReason.indexOf(REGISTRAR_URL);
      expect(orgIndex).toBeLessThan(publicIndex);
    });

    it("should show only public results when org search fails", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
          auth: {
            username: "user@example.com",
            organizationUrl: "https://myorg.tilework.tech",
            refreshToken: "mock-token",
          },
        }),
      );

      const mockPublicPackages = [
        {
          id: "1",
          name: "public-profile",
          description: "A public profile",
          authorEmail: "public@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockRejectedValue(
        new Error("Org auth failed"),
      );
      vi.mocked(registrarApi.searchPackages).mockResolvedValue(
        mockPublicPackages,
      );
      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      const result = await noriRegistrySearch.run({
        input: createInput({ prompt: "/nori-registry-search profile" }),
      });

      expect(result).not.toBeNull();
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain(REGISTRAR_URL);
      expect(plainReason).toContain("-> public-profile");
    });

    it("should show no results message when both registries return empty", async () => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
          auth: {
            username: "user@example.com",
            organizationUrl: "https://myorg.tilework.tech",
            refreshToken: "mock-token",
          },
        }),
      );

      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue([]);
      vi.mocked(registrarApi.searchPackages).mockResolvedValue([]);
      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      const result = await noriRegistrySearch.run({
        input: createInput({ prompt: "/nori-registry-search nonexistent" }),
      });

      expect(result).not.toBeNull();
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason.toLowerCase()).toContain("no");
    });
  });

  describe("installation detection", () => {
    it("should fail when no installation found", async () => {
      const nonInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "non-install-"),
      );

      const result = await noriRegistrySearch.run({
        input: createInput({
          prompt: "/nori-registry-search test",
          cwd: nonInstallDir,
        }),
      });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason.toLowerCase()).toContain("no nori installation");

      await fs.rm(nonInstallDir, { recursive: true, force: true });
    });
  });
});
