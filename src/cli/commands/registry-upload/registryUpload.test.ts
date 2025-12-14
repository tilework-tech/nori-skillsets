/**
 * Tests for registry-upload CLI command
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the registrar API
vi.mock("@/api/registrar.js", () => ({
  REGISTRAR_URL: "https://registrar.tilework.tech",
  registrarApi: {
    uploadProfile: vi.fn(),
    getPackument: vi.fn(),
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
import { loadConfig, getRegistryAuth } from "@/cli/config.js";

import { registryUploadMain } from "./registryUpload.js";

describe("registry-upload", () => {
  let testDir: string;
  let configPath: string;
  let profilesDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test directory structure simulating a Nori installation
    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-registry-upload-test-"),
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

  const createTestProfile = async (args: { name: string }): Promise<void> => {
    const { name } = args;
    const profileDir = path.join(profilesDir, name);
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(path.join(profileDir, "CLAUDE.md"), "# Test Profile");
  };

  describe("registryUploadMain", () => {
    it("should upload profile to single configured registry", async () => {
      await createTestProfile({ name: "test-profile" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            username: "test@example.com",
            password: "test-password",
            registryUrl: "https://registrar.tilework.tech",
          },
        ],
      });

      vi.mocked(getRegistryAuth).mockReturnValue({
        username: "test@example.com",
        password: "test-password",
        registryUrl: "https://registrar.tilework.tech",
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.uploadProfile).mockResolvedValue({
        name: "test-profile",
        version: "1.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await registryUploadMain({
        profileSpec: "test-profile",
        cwd: testDir,
      });

      // Verify API was called with correct registry
      expect(registrarApi.uploadProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: "test-profile",
          version: "1.0.0",
          authToken: "mock-auth-token",
          registryUrl: "https://registrar.tilework.tech",
        }),
      );

      // Verify success message
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput.toLowerCase()).toContain("upload");
    });

    it("should upload profile with specified version", async () => {
      await createTestProfile({ name: "test-profile" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            username: "test@example.com",
            password: "test-password",
            registryUrl: "https://registrar.tilework.tech",
          },
        ],
      });

      vi.mocked(getRegistryAuth).mockReturnValue({
        username: "test@example.com",
        password: "test-password",
        registryUrl: "https://registrar.tilework.tech",
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.uploadProfile).mockResolvedValue({
        name: "test-profile",
        version: "2.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await registryUploadMain({
        profileSpec: "test-profile@2.0.0",
        cwd: testDir,
      });

      // Verify API was called with correct version
      expect(registrarApi.uploadProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: "test-profile",
          version: "2.0.0",
        }),
      );
    });

    it("should error when profile does not exist", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            username: "test@example.com",
            password: "test-password",
            registryUrl: "https://registrar.tilework.tech",
          },
        ],
      });

      await registryUploadMain({
        profileSpec: "nonexistent-profile",
        cwd: testDir,
      });

      // Verify error message about not found
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("not found");
    });

    it("should error when no Nori installation found", async () => {
      // Create directory without .nori-config.json
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-no-install-"),
      );

      try {
        await registryUploadMain({
          profileSpec: "test-profile",
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

    it("should error when no registry auth configured", async () => {
      await createTestProfile({ name: "test-profile" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      await registryUploadMain({
        profileSpec: "test-profile",
        cwd: testDir,
      });

      // Verify error message about no auth
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("auth");
    });

    it("should handle upload errors gracefully", async () => {
      await createTestProfile({ name: "test-profile" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            username: "test@example.com",
            password: "test-password",
            registryUrl: "https://registrar.tilework.tech",
          },
        ],
      });

      vi.mocked(getRegistryAuth).mockReturnValue({
        username: "test@example.com",
        password: "test-password",
        registryUrl: "https://registrar.tilework.tech",
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.uploadProfile).mockRejectedValue(
        new Error("Version already exists"),
      );

      await registryUploadMain({
        profileSpec: "test-profile",
        cwd: testDir,
      });

      // Verify error message
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("fail");
      expect(allErrorOutput).toContain("Version already exists");
    });
  });

  describe("multi-registry support", () => {
    it("should error when multiple registries configured and no --registry provided", async () => {
      await createTestProfile({ name: "test-profile" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            username: "test@example.com",
            password: "test-password",
            registryUrl: "https://registrar.tilework.tech",
          },
          {
            username: "private@example.com",
            password: "private-password",
            registryUrl: "https://private-registry.example.com",
          },
        ],
      });

      await registryUploadMain({
        profileSpec: "test-profile",
        cwd: testDir,
      });

      // Verify error message about multiple registries
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("multiple");
      expect(allErrorOutput).toContain("https://registrar.tilework.tech");
      expect(allErrorOutput).toContain("https://private-registry.example.com");
      expect(allErrorOutput).toContain("--registry");

      // Verify no upload occurred
      expect(registrarApi.uploadProfile).not.toHaveBeenCalled();
    });

    it("should upload to specified registry when --registry provided", async () => {
      await createTestProfile({ name: "test-profile" });

      const privateRegistryUrl = "https://private-registry.example.com";

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            username: "test@example.com",
            password: "test-password",
            registryUrl: "https://registrar.tilework.tech",
          },
          {
            username: "private@example.com",
            password: "private-password",
            registryUrl: privateRegistryUrl,
          },
        ],
      });

      vi.mocked(getRegistryAuth).mockReturnValue({
        username: "private@example.com",
        password: "private-password",
        registryUrl: privateRegistryUrl,
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-private-token");

      vi.mocked(registrarApi.uploadProfile).mockResolvedValue({
        name: "test-profile",
        version: "1.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await registryUploadMain({
        profileSpec: "test-profile",
        cwd: testDir,
        registryUrl: privateRegistryUrl,
      });

      // Verify API was called with specified registry
      expect(registrarApi.uploadProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: "test-profile",
          registryUrl: privateRegistryUrl,
          authToken: "mock-private-token",
        }),
      );
    });

    it("should error when --registry specifies unknown registry", async () => {
      await createTestProfile({ name: "test-profile" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            username: "test@example.com",
            password: "test-password",
            registryUrl: "https://registrar.tilework.tech",
          },
        ],
      });

      vi.mocked(getRegistryAuth).mockReturnValue(null);

      await registryUploadMain({
        profileSpec: "test-profile",
        cwd: testDir,
        registryUrl: "https://unknown-registry.example.com",
      });

      // Verify error message about no auth
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("auth");
      expect(allErrorOutput).toContain("https://unknown-registry.example.com");

      // Verify no upload occurred
      expect(registrarApi.uploadProfile).not.toHaveBeenCalled();
    });

    it("should upload with version and --registry", async () => {
      await createTestProfile({ name: "test-profile" });

      const privateRegistryUrl = "https://private-registry.example.com";

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            username: "test@example.com",
            password: "test-password",
            registryUrl: "https://registrar.tilework.tech",
          },
          {
            username: "private@example.com",
            password: "private-password",
            registryUrl: privateRegistryUrl,
          },
        ],
      });

      vi.mocked(getRegistryAuth).mockReturnValue({
        username: "private@example.com",
        password: "private-password",
        registryUrl: privateRegistryUrl,
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-private-token");

      vi.mocked(registrarApi.uploadProfile).mockResolvedValue({
        name: "test-profile",
        version: "2.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await registryUploadMain({
        profileSpec: "test-profile@2.0.0",
        cwd: testDir,
        registryUrl: privateRegistryUrl,
      });

      // Verify API was called with correct version and registry
      expect(registrarApi.uploadProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: "test-profile",
          version: "2.0.0",
          registryUrl: privateRegistryUrl,
        }),
      );
    });
  });

  describe("auto-bump version", () => {
    it("should auto-bump patch version when no version specified and package exists", async () => {
      await createTestProfile({ name: "test-profile" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            username: "test@example.com",
            password: "test-password",
            registryUrl: "https://registrar.tilework.tech",
          },
        ],
      });

      vi.mocked(getRegistryAuth).mockReturnValue({
        username: "test@example.com",
        password: "test-password",
        registryUrl: "https://registrar.tilework.tech",
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      // Mock existing package with version 1.2.3
      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.2.3" },
        versions: { "1.2.3": { name: "test-profile", version: "1.2.3" } },
      });

      vi.mocked(registrarApi.uploadProfile).mockResolvedValue({
        name: "test-profile",
        version: "1.2.4",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await registryUploadMain({
        profileSpec: "test-profile",
        cwd: testDir,
      });

      // Verify API was called with auto-bumped version (1.2.3 -> 1.2.4)
      expect(registrarApi.uploadProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: "test-profile",
          version: "1.2.4",
        }),
      );
    });

    it("should default to 1.0.0 when no version specified and package does not exist", async () => {
      await createTestProfile({ name: "test-profile" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            username: "test@example.com",
            password: "test-password",
            registryUrl: "https://registrar.tilework.tech",
          },
        ],
      });

      vi.mocked(getRegistryAuth).mockReturnValue({
        username: "test@example.com",
        password: "test-password",
        registryUrl: "https://registrar.tilework.tech",
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      // Mock package not found
      vi.mocked(registrarApi.getPackument).mockRejectedValue(
        new Error("Package not found"),
      );

      vi.mocked(registrarApi.uploadProfile).mockResolvedValue({
        name: "test-profile",
        version: "1.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await registryUploadMain({
        profileSpec: "test-profile",
        cwd: testDir,
      });

      // Verify API was called with default version 1.0.0
      expect(registrarApi.uploadProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: "test-profile",
          version: "1.0.0",
        }),
      );
    });

    it("should use explicit version when specified, not auto-bump", async () => {
      await createTestProfile({ name: "test-profile" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            username: "test@example.com",
            password: "test-password",
            registryUrl: "https://registrar.tilework.tech",
          },
        ],
      });

      vi.mocked(getRegistryAuth).mockReturnValue({
        username: "test@example.com",
        password: "test-password",
        registryUrl: "https://registrar.tilework.tech",
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      // Mock existing package with version 1.2.3
      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.2.3" },
        versions: { "1.2.3": { name: "test-profile", version: "1.2.3" } },
      });

      vi.mocked(registrarApi.uploadProfile).mockResolvedValue({
        name: "test-profile",
        version: "5.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await registryUploadMain({
        profileSpec: "test-profile@5.0.0",
        cwd: testDir,
      });

      // getPackument should NOT be called when explicit version provided
      expect(registrarApi.getPackument).not.toHaveBeenCalled();

      // Verify API was called with explicit version
      expect(registrarApi.uploadProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: "test-profile",
          version: "5.0.0",
        }),
      );
    });
  });

  describe("cursor-agent validation", () => {
    it("should fail when only cursor-agent is installed", async () => {
      await createTestProfile({ name: "test-profile" });

      // Mock config with only cursor-agent installed
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "cursor-agent": { profile: { baseProfile: "amol" } } },
        registryAuths: [
          {
            username: "test@example.com",
            password: "test-password",
            registryUrl: "https://registrar.tilework.tech",
          },
        ],
      });

      await registryUploadMain({
        profileSpec: "test-profile",
        cwd: testDir,
      });

      // Should not make any API calls
      expect(registrarApi.uploadProfile).not.toHaveBeenCalled();

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
      await createTestProfile({ name: "test-profile" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        registryAuths: [
          {
            username: "test@example.com",
            password: "test-password",
            registryUrl: "https://registrar.tilework.tech",
          },
        ],
      });

      vi.mocked(getRegistryAuth).mockReturnValue({
        username: "test@example.com",
        password: "test-password",
        registryUrl: "https://registrar.tilework.tech",
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.getPackument).mockRejectedValue(
        new Error("Package not found"),
      );

      vi.mocked(registrarApi.uploadProfile).mockResolvedValue({
        name: "test-profile",
        version: "1.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await registryUploadMain({
        profileSpec: "test-profile",
        cwd: testDir,
      });

      // Should make API call since claude-code is installed
      expect(registrarApi.uploadProfile).toHaveBeenCalled();
    });

    it("should succeed when both agents are installed", async () => {
      await createTestProfile({ name: "test-profile" });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
          "cursor-agent": { profile: { baseProfile: "amol" } },
        },
        registryAuths: [
          {
            username: "test@example.com",
            password: "test-password",
            registryUrl: "https://registrar.tilework.tech",
          },
        ],
      });

      vi.mocked(getRegistryAuth).mockReturnValue({
        username: "test@example.com",
        password: "test-password",
        registryUrl: "https://registrar.tilework.tech",
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.getPackument).mockRejectedValue(
        new Error("Package not found"),
      );

      vi.mocked(registrarApi.uploadProfile).mockResolvedValue({
        name: "test-profile",
        version: "1.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      await registryUploadMain({
        profileSpec: "test-profile",
        cwd: testDir,
      });

      // Should make API call since claude-code is also installed
      expect(registrarApi.uploadProfile).toHaveBeenCalled();
    });
  });
});
