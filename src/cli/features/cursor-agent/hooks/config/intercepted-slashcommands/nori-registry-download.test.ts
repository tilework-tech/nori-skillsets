/**
 * Tests for nori-registry-download intercepted slash command
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

import { noriRegistryDownload } from "./nori-registry-download.js";

// Unicode symbols for cursor-agent output (no ANSI codes)
const SUCCESS_SYMBOL = "\u2713"; // ✓
const ERROR_SYMBOL = "\u2717"; // ✗

// ANSI pattern to verify output contains no escape codes
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/;

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

describe("nori-registry-download", () => {
  let testDir: string;
  let configPath: string;
  let profilesDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test directory structure simulating a Nori installation
    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-registry-download-test-"),
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
      expect(noriRegistryDownload.matchers).toBeInstanceOf(Array);
      expect(noriRegistryDownload.matchers.length).toBeGreaterThan(0);

      for (const matcher of noriRegistryDownload.matchers) {
        expect(() => new RegExp(matcher)).not.toThrow();
      }
    });

    it("should match /nori-registry-download package-name", () => {
      const hasMatch = noriRegistryDownload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-registry-download my-profile");
      });
      expect(hasMatch).toBe(true);
    });

    it("should match /nori-registry-download package-name@version", () => {
      const hasVersionMatcher = noriRegistryDownload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-registry-download my-profile@1.0.0");
      });
      expect(hasVersionMatcher).toBe(true);
    });

    it("should match /nori-registry-download without package name (shows help)", () => {
      const matchesWithoutPackage = noriRegistryDownload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-registry-download");
      });
      expect(matchesWithoutPackage).toBe(true);
    });
  });

  describe("run function", () => {
    it("should show help message when no package name provided", async () => {
      const input = createInput({
        prompt: "/nori-registry-download",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Usage:");
      expect(plainReason).toContain("/nori-registry-download <package-name>");
    });

    it("should return error when no installation found", async () => {
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-registry-download-no-install-"),
      );

      try {
        const input = createInput({
          prompt: "/nori-registry-download test-profile",
          cwd: noInstallDir,
        });
        const result = await noriRegistryDownload.run({ input });

        expect(result).not.toBeNull();
        expect(result!.decision).toBe("block");
        expect(stripAnsi(result!.reason!)).toContain(
          "No Nori installation found",
        );
      } finally {
        await fs.rm(noInstallDir, { recursive: true, force: true });
      }
    });

    it("should return error when multiple installations found", async () => {
      // Create a nested installation
      const nestedDir = path.join(testDir, "nested");
      await fs.mkdir(nestedDir, { recursive: true });
      await fs.writeFile(
        path.join(nestedDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      const input = createInput({
        prompt: "/nori-registry-download test-profile",
        cwd: nestedDir,
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(stripAnsi(result!.reason!)).toContain("multiple");
    });

    it("should return error when profile already exists", async () => {
      // Create existing profile directory
      const existingProfileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(existingProfileDir, { recursive: true });

      const input = createInput({
        prompt: "/nori-registry-download test-profile",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(stripAnsi(result!.reason!)).toContain("already exists");
    });

    it("should download and extract non-gzipped tarball on success", async () => {
      // Registrar currently returns non-gzipped tarballs
      const mockPackument = {
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
        },
      };

      // Create a non-gzipped tarball (matching current registrar behavior)
      const mockTarball = await createMockTarball({ gzip: false });

      vi.mocked(registrarApi.getPackument).mockResolvedValue(mockPackument);
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      const input = createInput({
        prompt: "/nori-registry-download test-profile",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(stripAnsi(result!.reason!)).toContain("Downloaded");
      expect(stripAnsi(result!.reason!)).toContain("test-profile");

      // Verify API was called
      expect(registrarApi.downloadTarball).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: "test-profile",
          version: undefined,
        }),
      );
    });

    it("should download and extract gzipped tarball on success", async () => {
      // Also support gzipped tarballs for future compatibility
      const mockTarball = await createMockTarball({ gzip: true });

      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      const input = createInput({
        prompt: "/nori-registry-download test-profile",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(stripAnsi(result!.reason!)).toContain("Downloaded");
    });

    it("should pass version to downloadTarball when specified", async () => {
      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      const input = createInput({
        prompt: "/nori-registry-download test-profile@2.0.0",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(registrarApi.downloadTarball).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: "test-profile",
          version: "2.0.0",
        }),
      );
    });

    it("should handle network errors gracefully", async () => {
      vi.mocked(registrarApi.downloadTarball).mockRejectedValue(
        new Error("Network error: Failed to fetch"),
      );

      const input = createInput({
        prompt: "/nori-registry-download test-profile",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(stripAnsi(result!.reason!)).toContain("Failed");
    });

    it("should write .nori-version file after successful download", async () => {
      const mockPackument = {
        name: "test-profile",
        "dist-tags": { latest: "1.2.3" },
        versions: {
          "1.2.3": { name: "test-profile", version: "1.2.3" },
        },
      };

      const mockTarball = await createMockTarball({ gzip: false });

      vi.mocked(registrarApi.getPackument).mockResolvedValue(mockPackument);
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      const input = createInput({
        prompt: "/nori-registry-download test-profile",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(stripAnsi(result!.reason!)).toContain("Downloaded");

      // Verify .nori-version file was created
      const versionFilePath = path.join(
        profilesDir,
        "test-profile",
        ".nori-version",
      );
      const versionFileContent = await fs.readFile(versionFilePath, "utf-8");
      const versionInfo = JSON.parse(versionFileContent);

      expect(versionInfo.version).toBe("1.2.3");
      expect(versionInfo.registryUrl).toBe(REGISTRAR_URL);
    });

    it("should write explicit version to .nori-version when specified", async () => {
      const mockPackument = {
        name: "test-profile",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
          "2.0.0": { name: "test-profile", version: "2.0.0" },
        },
      };

      const mockTarball = await createMockTarball({ gzip: false });

      vi.mocked(registrarApi.getPackument).mockResolvedValue(mockPackument);
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      const input = createInput({
        prompt: "/nori-registry-download test-profile@1.0.0",
      });
      await noriRegistryDownload.run({ input });

      // Verify .nori-version file contains the explicit version
      const versionFilePath = path.join(
        profilesDir,
        "test-profile",
        ".nori-version",
      );
      const versionFileContent = await fs.readFile(versionFilePath, "utf-8");
      const versionInfo = JSON.parse(versionFileContent);

      expect(versionInfo.version).toBe("1.0.0");
    });
  });

  describe("output formatting (no ANSI codes)", () => {
    it("should format success download with success symbol and no ANSI codes", async () => {
      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      const input = createInput({
        prompt: "/nori-registry-download test-profile",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.reason).toContain(SUCCESS_SYMBOL);
      expect(result!.reason).not.toMatch(ANSI_PATTERN);
    });

    it("should format no installation error with error symbol and no ANSI codes", async () => {
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-download-no-install-"),
      );

      try {
        const input = createInput({
          prompt: "/nori-registry-download test-profile",
          cwd: noInstallDir,
        });
        const result = await noriRegistryDownload.run({ input });

        expect(result).not.toBeNull();
        expect(result!.reason).toContain(ERROR_SYMBOL);
        expect(result!.reason).not.toMatch(ANSI_PATTERN);
      } finally {
        await fs.rm(noInstallDir, { recursive: true, force: true });
      }
    });

    it("should format multiple installations error with error symbol and no ANSI codes", async () => {
      // Create a nested installation
      const nestedDir = path.join(testDir, "nested");
      await fs.mkdir(nestedDir, { recursive: true });
      await fs.writeFile(
        path.join(nestedDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      const input = createInput({
        prompt: "/nori-registry-download test-profile",
        cwd: nestedDir,
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.reason).toContain(ERROR_SYMBOL);
      expect(result!.reason).not.toMatch(ANSI_PATTERN);
    });

    it("should format profile already exists error with error symbol and no ANSI codes", async () => {
      // Create existing profile directory
      const existingProfileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(existingProfileDir, { recursive: true });

      const input = createInput({
        prompt: "/nori-registry-download test-profile",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.reason).toContain(ERROR_SYMBOL);
      expect(result!.reason).not.toMatch(ANSI_PATTERN);
    });

    it("should format network error with error symbol and no ANSI codes", async () => {
      vi.mocked(registrarApi.downloadTarball).mockRejectedValue(
        new Error("Network error"),
      );

      const input = createInput({
        prompt: "/nori-registry-download test-profile",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.reason).toContain(ERROR_SYMBOL);
      expect(result!.reason).not.toMatch(ANSI_PATTERN);
    });

    it("should format help message with success symbol and no ANSI codes", async () => {
      const input = createInput({
        prompt: "/nori-registry-download",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.reason).toContain(SUCCESS_SYMBOL);
      expect(result!.reason).not.toMatch(ANSI_PATTERN);
    });
  });

  describe("multi-registry support", () => {
    it("should match command with registry URL", () => {
      const hasMatch = noriRegistryDownload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test(
          "/nori-registry-download my-profile https://private-registry.com",
        );
      });
      expect(hasMatch).toBe(true);
    });

    it("should match command with version and registry URL", () => {
      const hasMatch = noriRegistryDownload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test(
          "/nori-registry-download my-profile@1.0.0 https://private-registry.com",
        );
      });
      expect(hasMatch).toBe(true);
    });

    it("should download from public registry when package found only there", async () => {
      const mockTarball = await createMockTarball();

      // Config with no private registries
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        profile: { baseProfile: "senior-swe" },
        registryAuths: null,
      });

      // Package found in public registry
      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
        },
      });
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      const input = createInput({
        prompt: "/nori-registry-download test-profile",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Downloaded");
      expect(plainReason).toContain(REGISTRAR_URL);
    });

    it("should download from private registry when package found only there", async () => {
      const mockTarball = await createMockTarball();

      // Config with private registry
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

      // Package not found in public registry (404)
      vi.mocked(registrarApi.getPackument)
        .mockRejectedValueOnce(new Error("Package not found"))
        .mockResolvedValueOnce({
          name: "test-profile",
          description: "A private profile",
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": { name: "test-profile", version: "1.0.0" },
          },
        });

      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      const input = createInput({
        prompt: "/nori-registry-download test-profile",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Downloaded");
      expect(plainReason).toContain("https://private-registry.com");
    });

    it("should return error with options when package found in multiple registries", async () => {
      // Config with private registry
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

      // Package found in both registries
      vi.mocked(registrarApi.getPackument)
        .mockResolvedValueOnce({
          name: "test-profile",
          description: "Public profile",
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": { name: "test-profile", version: "1.0.0" },
          },
        })
        .mockResolvedValueOnce({
          name: "test-profile",
          description: "Private profile",
          "dist-tags": { latest: "2.0.0" },
          versions: {
            "2.0.0": { name: "test-profile", version: "2.0.0" },
          },
        });

      const input = createInput({
        prompt: "/nori-registry-download test-profile",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Multiple packages");
      expect(plainReason).toContain(REGISTRAR_URL);
      expect(plainReason).toContain("https://private-registry.com");
      expect(plainReason).toContain("test-profile@1.0.0");
      expect(plainReason).toContain("test-profile@2.0.0");
      expect(plainReason).toContain("/nori-registry-download test-profile");
    });

    it("should download from specific registry when URL is provided", async () => {
      const mockTarball = await createMockTarball();

      // Config with private registry
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
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
        },
      });

      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      const input = createInput({
        prompt:
          "/nori-registry-download test-profile https://private-registry.com",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Downloaded");

      // Should only call getPackument once (for the specified registry)
      expect(registrarApi.getPackument).toHaveBeenCalledTimes(1);
      expect(registrarApi.getPackument).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: "test-profile",
          registryUrl: "https://private-registry.com",
        }),
      );
    });

    it("should return error when package not found in any registry", async () => {
      // Config with private registry
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

      // Package not found in any registry
      vi.mocked(registrarApi.getPackument).mockRejectedValue(
        new Error("Package not found"),
      );

      const input = createInput({
        prompt: "/nori-registry-download nonexistent-profile",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("not found");
    });

    it("should continue searching other registries when one fails with auth error", async () => {
      const mockTarball = await createMockTarball();

      // Config with two private registries
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        profile: { baseProfile: "senior-swe" },
        registryAuths: [
          {
            username: "test@example.com",
            password: "password",
            registryUrl: "https://private-registry-1.com",
          },
          {
            username: "test@example.com",
            password: "password",
            registryUrl: "https://private-registry-2.com",
          },
        ],
      });

      vi.mocked(getRegistryAuth).mockImplementation((args) => {
        if (args.registryUrl === "https://private-registry-1.com") {
          return {
            username: "test@example.com",
            password: "password",
            registryUrl: "https://private-registry-1.com",
          };
        }
        if (args.registryUrl === "https://private-registry-2.com") {
          return {
            username: "test@example.com",
            password: "password",
            registryUrl: "https://private-registry-2.com",
          };
        }
        return null;
      });

      // Auth fails for first private registry
      vi.mocked(getRegistryAuthToken)
        .mockRejectedValueOnce(new Error("Auth failed"))
        .mockResolvedValueOnce("test-auth-token");

      // Package not in public, not in first private (auth failed), found in second private
      vi.mocked(registrarApi.getPackument)
        .mockRejectedValueOnce(new Error("Package not found")) // public
        .mockResolvedValueOnce({
          // second private (first is skipped due to auth failure)
          name: "test-profile",
          description: "Found in second private",
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": { name: "test-profile", version: "1.0.0" },
          },
        });

      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      const input = createInput({
        prompt: "/nori-registry-download test-profile",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Downloaded");
      expect(plainReason).toContain("https://private-registry-2.com");
    });

    it("should update help message to show registry URL option", async () => {
      const input = createInput({
        prompt: "/nori-registry-download",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("registry-url");
    });
  });

  describe("list versions feature", () => {
    it("should match command with --list-versions flag", () => {
      const hasMatch = noriRegistryDownload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-registry-download --list-versions my-profile");
      });
      expect(hasMatch).toBe(true);
    });

    it("should list all available versions when --list-versions flag is used", async () => {
      // Config with no private registries
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        profile: { baseProfile: "senior-swe" },
        registryAuths: null,
      });

      // Package found with multiple versions
      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        description: "A test profile",
        "dist-tags": { latest: "2.0.0", beta: "2.1.0-beta.1" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
          "1.1.0": { name: "test-profile", version: "1.1.0" },
          "2.0.0": { name: "test-profile", version: "2.0.0" },
          "2.1.0-beta.1": { name: "test-profile", version: "2.1.0-beta.1" },
        },
        time: {
          "1.0.0": "2024-01-01T00:00:00.000Z",
          "1.1.0": "2024-02-01T00:00:00.000Z",
          "2.0.0": "2024-03-01T00:00:00.000Z",
          "2.1.0-beta.1": "2024-04-01T00:00:00.000Z",
        },
      });

      const input = createInput({
        prompt: "/nori-registry-download --list-versions test-profile",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);

      // Should list all versions
      expect(plainReason).toContain("1.0.0");
      expect(plainReason).toContain("1.1.0");
      expect(plainReason).toContain("2.0.0");
      expect(plainReason).toContain("2.1.0-beta.1");

      // Should indicate which is latest
      expect(plainReason).toContain("latest");

      // Should NOT have downloaded anything
      expect(registrarApi.downloadTarball).not.toHaveBeenCalled();
    });

    it("should list versions with registry URL specified", async () => {
      // Config with private registry
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
        prompt:
          "/nori-registry-download --list-versions private-profile https://private-registry.com",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);

      expect(plainReason).toContain("1.0.0");
      expect(registrarApi.downloadTarball).not.toHaveBeenCalled();
    });

    it("should return error when package not found with --list-versions", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        profile: { baseProfile: "senior-swe" },
        registryAuths: null,
      });

      // Package not found
      vi.mocked(registrarApi.getPackument).mockRejectedValue(
        new Error("Package not found"),
      );

      const input = createInput({
        prompt: "/nori-registry-download --list-versions nonexistent-profile",
      });
      const result = await noriRegistryDownload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);

      expect(plainReason).toContain("not found");
    });
  });
});

/**
 * Creates a minimal mock tarball for testing
 * Creates a real tarball with package.json and AGENT.md files
 * @param args - The tarball options
 * @param args.gzip - Whether to gzip the tarball (default: false, matching registrar behavior)
 *
 * @returns A valid tarball as ArrayBuffer
 */
const createMockTarball = async (args?: {
  gzip?: boolean | null;
}): Promise<ArrayBuffer> => {
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
      JSON.stringify({ name: "test-profile", version: "1.0.0" }),
    );
    await fs.writeFile(path.join(tempDir, "AGENT.md"), "# Test Profile Agent");

    // Create the tarball synchronously to avoid race condition
    tar.create(
      {
        gzip,
        file: tarballPath,
        cwd: tempDir,
        sync: true,
      },
      ["package.json", "AGENT.md"],
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
