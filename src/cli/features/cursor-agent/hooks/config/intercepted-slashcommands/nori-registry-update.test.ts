/**
 * Tests for nori-registry-update intercepted slash command
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

// Mock the config module
vi.mock("@/cli/config.js", () => ({
  loadConfig: vi.fn(),
  getRegistryAuth: vi.fn(),
}));

// Mock the registryAuth module
vi.mock("@/api/registryAuth.js", () => ({
  getRegistryAuthToken: vi.fn(),
}));

import { registrarApi, REGISTRAR_URL } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { loadConfig, getRegistryAuth } from "@/cli/config.js";

import type { HookInput } from "./types.js";

import { noriRegistryUpdate } from "./nori-registry-update.js";

// ANSI color codes for verification
const GREEN = "\x1b[0;32m";
const RED = "\x1b[0;31m";
const NC = "\x1b[0m"; // No Color / Reset

/**
 * Strip ANSI escape codes from a string for plain text comparison
 *
 * @param str - The string containing ANSI codes
 *
 * @returns The string with ANSI codes removed
 */
const stripAnsi = (str: string): string => {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
};

describe("nori-registry-update", () => {
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

    // Create initial config
    await fs.writeFile(
      configPath,
      JSON.stringify({
        profile: {
          baseProfile: "senior-swe",
        },
      }),
    );

    // Create profiles directory
    await fs.mkdir(profilesDir, { recursive: true });
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
      expect(noriRegistryUpdate.matchers).toBeInstanceOf(Array);
      expect(noriRegistryUpdate.matchers.length).toBeGreaterThan(0);

      for (const matcher of noriRegistryUpdate.matchers) {
        expect(() => new RegExp(matcher)).not.toThrow();
      }
    });

    it("should match /nori-registry-update profile-name", () => {
      const hasMatch = noriRegistryUpdate.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-registry-update my-profile");
      });
      expect(hasMatch).toBe(true);
    });

    it("should match /nori-registry-update without profile name (shows help)", () => {
      const matchesWithoutProfile = noriRegistryUpdate.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-registry-update");
      });
      expect(matchesWithoutProfile).toBe(true);
    });

    it("should match command with registry URL", () => {
      const hasMatch = noriRegistryUpdate.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test(
          "/nori-registry-update my-profile https://private-registry.com",
        );
      });
      expect(hasMatch).toBe(true);
    });
  });

  describe("run function", () => {
    it("should show help message when no profile name provided", async () => {
      const input = createInput({
        prompt: "/nori-registry-update",
      });
      const result = await noriRegistryUpdate.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Usage:");
      expect(plainReason).toContain("/nori-registry-update <profile-name>");
    });

    it("should return error when no installation found", async () => {
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-registry-update-no-install-"),
      );

      try {
        const input = createInput({
          prompt: "/nori-registry-update test-profile",
          cwd: noInstallDir,
        });
        const result = await noriRegistryUpdate.run({ input });

        expect(result).not.toBeNull();
        expect(result!.decision).toBe("block");
        expect(stripAnsi(result!.reason!)).toContain(
          "No Nori installation found",
        );
      } finally {
        await fs.rm(noInstallDir, { recursive: true, force: true });
      }
    });

    it("should return error when profile is not installed", async () => {
      const input = createInput({
        prompt: "/nori-registry-update nonexistent-profile",
      });
      const result = await noriRegistryUpdate.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(stripAnsi(result!.reason!)).toContain("not installed");
    });

    it("should return error when no .nori-version file exists (unversioned profile)", async () => {
      // Create profile directory without version file
      const profileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(path.join(profileDir, "CLAUDE.md"), "# Test Profile");

      const input = createInput({
        prompt: "/nori-registry-update test-profile",
      });
      const result = await noriRegistryUpdate.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("no version information");
    });

    it("should indicate when profile is already at latest version", async () => {
      // Create profile directory with version file
      const profileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(
        path.join(profileDir, ".nori-version"),
        JSON.stringify({
          version: "1.0.0",
          registryUrl: REGISTRAR_URL,
        }),
      );

      // Mock packument with same version
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        profile: { baseProfile: "senior-swe" },
        registryAuths: null,
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
        },
      });

      const input = createInput({
        prompt: "/nori-registry-update test-profile",
      });
      const result = await noriRegistryUpdate.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("already at latest");
      expect(plainReason).toContain("1.0.0");

      // Should not download anything
      expect(registrarApi.downloadTarball).not.toHaveBeenCalled();
    });

    it("should update profile when newer version is available", async () => {
      // Create profile directory with older version
      const profileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(
        path.join(profileDir, ".nori-version"),
        JSON.stringify({
          version: "1.0.0",
          registryUrl: REGISTRAR_URL,
        }),
      );
      await fs.writeFile(path.join(profileDir, "CLAUDE.md"), "# Old Content");

      // Mock packument with newer version
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        profile: { baseProfile: "senior-swe" },
        registryAuths: null,
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
          "2.0.0": { name: "test-profile", version: "2.0.0" },
        },
      });

      const mockTarball = await createMockTarball({ version: "2.0.0" });
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      const input = createInput({
        prompt: "/nori-registry-update test-profile",
      });
      const result = await noriRegistryUpdate.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Updated");
      expect(plainReason).toContain("1.0.0");
      expect(plainReason).toContain("2.0.0");

      // Should have downloaded the new version
      expect(registrarApi.downloadTarball).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: "test-profile",
          version: "2.0.0",
        }),
      );

      // Verify .nori-version was updated
      const versionFileContent = await fs.readFile(
        path.join(profileDir, ".nori-version"),
        "utf-8",
      );
      const versionInfo = JSON.parse(versionFileContent);
      expect(versionInfo.version).toBe("2.0.0");
    });

    it("should use registry URL from .nori-version file", async () => {
      // Create profile directory with version from private registry
      const profileDir = path.join(profilesDir, "private-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(
        path.join(profileDir, ".nori-version"),
        JSON.stringify({
          version: "1.0.0",
          registryUrl: "https://private-registry.com",
        }),
      );

      // Mock config with private registry auth
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        profile: { baseProfile: "senior-swe" },
        registryAuths: [
          {
            username: "test@example.com",
            password: "password",
            registryUrl: "https://private-registry.com",
          },
        ],
      });

      vi.mocked(getRegistryAuth).mockReturnValue({
        username: "test@example.com",
        password: "password",
        registryUrl: "https://private-registry.com",
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("test-auth-token");

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "private-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "private-profile", version: "1.0.0" },
        },
      });

      const input = createInput({
        prompt: "/nori-registry-update private-profile",
      });
      await noriRegistryUpdate.run({ input });

      // Should query the registry from .nori-version, not all registries
      expect(registrarApi.getPackument).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: "private-profile",
          registryUrl: "https://private-registry.com",
        }),
      );
    });

    it("should handle registry URL override via argument", async () => {
      // Create profile with version from public registry
      const profileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(
        path.join(profileDir, ".nori-version"),
        JSON.stringify({
          version: "1.0.0",
          registryUrl: REGISTRAR_URL,
        }),
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        profile: { baseProfile: "senior-swe" },
        registryAuths: [
          {
            username: "test@example.com",
            password: "password",
            registryUrl: "https://new-registry.com",
          },
        ],
      });

      vi.mocked(getRegistryAuth).mockReturnValue({
        username: "test@example.com",
        password: "password",
        registryUrl: "https://new-registry.com",
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("test-auth-token");

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "2.0.0": { name: "test-profile", version: "2.0.0" },
        },
      });

      const mockTarball = await createMockTarball({ version: "2.0.0" });
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      const input = createInput({
        prompt: "/nori-registry-update test-profile https://new-registry.com",
      });
      const result = await noriRegistryUpdate.run({ input });

      // Should use the override registry URL
      expect(registrarApi.getPackument).toHaveBeenCalledWith(
        expect.objectContaining({
          registryUrl: "https://new-registry.com",
        }),
      );

      // Should update the version file with new registry URL
      expect(result).not.toBeNull();
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Updated");
    });

    it("should handle network errors gracefully", async () => {
      // Create profile directory with version file
      const profileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(
        path.join(profileDir, ".nori-version"),
        JSON.stringify({
          version: "1.0.0",
          registryUrl: REGISTRAR_URL,
        }),
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        profile: { baseProfile: "senior-swe" },
        registryAuths: null,
      });

      vi.mocked(registrarApi.getPackument).mockRejectedValue(
        new Error("Network error: Failed to fetch"),
      );

      const input = createInput({
        prompt: "/nori-registry-update test-profile",
      });
      const result = await noriRegistryUpdate.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(stripAnsi(result!.reason!)).toContain("Failed");
    });

    it("should handle download errors gracefully", async () => {
      // Create profile directory with version file
      const profileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(
        path.join(profileDir, ".nori-version"),
        JSON.stringify({
          version: "1.0.0",
          registryUrl: REGISTRAR_URL,
        }),
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        profile: { baseProfile: "senior-swe" },
        registryAuths: null,
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "2.0.0": { name: "test-profile", version: "2.0.0" },
        },
      });

      vi.mocked(registrarApi.downloadTarball).mockRejectedValue(
        new Error("Download failed"),
      );

      const input = createInput({
        prompt: "/nori-registry-update test-profile",
      });
      const result = await noriRegistryUpdate.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(stripAnsi(result!.reason!)).toContain("Failed");
    });
  });

  describe("ANSI color formatting", () => {
    it("should format successful update with green color codes", async () => {
      const profileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(
        path.join(profileDir, ".nori-version"),
        JSON.stringify({
          version: "1.0.0",
          registryUrl: REGISTRAR_URL,
        }),
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        profile: { baseProfile: "senior-swe" },
        registryAuths: null,
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "2.0.0": { name: "test-profile", version: "2.0.0" },
        },
      });

      const mockTarball = await createMockTarball({ version: "2.0.0" });
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      const input = createInput({
        prompt: "/nori-registry-update test-profile",
      });
      const result = await noriRegistryUpdate.run({ input });

      expect(result).not.toBeNull();
      expect(result!.reason).toContain(GREEN);
      expect(result!.reason).toContain(NC);
    });

    it("should format no installation error with red color codes", async () => {
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-update-no-install-"),
      );

      try {
        const input = createInput({
          prompt: "/nori-registry-update test-profile",
          cwd: noInstallDir,
        });
        const result = await noriRegistryUpdate.run({ input });

        expect(result).not.toBeNull();
        expect(result!.reason).toContain(RED);
        expect(result!.reason).toContain(NC);
      } finally {
        await fs.rm(noInstallDir, { recursive: true, force: true });
      }
    });

    it("should format already at latest with green color codes", async () => {
      const profileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(
        path.join(profileDir, ".nori-version"),
        JSON.stringify({
          version: "1.0.0",
          registryUrl: REGISTRAR_URL,
        }),
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        profile: { baseProfile: "senior-swe" },
        registryAuths: null,
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
        },
      });

      const input = createInput({
        prompt: "/nori-registry-update test-profile",
      });
      const result = await noriRegistryUpdate.run({ input });

      expect(result).not.toBeNull();
      expect(result!.reason).toContain(GREEN);
      expect(result!.reason).toContain(NC);
    });
  });

  describe("version comparison", () => {
    it("should update when patch version is higher", async () => {
      const profileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(
        path.join(profileDir, ".nori-version"),
        JSON.stringify({
          version: "1.0.0",
          registryUrl: REGISTRAR_URL,
        }),
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        profile: { baseProfile: "senior-swe" },
        registryAuths: null,
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.0.1" },
        versions: {
          "1.0.1": { name: "test-profile", version: "1.0.1" },
        },
      });

      const mockTarball = await createMockTarball({ version: "1.0.1" });
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      const input = createInput({
        prompt: "/nori-registry-update test-profile",
      });
      const result = await noriRegistryUpdate.run({ input });

      expect(result).not.toBeNull();
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Updated");
      expect(registrarApi.downloadTarball).toHaveBeenCalled();
    });

    it("should update when minor version is higher", async () => {
      const profileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(
        path.join(profileDir, ".nori-version"),
        JSON.stringify({
          version: "1.0.0",
          registryUrl: REGISTRAR_URL,
        }),
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        profile: { baseProfile: "senior-swe" },
        registryAuths: null,
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.1.0" },
        versions: {
          "1.1.0": { name: "test-profile", version: "1.1.0" },
        },
      });

      const mockTarball = await createMockTarball({ version: "1.1.0" });
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      const input = createInput({
        prompt: "/nori-registry-update test-profile",
      });
      const result = await noriRegistryUpdate.run({ input });

      expect(result).not.toBeNull();
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Updated");
      expect(registrarApi.downloadTarball).toHaveBeenCalled();
    });

    it("should not update when installed version is higher than registry", async () => {
      const profileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(
        path.join(profileDir, ".nori-version"),
        JSON.stringify({
          version: "2.0.0",
          registryUrl: REGISTRAR_URL,
        }),
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        profile: { baseProfile: "senior-swe" },
        registryAuths: null,
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
        },
      });

      const input = createInput({
        prompt: "/nori-registry-update test-profile",
      });
      const result = await noriRegistryUpdate.run({ input });

      expect(result).not.toBeNull();
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("already at latest");
      expect(registrarApi.downloadTarball).not.toHaveBeenCalled();
    });

    it("should handle prerelease versions correctly", async () => {
      const profileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(
        path.join(profileDir, ".nori-version"),
        JSON.stringify({
          version: "1.0.0-beta.1",
          registryUrl: REGISTRAR_URL,
        }),
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        profile: { baseProfile: "senior-swe" },
        registryAuths: null,
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
        },
      });

      const mockTarball = await createMockTarball({ version: "1.0.0" });
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      const input = createInput({
        prompt: "/nori-registry-update test-profile",
      });
      const result = await noriRegistryUpdate.run({ input });

      expect(result).not.toBeNull();
      const plainReason = stripAnsi(result!.reason!);
      // 1.0.0 is greater than 1.0.0-beta.1
      expect(plainReason).toContain("Updated");
      expect(registrarApi.downloadTarball).toHaveBeenCalled();
    });
  });
});

