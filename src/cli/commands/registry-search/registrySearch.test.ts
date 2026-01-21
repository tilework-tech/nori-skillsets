/**
 * Tests for registry-search CLI command
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

// Mock the config module - include getInstalledAgents with real implementation
vi.mock("@/cli/config.js", async () => {
  return {
    loadConfig: vi.fn(),
    getInstalledAgents: (args: {
      config: { agents?: Record<string, unknown> | null };
    }) => {
      const agents = Object.keys(args.config.agents ?? {});
      return agents.length > 0 ? agents : ["claude-code"];
    },
  };
});

// Mock console methods to capture output
const mockConsoleLog = vi
  .spyOn(console, "log")
  .mockImplementation(() => undefined);
const mockConsoleError = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

import { registrarApi, REGISTRAR_URL } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { loadConfig } from "@/cli/config.js";
import { stripAnsi } from "@/cli/features/test-utils/index.js";

import { registrySearchMain } from "./registrySearch.js";

/**
 * Get all console output as a single string with ANSI codes stripped
 * @returns Combined log and error output with ANSI codes stripped
 */
const getAllOutput = (): string => {
  const logOutput = mockConsoleLog.mock.calls
    .map((call) => call.join(" "))
    .join("\n");
  const errorOutput = mockConsoleError.mock.calls
    .map((call) => call.join(" "))
    .join("\n");
  return stripAnsi(logOutput + "\n" + errorOutput);
};

describe("registry-search", () => {
  let testDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    testDir = await fs.mkdtemp(path.join(tmpdir(), "nori-cli-search-test-"));
    await fs.writeFile(
      path.join(testDir, ".nori-config.json"),
      JSON.stringify({
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
      }),
    );
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
      agents: {
        "claude-code": { profile: { baseProfile: "senior-swe" } },
      },
      auth: {
        username: "user@example.com",
        organizationUrl: "https://myorg.tilework.tech",
        refreshToken: "mock-refresh-token",
      },
    });
    vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  describe("registrySearchMain - org registry search", () => {
    it("should search org registry derived from config.auth", async () => {
      const mockPackages = [
        {
          id: "1",
          name: "typescript-profile",
          description: "A TypeScript profile",
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

      await registrySearchMain({ query: "typescript", installDir: testDir });

      expect(registrarApi.searchPackagesOnRegistry).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "typescript",
          registryUrl: "https://myorg.nori-registry.ai",
          authToken: "mock-auth-token",
        }),
      );
      const output = getAllOutput();
      expect(output).toContain("https://myorg.nori-registry.ai");
      expect(output).toContain("-> typescript-profile");
    });

    it("should display no results message when registry returns empty", async () => {
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue([]);
      // Also mock public registry to return empty
      vi.mocked(registrarApi.searchPackages).mockResolvedValue([]);

      await registrySearchMain({ query: "nonexistent", installDir: testDir });

      const output = getAllOutput();
      expect(output.toLowerCase()).toContain("no");
    });

    it("should handle API errors gracefully", async () => {
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockRejectedValue(
        new Error("Network error"),
      );
      // Also mock public registry to fail
      vi.mocked(registrarApi.searchPackages).mockRejectedValue(
        new Error("Network error"),
      );

      await registrySearchMain({ query: "test", installDir: testDir });

      const output = getAllOutput();
      expect(output.toLowerCase()).toContain("error");
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
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
      });

      await registrySearchMain({ query: "test", installDir: testDir });

      // Should search public registry without auth
      expect(registrarApi.searchPackages).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "test",
        }),
      );
      // Should NOT have authToken in the call
      expect(registrarApi.searchPackages).toHaveBeenCalledWith(
        expect.not.objectContaining({
          authToken: expect.any(String),
        }),
      );
      // Should NOT search org registry since no auth
      expect(registrarApi.searchPackagesOnRegistry).not.toHaveBeenCalled();
      const output = getAllOutput();
      expect(output).toContain(REGISTRAR_URL);
      expect(output).toContain("-> public-profile");
    });
  });

  describe("registrySearchMain - combined registry search", () => {
    it("should search both org registry and public registry when auth configured", async () => {
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

      await registrySearchMain({ query: "profile", installDir: testDir });

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
      const output = getAllOutput();
      // Org results should appear first (private first, then public)
      expect(output).toContain("https://myorg.nori-registry.ai");
      expect(output).toContain("-> org-profile");
      expect(output).toContain(REGISTRAR_URL);
      expect(output).toContain("-> public-profile");
    });

    it("should show org results before public results", async () => {
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

      await registrySearchMain({ query: "profile", installDir: testDir });

      const output = getAllOutput();
      // Org registry URL should appear before public registry URL
      const orgIndex = output.indexOf("https://myorg.nori-registry.ai");
      const publicIndex = output.indexOf(REGISTRAR_URL);
      expect(orgIndex).toBeLessThan(publicIndex);
    });

    it("should show only public results when org search fails", async () => {
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

      await registrySearchMain({ query: "profile", installDir: testDir });

      const output = getAllOutput();
      expect(output).toContain(REGISTRAR_URL);
      expect(output).toContain("-> public-profile");
    });

    it("should show only org results when public search fails", async () => {
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
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue(
        mockOrgPackages,
      );
      vi.mocked(registrarApi.searchPackages).mockRejectedValue(
        new Error("Public search failed"),
      );

      await registrySearchMain({ query: "profile", installDir: testDir });

      const output = getAllOutput();
      expect(output).toContain("https://myorg.nori-registry.ai");
      expect(output).toContain("-> org-profile");
    });

    it("should show no results message when both registries return empty", async () => {
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue([]);
      vi.mocked(registrarApi.searchPackages).mockResolvedValue([]);

      await registrySearchMain({ query: "nonexistent", installDir: testDir });

      const output = getAllOutput();
      expect(output.toLowerCase()).toContain("no");
    });
  });

  describe("cursor-agent validation", () => {
    it("should fail when only cursor-agent is installed", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "cursor-agent": { profile: { baseProfile: "amol" } } },
        auth: {
          username: "user@example.com",
          organizationUrl: "https://myorg.tilework.tech",
          refreshToken: "token",
        },
      });

      await registrySearchMain({ query: "test", installDir: testDir });

      expect(registrarApi.searchPackagesOnRegistry).not.toHaveBeenCalled();
      const output = getAllOutput();
      expect(output.toLowerCase()).toContain("not supported");
    });
  });
});
