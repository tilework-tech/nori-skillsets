/**
 * Tests for registry-search CLI command
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
 *
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

    // Create test directory for install dir detection
    testDir = await fs.mkdtemp(path.join(tmpdir(), "nori-cli-search-test-"));

    // Create .nori-config.json to mark as Nori installation
    await fs.writeFile(
      path.join(testDir, ".nori-config.json"),
      JSON.stringify({
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
      }),
    );

    // Default mock for loadConfig - no private registries
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
      agents: {
        "claude-code": { profile: { baseProfile: "senior-swe" } },
      },
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  describe("registrySearchMain - multi-registry search", () => {
    it("should search public registry and display results grouped by URL", async () => {
      const mockPackages = [
        {
          id: "1",
          name: "typescript-profile",
          description: "A TypeScript developer profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
        {
          id: "2",
          name: "react-developer",
          description: "React development configuration",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];

      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue(
        mockPackages,
      );

      await registrySearchMain({ query: "typescript", installDir: testDir });

      // Verify searchPackagesOnRegistry was called with public registry
      expect(registrarApi.searchPackagesOnRegistry).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "typescript",
          registryUrl: REGISTRAR_URL,
        }),
      );

      const output = getAllOutput();
      // Should display the registry URL
      expect(output).toContain(REGISTRAR_URL);
      // Should display packages with arrow notation
      expect(output).toContain("-> typescript-profile");
      expect(output).toContain("-> react-developer");
      // Should display descriptions after colon
      expect(output).toContain(": A TypeScript developer profile");
    });

    it("should search both public and private registries when registryAuths configured", async () => {
      // Mock config with private registry
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        registryAuths: [
          {
            username: "user@example.com",
            password: "secret",
            registryUrl: "https://private.registry.com",
          },
        ],
      });

      const publicPackages = [
        {
          id: "1",
          name: "public-profile",
          description: "A public profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];

      const privatePackages = [
        {
          id: "2",
          name: "private-profile",
          description: "A private profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];

      vi.mocked(registrarApi.searchPackagesOnRegistry)
        .mockResolvedValueOnce(publicPackages)
        .mockResolvedValueOnce(privatePackages);

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      await registrySearchMain({ query: "test", installDir: testDir });

      const output = getAllOutput();

      // Should display both registry URLs
      expect(output).toContain(REGISTRAR_URL);
      expect(output).toContain("https://private.registry.com");

      // Should display packages from both registries
      expect(output).toContain("-> public-profile");
      expect(output).toContain("-> private-profile");

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
      // Mock config with registryAuth that matches public registry
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        registryAuths: [
          {
            username: "user@example.com",
            password: "secret",
            registryUrl: REGISTRAR_URL,
          },
        ],
      });

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

      await registrySearchMain({ query: "test", installDir: testDir });

      // Should only search once (public registry), not twice
      expect(registrarApi.searchPackagesOnRegistry).toHaveBeenCalledTimes(1);
    });

    it("should continue searching other registries when one fails with error", async () => {
      // Mock config with two private registries
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
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
      });

      const publicPackages = [
        {
          id: "1",
          name: "public-profile",
          description: "A public profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];

      const workingPackages = [
        {
          id: "2",
          name: "working-profile",
          description: "A working profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];

      vi.mocked(registrarApi.searchPackagesOnRegistry)
        .mockResolvedValueOnce(publicPackages)
        .mockResolvedValueOnce(workingPackages);

      vi.mocked(getRegistryAuthToken)
        .mockRejectedValueOnce(new Error("Auth failed"))
        .mockResolvedValueOnce("mock-auth-token");

      await registrySearchMain({ query: "test", installDir: testDir });

      const output = getAllOutput();

      // Should still show results from working registries
      expect(output).toContain("-> public-profile");
      expect(output).toContain("-> working-profile");

      // Should show error for failing registry
      expect(output).toContain("https://failing.registry.com");
      expect(output).toContain("Error");
    });

    it("should skip registries with no results in output", async () => {
      // Mock config with private registry
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        registryAuths: [
          {
            username: "user@example.com",
            password: "secret",
            registryUrl: "https://empty.registry.com",
          },
        ],
      });

      const publicPackages = [
        {
          id: "1",
          name: "public-profile",
          description: "A public profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];

      vi.mocked(registrarApi.searchPackagesOnRegistry)
        .mockResolvedValueOnce(publicPackages)
        .mockResolvedValueOnce([]);

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      await registrySearchMain({ query: "test", installDir: testDir });

      const output = getAllOutput();

      // Should show public registry results
      expect(output).toContain(REGISTRAR_URL);
      expect(output).toContain("-> public-profile");

      // Should NOT show empty registry URL
      expect(output).not.toContain("https://empty.registry.com");
    });

    it("should display no results message when all registries return empty", async () => {
      // Mock config with private registry
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        registryAuths: [
          {
            username: "user@example.com",
            password: "secret",
            registryUrl: "https://private.registry.com",
          },
        ],
      });

      vi.mocked(registrarApi.searchPackagesOnRegistry)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      await registrySearchMain({ query: "nonexistent", installDir: testDir });

      const output = getAllOutput();
      expect(output.toLowerCase()).toContain("no");
      expect(output.toLowerCase()).toMatch(/found|results|profiles/);
    });

    it("should display package description after colon", async () => {
      const mockPackages = [
        {
          id: "1",
          name: "my-profile",
          description: "This is a great profile for developers",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];

      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue(
        mockPackages,
      );

      await registrySearchMain({ query: "test", installDir: testDir });

      const output = getAllOutput();
      // Format should be "-> name: description"
      expect(output).toContain(
        "-> my-profile: This is a great profile for developers",
      );
    });

    it("should handle packages without descriptions", async () => {
      const mockPackages = [
        {
          id: "1",
          name: "no-desc-profile",
          description: "",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ];

      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue(
        mockPackages,
      );

      await registrySearchMain({ query: "test", installDir: testDir });

      const output = getAllOutput();
      // Should display just the name without colon when no description
      expect(output).toContain("-> no-desc-profile");
      expect(output).not.toContain("-> no-desc-profile:");
    });

    it("should handle API errors gracefully when public registry fails", async () => {
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockRejectedValue(
        new Error("Network error: Failed to fetch"),
      );

      await registrySearchMain({ query: "test", installDir: testDir });

      const output = getAllOutput();
      expect(output.toLowerCase()).toContain("error");
      expect(output).toContain("Network error");
    });

    it("should show all errors when all registries fail", async () => {
      // Mock config with private registry
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        registryAuths: [
          {
            username: "user@example.com",
            password: "secret",
            registryUrl: "https://private.registry.com",
          },
        ],
      });

      vi.mocked(registrarApi.searchPackagesOnRegistry)
        .mockRejectedValueOnce(new Error("Public registry down"))
        .mockRejectedValueOnce(new Error("Private registry down"));

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      await registrySearchMain({ query: "test", installDir: testDir });

      const output = getAllOutput();
      // Should show errors for both registries
      expect(output).toContain(REGISTRAR_URL);
      expect(output).toContain("https://private.registry.com");
      expect(output).toContain("Error");
    });

    it("should search only public registry when config has no registryAuths", async () => {
      // Default mock already has no registryAuths
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

      await registrySearchMain({ query: "test", installDir: testDir });

      // Should only search public registry
      expect(registrarApi.searchPackagesOnRegistry).toHaveBeenCalledTimes(1);
      expect(registrarApi.searchPackagesOnRegistry).toHaveBeenCalledWith(
        expect.objectContaining({
          registryUrl: REGISTRAR_URL,
        }),
      );
    });

    it("should search only public registry when loadConfig returns null", async () => {
      vi.mocked(loadConfig).mockResolvedValue(null);

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

      await registrySearchMain({ query: "test", installDir: testDir });

      // Should only search public registry
      expect(registrarApi.searchPackagesOnRegistry).toHaveBeenCalledTimes(1);
      expect(registrarApi.searchPackagesOnRegistry).toHaveBeenCalledWith(
        expect.objectContaining({
          registryUrl: REGISTRAR_URL,
        }),
      );

      const output = getAllOutput();
      expect(output).toContain("-> test-profile");
    });
  });

  describe("cursor-agent validation", () => {
    it("should fail when only cursor-agent is installed", async () => {
      // Mock config with only cursor-agent installed
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "cursor-agent": { profile: { baseProfile: "amol" } } },
      });

      await registrySearchMain({ query: "test", installDir: testDir });

      // Should not make any API calls
      expect(registrarApi.searchPackagesOnRegistry).not.toHaveBeenCalled();

      // Should display error message about cursor-agent not being supported
      const output = getAllOutput();
      expect(output.toLowerCase()).toContain("not supported");
      expect(output.toLowerCase()).toContain("cursor");
      expect(output).toContain("claude-code");
    });

    it("should succeed when only claude-code is installed", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
      });

      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue([
        {
          id: "1",
          name: "test-profile",
          description: "A test profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ]);

      await registrySearchMain({ query: "test", installDir: testDir });

      // Should make API call since claude-code is installed
      expect(registrarApi.searchPackagesOnRegistry).toHaveBeenCalled();
    });

    it("should succeed when both agents are installed", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
          "cursor-agent": { profile: { baseProfile: "amol" } },
        },
      });

      vi.mocked(registrarApi.searchPackagesOnRegistry).mockResolvedValue([
        {
          id: "1",
          name: "test-profile",
          description: "A test profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
        },
      ]);

      await registrySearchMain({ query: "test", installDir: testDir });

      // Should make API call since claude-code is also installed
      expect(registrarApi.searchPackagesOnRegistry).toHaveBeenCalled();
    });
  });
});
