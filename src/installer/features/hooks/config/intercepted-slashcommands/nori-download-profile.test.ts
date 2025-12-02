/**
 * Tests for nori-download-profile intercepted slash command
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

import { registrarApi } from "@/api/registrar.js";

import type { HookInput } from "./types.js";

import { noriDownloadProfile } from "./nori-download-profile.js";

describe("nori-download-profile", () => {
  let testDir: string;
  let configPath: string;
  let profilesDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test directory structure simulating a Nori installation
    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-download-profile-test-"),
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
      session_id: "test-session",
      transcript_path: "",
      permission_mode: "default",
      hook_event_name: "UserPromptSubmit",
    };
  };

  describe("matchers", () => {
    it("should have valid regex matchers", () => {
      expect(noriDownloadProfile.matchers).toBeInstanceOf(Array);
      expect(noriDownloadProfile.matchers.length).toBeGreaterThan(0);

      for (const matcher of noriDownloadProfile.matchers) {
        expect(() => new RegExp(matcher)).not.toThrow();
      }
    });

    it("should match /nori-download-profile package-name", () => {
      const regex = new RegExp(noriDownloadProfile.matchers[0], "i");
      expect(regex.test("/nori-download-profile my-profile")).toBe(true);
    });

    it("should match /nori-download-profile package-name@version", () => {
      const hasVersionMatcher = noriDownloadProfile.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-download-profile my-profile@1.0.0");
      });
      expect(hasVersionMatcher).toBe(true);
    });

    it("should not match /nori-download-profile without package name", () => {
      const matchesWithoutPackage = noriDownloadProfile.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-download-profile");
      });
      expect(matchesWithoutPackage).toBe(false);
    });
  });

  describe("run function", () => {
    it("should return error when no installation found", async () => {
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-download-no-install-"),
      );

      try {
        const input = createInput({
          prompt: "/nori-download-profile test-profile",
          cwd: noInstallDir,
        });
        const result = await noriDownloadProfile.run({ input });

        expect(result).not.toBeNull();
        expect(result!.decision).toBe("block");
        expect(result!.reason).toContain("No Nori installation found");
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
        prompt: "/nori-download-profile test-profile",
        cwd: nestedDir,
      });
      const result = await noriDownloadProfile.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(result!.reason).toContain("multiple");
    });

    it("should return error when profile already exists", async () => {
      // Create existing profile directory
      const existingProfileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(existingProfileDir, { recursive: true });

      const input = createInput({
        prompt: "/nori-download-profile test-profile",
      });
      const result = await noriDownloadProfile.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(result!.reason).toContain("already exists");
    });

    it("should download and extract tarball on success", async () => {
      // Create a minimal valid tarball (gzipped tar)
      // For this test we just verify the API is called correctly
      const mockPackument = {
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
        },
      };

      // Create a real minimal tarball for testing extraction
      const mockTarball = await createMockTarball();

      vi.mocked(registrarApi.getPackument).mockResolvedValue(mockPackument);
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      const input = createInput({
        prompt: "/nori-download-profile test-profile",
      });
      const result = await noriDownloadProfile.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(result!.reason).toContain("Downloaded");
      expect(result!.reason).toContain("test-profile");

      // Verify API was called
      expect(registrarApi.downloadTarball).toHaveBeenCalledWith({
        packageName: "test-profile",
        version: undefined,
      });
    });

    it("should pass version to downloadTarball when specified", async () => {
      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      const input = createInput({
        prompt: "/nori-download-profile test-profile@2.0.0",
      });
      const result = await noriDownloadProfile.run({ input });

      expect(result).not.toBeNull();
      expect(registrarApi.downloadTarball).toHaveBeenCalledWith({
        packageName: "test-profile",
        version: "2.0.0",
      });
    });

    it("should handle network errors gracefully", async () => {
      vi.mocked(registrarApi.downloadTarball).mockRejectedValue(
        new Error("Network error: Failed to fetch"),
      );

      const input = createInput({
        prompt: "/nori-download-profile test-profile",
      });
      const result = await noriDownloadProfile.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(result!.reason).toContain("Failed");
    });
  });
});

/**
 * Creates a minimal mock tarball (gzipped tar) for testing
 * Creates a real tarball with package.json and AGENT.md files
 * @returns A valid gzipped tarball as ArrayBuffer
 */
const createMockTarball = async (): Promise<ArrayBuffer> => {
  // Create a temp directory with the files to pack
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), "mock-tarball-source-"));
  const tarballPath = path.join(tmpdir(), `mock-tarball-${Date.now()}.tgz`);

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
        gzip: true,
        file: tarballPath,
        cwd: tempDir,
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
