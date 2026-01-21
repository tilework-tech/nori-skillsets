/**
 * Tests for registry-search CLI command
 * Searches both public registry (no auth) and org registry (with auth)
 * Returns both profiles and skills from each registry
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
    searchSkills: vi.fn(),
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
    // Default: mock public registry returns empty
    vi.mocked(registrarApi.searchPackages).mockResolvedValue([]);
    vi.mocked(registrarApi.searchSkills).mockResolvedValue([]);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  describe("unified search - profiles and skills from org registry", () => {
    it("should search both profiles and skills APIs on org registry", async () => {
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
      const mockSkills = [
        {
          id: "2",
          name: "typescript-skill",
          description: "A TypeScript skill",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue(
        mockPackages,
      );
      // Mock org skills search (called with authToken)
      vi.mocked(registrarApi.searchSkills).mockImplementation(async (args) => {
        if (args.authToken != null) {
          return mockSkills;
        }
        return []; // Public registry returns empty
      });

      await registrySearchMain({ query: "typescript", installDir: testDir });

      // Verify org registry APIs were called with auth
      expect(registrarApi.searchPackagesOnRegistry).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "typescript",
          registryUrl: "https://myorg.nori-registry.ai",
          authToken: "mock-auth-token",
        }),
      );
      expect(registrarApi.searchSkills).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "typescript",
          registryUrl: "https://myorg.nori-registry.ai",
          authToken: "mock-auth-token",
        }),
      );
    });

    it("should display results with Profiles and Skills section headers", async () => {
      const mockPackages = [
        {
          id: "1",
          name: "my-profile",
          description: "A profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];
      const mockSkills = [
        {
          id: "2",
          name: "my-skill",
          description: "A skill",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue(
        mockPackages,
      );
      vi.mocked(registrarApi.searchSkills).mockImplementation(async (args) => {
        if (args.authToken != null) {
          return mockSkills;
        }
        return [];
      });

      await registrySearchMain({ query: "my", installDir: testDir });

      const output = getAllOutput();
      expect(output).toContain("Profiles:");
      expect(output).toContain("my-profile");
      expect(output).toContain("Skills:");
      expect(output).toContain("my-skill");
    });

    it("should show only Profiles section when no skills found", async () => {
      const mockPackages = [
        {
          id: "1",
          name: "only-profile",
          description: "A profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue(
        mockPackages,
      );
      vi.mocked(registrarApi.searchSkills).mockResolvedValue([]);

      await registrySearchMain({ query: "only", installDir: testDir });

      const output = getAllOutput();
      expect(output).toContain("Profiles:");
      expect(output).toContain("only-profile");
      expect(output).not.toContain("Skills:");
    });

    it("should show only Skills section when no profiles found", async () => {
      const mockSkills = [
        {
          id: "1",
          name: "only-skill",
          description: "A skill",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue([]);
      vi.mocked(registrarApi.searchSkills).mockImplementation(async (args) => {
        if (args.authToken != null) {
          return mockSkills;
        }
        return [];
      });

      await registrySearchMain({ query: "only", installDir: testDir });

      const output = getAllOutput();
      expect(output).not.toContain("Profiles:");
      expect(output).toContain("Skills:");
      expect(output).toContain("only-skill");
    });

    it("should display no results message when all APIs return empty", async () => {
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue([]);
      vi.mocked(registrarApi.searchPackages).mockResolvedValue([]);
      vi.mocked(registrarApi.searchSkills).mockResolvedValue([]);

      await registrySearchMain({ query: "nonexistent", installDir: testDir });

      const output = getAllOutput();
      expect(output.toLowerCase()).toContain("no");
      expect(output).toContain("nonexistent");
    });

    it("should show profile results and skills error when skills API fails", async () => {
      const mockPackages = [
        {
          id: "1",
          name: "good-profile",
          description: "A profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue(
        mockPackages,
      );
      vi.mocked(registrarApi.searchSkills).mockRejectedValue(
        new Error("Skills API error"),
      );
      vi.mocked(registrarApi.searchPackages).mockResolvedValue([]);

      await registrySearchMain({ query: "test", installDir: testDir });

      const output = getAllOutput();
      expect(output).toContain("Profiles:");
      expect(output).toContain("good-profile");
      expect(output.toLowerCase()).toContain("error");
      expect(output).toContain("Skills API error");
    });

    it("should show skills results and profiles error when profiles API fails", async () => {
      const mockSkills = [
        {
          id: "1",
          name: "good-skill",
          description: "A skill",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockRejectedValue(
        new Error("Profiles API error"),
      );
      vi.mocked(registrarApi.searchSkills).mockImplementation(async (args) => {
        if (args.authToken != null) {
          return mockSkills;
        }
        return [];
      });
      vi.mocked(registrarApi.searchPackages).mockResolvedValue([]);

      await registrySearchMain({ query: "test", installDir: testDir });

      const output = getAllOutput();
      expect(output).toContain("Skills:");
      expect(output).toContain("good-skill");
      expect(output.toLowerCase()).toContain("error");
      expect(output).toContain("Profiles API error");
    });

    it("should show both download hints when both types have results", async () => {
      const mockPackages = [
        {
          id: "1",
          name: "test-profile",
          description: "A profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];
      const mockSkills = [
        {
          id: "2",
          name: "test-skill",
          description: "A skill",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue(
        mockPackages,
      );
      vi.mocked(registrarApi.searchSkills).mockImplementation(async (args) => {
        if (args.authToken != null) {
          return mockSkills;
        }
        return [];
      });

      await registrySearchMain({ query: "test", installDir: testDir });

      const output = getAllOutput();
      expect(output).toContain("registry-download");
      expect(output).toContain("skill-download");
    });

    it("should only show profile download hint when only profiles found", async () => {
      const mockPackages = [
        {
          id: "1",
          name: "test-profile",
          description: "A profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue(
        mockPackages,
      );
      vi.mocked(registrarApi.searchSkills).mockResolvedValue([]);

      await registrySearchMain({ query: "test", installDir: testDir });

      const output = getAllOutput();
      expect(output).toContain("registry-download");
      expect(output).not.toContain("skill-download");
    });

    it("should only show skill download hint when only skills found", async () => {
      const mockSkills = [
        {
          id: "1",
          name: "test-skill",
          description: "A skill",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue([]);
      vi.mocked(registrarApi.searchSkills).mockImplementation(async (args) => {
        if (args.authToken != null) {
          return mockSkills;
        }
        return [];
      });

      await registrySearchMain({ query: "test", installDir: testDir });

      const output = getAllOutput();
      expect(output).not.toContain("registry-download");
      expect(output).toContain("skill-download");
    });
  });

  describe("public registry search (no auth)", () => {
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

    it("should search public skills without auth when no org auth configured", async () => {
      const mockPublicSkills = [
        {
          id: "1",
          name: "public-skill",
          description: "A public skill",
          authorEmail: "public@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];
      vi.mocked(registrarApi.searchSkills).mockResolvedValue(mockPublicSkills);
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
      });

      await registrySearchMain({ query: "test", installDir: testDir });

      // Should search public skills without auth
      expect(registrarApi.searchSkills).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "test",
        }),
      );
      // Should NOT have authToken in the call for public registry
      expect(registrarApi.searchSkills).toHaveBeenCalledWith(
        expect.not.objectContaining({
          authToken: expect.any(String),
        }),
      );
      const output = getAllOutput();
      expect(output).toContain(REGISTRAR_URL);
      expect(output).toContain("-> public-skill");
    });
  });

  describe("combined registry search (org + public)", () => {
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
      vi.mocked(registrarApi.searchSkills).mockResolvedValue([]);

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
      expect(registrarApi.searchSkills).not.toHaveBeenCalled();
      const output = getAllOutput();
      expect(output.toLowerCase()).toContain("not supported");
    });
  });

  describe("cliName in user-facing messages", () => {
    it("should use seaweed command names in install hints when cliName is seaweed", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        registryAuths: [],
      });

      // Mock public registry search functions (no org auth = only public registry is searched)
      vi.mocked(registrarApi.searchPackages).mockResolvedValue([
        {
          id: "1",
          name: "test-profile",
          description: "A test profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ]);
      vi.mocked(registrarApi.searchSkills).mockResolvedValue([
        {
          id: "2",
          name: "test-skill",
          description: "A test skill",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ]);

      await registrySearchMain({
        query: "test",
        installDir: testDir,
        cliName: "seaweed",
      });

      const output = getAllOutput();
      expect(output).toContain("seaweed download");
      expect(output).toContain("seaweed download-skill");
      expect(output).not.toContain("nori-ai registry-download");
      expect(output).not.toContain("nori-ai skill-download");
    });

    it("should use nori-ai command names in install hints when cliName is nori-ai", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        registryAuths: [],
      });

      // Mock public registry search functions (no org auth = only public registry is searched)
      vi.mocked(registrarApi.searchPackages).mockResolvedValue([
        {
          id: "1",
          name: "test-profile",
          description: "A test profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ]);
      vi.mocked(registrarApi.searchSkills).mockResolvedValue([
        {
          id: "2",
          name: "test-skill",
          description: "A test skill",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ]);

      await registrySearchMain({
        query: "test",
        installDir: testDir,
        cliName: "nori-ai",
      });

      const output = getAllOutput();
      expect(output).toContain("nori-ai registry-download");
      expect(output).toContain("nori-ai skill-download");
      expect(output).not.toContain("seaweed download");
    });

    it("should default to nori-ai command names when cliName is not provided", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        registryAuths: [],
      });

      // Mock public registry search functions (no org auth = only public registry is searched)
      vi.mocked(registrarApi.searchPackages).mockResolvedValue([
        {
          id: "1",
          name: "test-profile",
          description: "A test profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ]);
      vi.mocked(registrarApi.searchSkills).mockResolvedValue([]);

      await registrySearchMain({
        query: "test",
        installDir: testDir,
      });

      const output = getAllOutput();
      expect(output).toContain("nori-ai registry-download");
    });
  });
});
