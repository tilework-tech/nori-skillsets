/**
 * Tests for registry-search CLI command
 * Searches both public registry (no auth) and org registry (with auth)
 * Returns both profiles and skills from each registry
 *
 * Since registrySearchMain always delegates to registrySearchFlow (from @clack/prompts),
 * these tests mock the flow to capture the onSearch callback result (SearchFlowResult)
 * and assert on the data returned by the internal performSearch logic.
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
  ApiError: class ApiError extends Error {
    readonly isApiError = true;
    constructor(
      message: string,
      readonly statusCode: number,
    ) {
      super(message);
      this.name = "ApiError";
    }
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

/**
 * Captured search result from the registrySearchFlow mock.
 * Each test invocation of registrySearchMain will populate this via the onSearch callback.
 */
let capturedSearchResult: SearchFlowResult | null = null;

// Mock the registrySearchFlow to capture the onSearch callback result
vi.mock("@/cli/prompts/flows/index.js", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    registrySearchFlow: vi.fn(
      async (args: {
        callbacks: { onSearch: () => Promise<SearchFlowResult> };
      }) => {
        capturedSearchResult = await args.callbacks.onSearch();
        if (!capturedSearchResult.success) {
          return null;
        }
        if (!capturedSearchResult.hasResults) {
          return { found: false };
        }
        return { found: true };
      },
    ),
  };
});

import { registrarApi } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { loadConfig } from "@/cli/config.js";

import type { SearchFlowResult } from "@/cli/prompts/flows/index.js";

import { registrySearchMain } from "./registrySearch.js";

/**
 * Get the formatted results string from the captured search result.
 * This replaces the old getAllOutput() approach that relied on console.log spying.
 *
 * @returns The formatted results and download hints combined, or empty strings for no-result/error cases
 */
const getSearchOutput = (): string => {
  if (capturedSearchResult == null) {
    return "";
  }
  if (!capturedSearchResult.success) {
    return capturedSearchResult.error;
  }
  if (!capturedSearchResult.hasResults) {
    return `No skillsets or skills found matching "${capturedSearchResult.query}".`;
  }
  const parts: Array<string> = [];
  if (capturedSearchResult.formattedResults) {
    parts.push(capturedSearchResult.formattedResults);
  }
  if (capturedSearchResult.downloadHints) {
    parts.push(capturedSearchResult.downloadHints);
  }
  return parts.join("\n");
};

describe("registry-search", () => {
  let testDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    capturedSearchResult = null;
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

      const output = getSearchOutput();
      expect(output).toContain("Skillsets:");
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

      const output = getSearchOutput();
      expect(output).toContain("Skillsets:");
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

      const output = getSearchOutput();
      expect(output).not.toContain("Skillsets:");
      expect(output).toContain("Skills:");
      expect(output).toContain("only-skill");
    });

    it("should display no results message when all APIs return empty", async () => {
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue([]);
      vi.mocked(registrarApi.searchPackages).mockResolvedValue([]);
      vi.mocked(registrarApi.searchSkills).mockResolvedValue([]);

      await registrySearchMain({ query: "nonexistent", installDir: testDir });

      const output = getSearchOutput();
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

      const output = getSearchOutput();
      expect(output).toContain("Skillsets:");
      expect(output).toContain("good-profile");
      // Errors are now hidden for cleaner output
      expect(output).not.toContain("Skills API error");
    });

    it("should show skills results when profiles API fails", async () => {
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

      const output = getSearchOutput();
      expect(output).toContain("Skills:");
      expect(output).toContain("good-skill");
      // Errors are now hidden for cleaner output
      expect(output).not.toContain("Profiles API error");
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

      const output = getSearchOutput();
      // getCommandNames() now returns nori-skillsets commands: "download" and "download-skill"
      expect(output).toContain("download");
      expect(output).toContain("download-skill");
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

      const output = getSearchOutput();
      expect(output).toContain("download");
      expect(output).not.toContain("download-skill");
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

      const output = getSearchOutput();
      expect(output).toContain("download-skill");
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
      const output = getSearchOutput();
      expect(output).toContain("public:");
      expect(output).toContain("public-profile");
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
      const output = getSearchOutput();
      expect(output).toContain("public:");
      expect(output).toContain("public-skill");
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
      const output = getSearchOutput();
      // Org results should appear first (private first, then public)
      expect(output).toContain("myorg:");
      expect(output).toContain("myorg/org-profile");
      expect(output).toContain("public:");
      expect(output).toContain("public-profile");
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

      const output = getSearchOutput();
      // Org label should appear before public label
      const orgIndex = output.indexOf("myorg:");
      const publicIndex = output.indexOf("public:");
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

      const output = getSearchOutput();
      expect(output).toContain("public:");
      expect(output).toContain("public-profile");
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

      const output = getSearchOutput();
      expect(output).toContain("myorg:");
      expect(output).toContain("myorg/org-profile");
    });

    it("should show no results message when both registries return empty", async () => {
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue([]);
      vi.mocked(registrarApi.searchPackages).mockResolvedValue([]);
      vi.mocked(registrarApi.searchSkills).mockResolvedValue([]);

      await registrySearchMain({ query: "nonexistent", installDir: testDir });

      const output = getSearchOutput();
      expect(output.toLowerCase()).toContain("no");
    });
  });

  describe("cliName in user-facing messages", () => {
    it("should use nori-skillsets command names in install hints when cliName is nori-skillsets", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
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
        cliName: "nori-skillsets",
      });

      const output = getSearchOutput();
      expect(output).toContain("nori-skillsets download");
      expect(output).toContain("nori-skillsets download-skill");
      expect(output).not.toContain("nori-skillsets registry-download");
      expect(output).not.toContain("nori-skillsets skill-download");
    });

    it("should default to nori-skillsets command names when cliName is not provided", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
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

      // When no cliName is provided, prefix defaults to nori-skillsets
      const output = getSearchOutput();
      expect(output).toContain("nori-skillsets download");
    });
  });
});
