/**
 * Tests for registry-search CLI command
 * Now searches org registry (from config.auth) instead of public registry
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

import { registrarApi } from "@/api/registrar.js";
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

      await registrySearchMain({ query: "nonexistent", installDir: testDir });

      const output = getAllOutput();
      expect(output.toLowerCase()).toContain("no");
    });

    it("should handle API errors gracefully", async () => {
      vi.mocked(registrarApi.searchPackagesOnRegistry).mockRejectedValue(
        new Error("Network error"),
      );

      await registrySearchMain({ query: "test", installDir: testDir });

      const output = getAllOutput();
      expect(output.toLowerCase()).toContain("error");
    });

    it("should not search anything when no auth is configured", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
      });

      await registrySearchMain({ query: "test", installDir: testDir });

      expect(registrarApi.searchPackagesOnRegistry).not.toHaveBeenCalled();
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
