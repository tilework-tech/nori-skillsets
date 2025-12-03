/**
 * Tests for registry-download CLI command
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import * as tar from "tar";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the registrar API
vi.mock("@/api/registrar.js", () => ({
  registrarApi: {
    getPackument: vi.fn(),
    downloadTarball: vi.fn(),
  },
}));

// Mock console methods to capture output
const mockConsoleLog = vi
  .spyOn(console, "log")
  .mockImplementation(() => undefined);
const mockConsoleError = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

import { registrarApi } from "@/api/registrar.js";

import { registryDownloadMain } from "./registryDownload.js";

describe("registry-download", () => {
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

  describe("registryDownloadMain", () => {
    it("should download and install profile to correct directory", async () => {
      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
      });

      // Verify API was called
      expect(registrarApi.downloadTarball).toHaveBeenCalledWith({
        packageName: "test-profile",
        version: undefined,
      });

      // Verify profile was extracted to correct location
      const profileDir = path.join(profilesDir, "test-profile");
      const stats = await fs.stat(profileDir);
      expect(stats.isDirectory()).toBe(true);

      // Verify files were extracted
      const packageJson = await fs.readFile(
        path.join(profileDir, "package.json"),
        "utf-8",
      );
      expect(JSON.parse(packageJson).name).toBe("test-profile");

      // Verify success message
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput.toLowerCase()).toContain("download");
      expect(allOutput).toContain("test-profile");
    });

    it("should handle version specification", async () => {
      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      await registryDownloadMain({
        packageSpec: "test-profile@2.0.0",
        cwd: testDir,
      });

      // Verify version was passed to API
      expect(registrarApi.downloadTarball).toHaveBeenCalledWith({
        packageName: "test-profile",
        version: "2.0.0",
      });
    });

    it("should error when profile already exists", async () => {
      // Create existing profile directory
      const existingProfileDir = path.join(profilesDir, "existing-profile");
      await fs.mkdir(existingProfileDir, { recursive: true });

      await registryDownloadMain({
        packageSpec: "existing-profile",
        cwd: testDir,
      });

      // Verify error message about already existing
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("already exists");
    });

    it("should error when no Nori installation found", async () => {
      // Create directory without .nori-config.json
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-no-install-"),
      );

      try {
        await registryDownloadMain({
          packageSpec: "test-profile",
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

    it("should error when multiple installations found", async () => {
      // Create a nested installation
      const nestedDir = path.join(testDir, "nested");
      await fs.mkdir(nestedDir, { recursive: true });
      await fs.writeFile(
        path.join(nestedDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: nestedDir,
      });

      // Verify error message about multiple installations
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("multiple");
    });

    it("should handle download errors gracefully", async () => {
      vi.mocked(registrarApi.downloadTarball).mockRejectedValue(
        new Error("Network error: Failed to fetch"),
      );

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
      });

      // Verify error message
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("error");
      expect(allErrorOutput).toContain("Network error");
    });

    it("should support gzipped tarballs", async () => {
      const mockTarball = await createMockTarball({ gzip: true });
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      await registryDownloadMain({
        packageSpec: "gzipped-profile",
        cwd: testDir,
      });

      // Verify profile was extracted
      const profileDir = path.join(profilesDir, "gzipped-profile");
      const stats = await fs.stat(profileDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it("should use --install-dir option when provided", async () => {
      // Create a separate installation directory
      const customInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-custom-install-"),
      );
      const customProfilesDir = path.join(
        customInstallDir,
        ".claude",
        "profiles",
      );
      await fs.mkdir(customProfilesDir, { recursive: true });
      await fs.writeFile(
        path.join(customInstallDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      try {
        await registryDownloadMain({
          packageSpec: "custom-profile",
          installDir: customInstallDir,
        });

        // Verify profile was installed to custom directory
        const profileDir = path.join(customProfilesDir, "custom-profile");
        const stats = await fs.stat(profileDir);
        expect(stats.isDirectory()).toBe(true);
      } finally {
        await fs.rm(customInstallDir, { recursive: true, force: true });
      }
    });
  });
});

/**
 * Creates a minimal mock tarball for testing
 * @param args - The tarball options
 * @param args.gzip - Whether to gzip the tarball (default: false)
 *
 * @returns A valid tarball as ArrayBuffer
 */
const createMockTarball = async (args?: {
  gzip?: boolean | null;
}): Promise<ArrayBuffer> => {
  const gzip = args?.gzip ?? false;
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

    // Create the tarball
    await tar.create(
      {
        gzip,
        file: tarballPath,
        cwd: tempDir,
      },
      ["package.json", "AGENT.md"],
    );

    // Read the tarball as ArrayBuffer
    const tarballBuffer = await fs.readFile(tarballPath);
    const arrayBuffer = new ArrayBuffer(tarballBuffer.byteLength);
    new Uint8Array(arrayBuffer).set(tarballBuffer);
    return arrayBuffer;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    try {
      await fs.unlink(tarballPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
};