/**
 * Creates a minimal mock tarball for testing
 * Creates a real tarball with package.json and CLAUDE.md files
 * @param args - The tarball options
 * @param args.version - The version to include in package.json
 * @param args.gzip - Whether to gzip the tarball (default: false)
 *
 * @returns A valid tarball as ArrayBuffer
 */
const createMockTarball = async (args?: {
  version?: string | null;
  gzip?: boolean | null;
}): Promise<ArrayBuffer> => {
  const version = args?.version ?? "1.0.0";
  const gzip = args?.gzip ?? false;
  // Create a temp directory with the files to pack
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), "mock-tarball-source-"));
  const tarballPath = path.join(
    tmpdir(),
    `mock-tarball-${Date.now()}.${gzip ? "tgz" : "tar"}`,
  );

  try {
    // Create mock files
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test-profile", version }),
    );
    await fs.writeFile(path.join(tempDir, "CLAUDE.md"), "# Updated Profile");

    // Create the tarball
    await tar.create(
      {
        gzip,
        file: tarballPath,
        cwd: tempDir,
      },
      ["package.json", "CLAUDE.md"],
    );

    // Read the tarball as ArrayBuffer
    const tarballBuffer = await fs.readFile(tarballPath);
    // Create a new ArrayBuffer copy to avoid SharedArrayBuffer type issues
    const arrayBuffer = new ArrayBuffer(tarballBuffer.byteLength);
    new Uint8Array(arrayBuffer).set(tarballBuffer);
    return arrayBuffer;
  } finally {
    // Clean up
    await fs.rm(tempDir, { recursive: true, force: true });
    try {
      await fs.unlink(tarballPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
};
