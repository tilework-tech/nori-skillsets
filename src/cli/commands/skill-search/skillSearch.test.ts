/**
 * Tests for skill-search CLI command
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the registrar API
vi.mock("@/api/registrar.js", () => ({
  REGISTRAR_URL: "https://registrar.tilework.tech",
  registrarApi: {
    searchSkills: vi.fn(),
  },
}));

// Mock the config module - include getInstalledAgents with real implementation
vi.mock("@/cli/config.js", async () => {
  return {
    loadConfig: vi.fn(),
    getRegistryAuth: vi.fn(),
    getInstalledAgents: (args: {
      config: { agents?: Record<string, unknown> | null };
    }) => {
      const agents = Object.keys(args.config.agents ?? {});
      return agents.length > 0 ? agents : ["claude-code"];
    },
  };
});

// Mock the registry auth module
vi.mock("@/api/registryAuth.js", () => ({
  getRegistryAuthToken: vi.fn(),
}));

// Mock console methods to capture output
const mockConsoleLog = vi
  .spyOn(console, "log")
  .mockImplementation(() => undefined);
const mockConsoleError = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

import { registrarApi } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { loadConfig } from "@/cli/config.js";

import { skillSearchMain } from "./skillSearch.js";

describe("skill-search", () => {
  let testDir: string;
  let configPath: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test directory structure simulating a Nori installation
    testDir = await fs.mkdtemp(path.join(tmpdir(), "nori-skill-search-test-"));
    configPath = path.join(testDir, ".nori-config.json");

    // Create initial config file so getInstallDirs can find it
    await fs.writeFile(
      configPath,
      JSON.stringify({
        profile: { baseProfile: "senior-swe" },
      }),
    );
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  describe("skillSearchMain", () => {
    it("should search skills in org registry and display results", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://testorg.tilework.tech",
          refreshToken: "mock-refresh-token",
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.searchSkills).mockResolvedValue([
        {
          id: "1",
          name: "test-skill",
          description: "A test skill",
          authorEmail: "author@example.com",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "2",
          name: "another-skill",
          description: "Another skill",
          authorEmail: "author@example.com",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ]);

      await skillSearchMain({
        query: "test",
        installDir: testDir,
      });

      // Verify API was called with correct parameters
      expect(registrarApi.searchSkills).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "test",
          authToken: "mock-auth-token",
        }),
      );

      // Verify results were displayed
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput).toContain("test-skill");
      expect(allOutput).toContain("another-skill");
    });

    it("should display message when no results found", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://testorg.tilework.tech",
          refreshToken: "mock-refresh-token",
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.searchSkills).mockResolvedValue([]);

      await skillSearchMain({
        query: "nonexistent",
        installDir: testDir,
      });

      // Verify message about no results
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput.toLowerCase()).toContain("no");
      expect(allOutput).toContain("nonexistent");
    });

    it("should error when no organization configured", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        // No auth configured
      });

      await skillSearchMain({
        query: "test",
        installDir: testDir,
      });

      // Verify error message about no organization
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("organization");
    });

    it("should error when no Nori installation found", async () => {
      // Create directory without .nori-config.json
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-no-install-"),
      );

      try {
        await skillSearchMain({
          query: "test",
          cwd: noInstallDir,
        });

        // Verify error message about no installation
        const allErrorOutput = mockConsoleError.mock.calls
          .map((call) => call.join(" "))
          .join("\n");
        expect(allErrorOutput.toLowerCase()).toContain("no");
        expect(allErrorOutput.toLowerCase()).toContain("installation");
      } finally {
        await fs.rm(noInstallDir, { recursive: true, force: true });
      }
    });

    it("should handle search errors gracefully", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://testorg.tilework.tech",
          refreshToken: "mock-refresh-token",
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.searchSkills).mockRejectedValue(
        new Error("Network error"),
      );

      await skillSearchMain({
        query: "test",
        installDir: testDir,
      });

      // Verify error message
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("error");
      expect(allErrorOutput).toContain("Network error");
    });

    it("should show skill descriptions in results", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://testorg.tilework.tech",
          refreshToken: "mock-refresh-token",
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.searchSkills).mockResolvedValue([
        {
          id: "1",
          name: "my-skill",
          description: "This is a detailed description of my skill",
          authorEmail: "author@example.com",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ]);

      await skillSearchMain({
        query: "my",
        installDir: testDir,
      });

      // Verify description was displayed
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput).toContain("my-skill");
      expect(allOutput).toContain("This is a detailed description");
    });

    it("should handle skills without descriptions", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://testorg.tilework.tech",
          refreshToken: "mock-refresh-token",
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.searchSkills).mockResolvedValue([
        {
          id: "1",
          name: "no-desc-skill",
          description: "",
          authorEmail: "author@example.com",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ]);

      await skillSearchMain({
        query: "no-desc",
        installDir: testDir,
      });

      // Verify skill name was displayed without error
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput).toContain("no-desc-skill");
    });

    it("should show install hint after results", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        auth: {
          username: "test@example.com",
          organizationUrl: "https://testorg.tilework.tech",
          refreshToken: "mock-refresh-token",
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.searchSkills).mockResolvedValue([
        {
          id: "1",
          name: "test-skill",
          description: "A test skill",
          authorEmail: "author@example.com",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ]);

      await skillSearchMain({
        query: "test",
        installDir: testDir,
      });

      // Verify install hint was displayed
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput.toLowerCase()).toContain("skill-download");
    });
  });

  describe("cursor-agent validation", () => {
    it("should fail when only cursor-agent is installed", async () => {
      // Mock config with only cursor-agent installed
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "cursor-agent": { profile: { baseProfile: "amol" } } },
        auth: {
          username: "test@example.com",
          organizationUrl: "https://testorg.tilework.tech",
          refreshToken: "mock-refresh-token",
        },
      });

      await skillSearchMain({
        query: "test",
        installDir: testDir,
      });

      // Should not make any API calls
      expect(registrarApi.searchSkills).not.toHaveBeenCalled();

      // Should display error message about cursor-agent not being supported
      const allOutput = [
        ...mockConsoleLog.mock.calls,
        ...mockConsoleError.mock.calls,
      ]
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput.toLowerCase()).toContain("not supported");
      expect(allOutput.toLowerCase()).toContain("cursor");
      expect(allOutput).toContain("claude-code");
    });

    it("should succeed when only claude-code is installed", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        auth: {
          username: "test@example.com",
          organizationUrl: "https://testorg.tilework.tech",
          refreshToken: "mock-refresh-token",
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.searchSkills).mockResolvedValue([]);

      await skillSearchMain({
        query: "test",
        installDir: testDir,
      });

      // Should make API call since claude-code is installed
      expect(registrarApi.searchSkills).toHaveBeenCalled();
    });
  });
});
