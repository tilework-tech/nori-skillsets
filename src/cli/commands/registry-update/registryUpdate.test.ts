/**
 * Tests for registry-update CLI command
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import * as tar from "tar";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the registrar API
vi.mock("@/api/registrar.js", () => ({
  REGISTRAR_URL: "https://registrar.tilework.tech",
  registrarApi: {
    getPackument: vi.fn(),
    downloadTarball: vi.fn(),
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

import { REGISTRAR_URL, registrarApi } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { loadConfig, getRegistryAuth } from "@/cli/config.js";

import { registryUpdateMain } from "./registryUpdate.js";

describe("registry-update", () => {
  let testDir: string;
  let configPath: string;
  let profilesDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test directory structure simulating a Nori installation
    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-registry-update-test-"),
    );
    configPath = path.join(testDir, ".nori-config.json");
    profilesDir = path.join(testDir, ".claude", "profiles");

    // Create profiles directory
    await fs.mkdir(profilesDir, { recursive: true });

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

  const createTestProfile = async (args: {
    name: string;
    version: string;
    registryUrl: string;
  }): Promise<void> => {
    const { name, version, registryUrl } = args;
    const profileDir = path.join(profilesDir, name);
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(path.join(profileDir, "CLAUDE.md"), "# Test Profile");
    await fs.writeFile(
      path.join(profileDir, ".nori-version"),
      JSON.stringify({ version, registryUrl }, null, 2),
    );
  };

  const createMockTarball = async (): Promise<ArrayBuffer> => {
    const tempDir = await fs.mkdtemp(
      path.join(tmpdir(), "mock-tarball-source-"),
    );
    const tarballPath = path.join(tmpdir(), `mock-tarball-${Date.now()}.tar`);

    try {
      // Create mock files
      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "test-profile", version: "2.0.0" }),
      );
      await fs.writeFile(path.join(tempDir, "CLAUDE.md"), "# Updated Profile");

      tar.create(
        {
          gzip: false,
          file: tarballPath,
          cwd: tempDir,
          sync: true,
        },
        ["package.json", "CLAUDE.md"],
      );

      const buffer = await fs.readFile(tarballPath);
      const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      );
      return arrayBuffer;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
      await fs.unlink(tarballPath).catch(() => {
        /* ignore */
      });
    }
  };

  describe("registryUpdateMain", () => {
    it("should update profile to newer version", async () => {
      await createTestProfile({
        name: "test-profile",
        version: "1.0.0",
        registryUrl: REGISTRAR_URL,
      });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      // Mock packument with newer version
      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
          "2.0.0": { name: "test-profile", version: "2.0.0" },
        },
      });

      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      await registryUpdateMain({
        profileName: "test-profile",
        cwd: testDir,
      });

      // Verify download was called with correct version
      expect(registrarApi.downloadTarball).toHaveBeenCalledWith({
        packageName: "test-profile",
        version: "2.0.0",
        registryUrl: REGISTRAR_URL,
        authToken: undefined,
      });

      // Verify success message
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput.toLowerCase()).toContain("updated");
      expect(allOutput).toContain("1.0.0");
      expect(allOutput).toContain("2.0.0");
    });

    it("should report when already at latest version", async () => {
      await createTestProfile({
        name: "test-profile",
        version: "2.0.0",
        registryUrl: REGISTRAR_URL,
      });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      // Mock packument with same version
      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "2.0.0": { name: "test-profile", version: "2.0.0" },
        },
      });

      await registryUpdateMain({
        profileName: "test-profile",
        cwd: testDir,
      });

      // Verify no download occurred
      expect(registrarApi.downloadTarball).not.toHaveBeenCalled();

      // Verify message about already at latest
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput.toLowerCase()).toContain("latest");
    });

    it("should error when profile is not installed", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      await registryUpdateMain({
        profileName: "nonexistent-profile",
        cwd: testDir,
      });

      // Verify error message
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("not installed");
    });

    it("should error when profile has no .nori-version file", async () => {
      // Create profile without .nori-version
      const profileDir = path.join(profilesDir, "manual-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(
        path.join(profileDir, "CLAUDE.md"),
        "# Manual Profile",
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      await registryUpdateMain({
        profileName: "manual-profile",
        cwd: testDir,
      });

      // Verify error message about no version info
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("version");
      expect(allErrorOutput).toContain(".nori-version");
    });

    it("should error when no Nori installation found", async () => {
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-no-install-"),
      );

      try {
        await registryUpdateMain({
          profileName: "test-profile",
          cwd: noInstallDir,
        });

        // Verify error message
        const allErrorOutput = mockConsoleError.mock.calls
          .map((call) => call.join(" "))
          .join("\n");
        expect(allErrorOutput.toLowerCase()).toContain("no");
        expect(allErrorOutput.toLowerCase()).toContain("installation");
      } finally {
        await fs.rm(noInstallDir, { recursive: true, force: true });
      }
    });

    it("should use stored registry URL from .nori-version", async () => {
      const privateRegistryUrl = "https://private.registry.com";

      await createTestProfile({
        name: "test-profile",
        version: "1.0.0",
        registryUrl: privateRegistryUrl,
      });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            registryUrl: privateRegistryUrl,
            username: "user",
            password: "pass",
          },
        ],
      });

      vi.mocked(getRegistryAuth).mockReturnValue({
        registryUrl: privateRegistryUrl,
        username: "user",
        password: "pass",
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
          "2.0.0": { name: "test-profile", version: "2.0.0" },
        },
      });

      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      await registryUpdateMain({
        profileName: "test-profile",
        cwd: testDir,
      });

      // Verify API calls used stored registry URL
      expect(registrarApi.getPackument).toHaveBeenCalledWith({
        packageName: "test-profile",
        registryUrl: privateRegistryUrl,
        authToken: "mock-auth-token",
      });

      expect(registrarApi.downloadTarball).toHaveBeenCalledWith({
        packageName: "test-profile",
        version: "2.0.0",
        registryUrl: privateRegistryUrl,
        authToken: "mock-auth-token",
      });
    });

    it("should allow overriding registry URL with --registry", async () => {
      const storedRegistryUrl = "https://old.registry.com";
      const overrideRegistryUrl = "https://new.registry.com";

      await createTestProfile({
        name: "test-profile",
        version: "1.0.0",
        registryUrl: storedRegistryUrl,
      });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            registryUrl: overrideRegistryUrl,
            username: "user",
            password: "pass",
          },
        ],
      });

      vi.mocked(getRegistryAuth).mockReturnValue({
        registryUrl: overrideRegistryUrl,
        username: "user",
        password: "pass",
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
          "2.0.0": { name: "test-profile", version: "2.0.0" },
        },
      });

      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      await registryUpdateMain({
        profileName: "test-profile",
        cwd: testDir,
        registryUrl: overrideRegistryUrl,
      });

      // Verify API calls used override registry URL
      expect(registrarApi.getPackument).toHaveBeenCalledWith({
        packageName: "test-profile",
        registryUrl: overrideRegistryUrl,
        authToken: "mock-auth-token",
      });
    });

    it("should handle update errors gracefully", async () => {
      await createTestProfile({
        name: "test-profile",
        version: "1.0.0",
        registryUrl: REGISTRAR_URL,
      });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      vi.mocked(registrarApi.getPackument).mockRejectedValue(
        new Error("Network error"),
      );

      await registryUpdateMain({
        profileName: "test-profile",
        cwd: testDir,
      });

      // Verify error message
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("fail");
      expect(allErrorOutput).toContain("Network error");
    });
  });

  describe("cursor-agent validation", () => {
    it("should fail when only cursor-agent is installed", async () => {
      await createTestProfile({
        name: "test-profile",
        version: "1.0.0",
        registryUrl: REGISTRAR_URL,
      });

      // Mock config with only cursor-agent installed
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "cursor-agent": { profile: { baseProfile: "amol" } } },
      });

      await registryUpdateMain({
        profileName: "test-profile",
        cwd: testDir,
      });

      // Should not make any API calls
      expect(registrarApi.getPackument).not.toHaveBeenCalled();
      expect(registrarApi.downloadTarball).not.toHaveBeenCalled();

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
      await createTestProfile({
        name: "test-profile",
        version: "1.0.0",
        registryUrl: REGISTRAR_URL,
      });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
          "2.0.0": { name: "test-profile", version: "2.0.0" },
        },
      });

      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      await registryUpdateMain({
        profileName: "test-profile",
        cwd: testDir,
      });

      // Should make API calls since claude-code is installed
      expect(registrarApi.getPackument).toHaveBeenCalled();
    });

    it("should succeed when both agents are installed", async () => {
      await createTestProfile({
        name: "test-profile",
        version: "1.0.0",
        registryUrl: REGISTRAR_URL,
      });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
          "cursor-agent": { profile: { baseProfile: "amol" } },
        },
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
          "2.0.0": { name: "test-profile", version: "2.0.0" },
        },
      });

      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      await registryUpdateMain({
        profileName: "test-profile",
        cwd: testDir,
      });

      // Should make API calls since claude-code is also installed
      expect(registrarApi.getPackument).toHaveBeenCalled();
    });
  });
});
