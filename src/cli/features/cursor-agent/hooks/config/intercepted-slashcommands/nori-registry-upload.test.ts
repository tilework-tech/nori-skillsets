/**
 * Tests for nori-registry-upload intercepted slash command
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the registrar API
vi.mock("@/api/registrar.js", () => ({
  registrarApi: {
    uploadProfile: vi.fn(),
    getPackument: vi.fn(),
  },
  REGISTRAR_URL: "https://registrar.tilework.tech",
}));

// Mock the registry auth module
vi.mock("@/api/registryAuth.js", () => ({
  getRegistryAuthToken: vi.fn(),
}));

import { registrarApi } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";

import type { HookInput } from "./types.js";

import { noriRegistryUpload } from "./nori-registry-upload.js";

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

describe("nori-registry-upload", () => {
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

  const createTestProfile = async (args: { name: string }): Promise<void> => {
    const { name } = args;
    const profileDir = path.join(profilesDir, name);
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(path.join(profileDir, "CLAUDE.md"), "# Test Profile");
    // Create a skills subdirectory with a skill
    const skillsDir = path.join(profileDir, "skills", "test-skill");
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(
      path.join(skillsDir, "SKILL.md"),
      "---\nname: Test Skill\n---\n# Test Skill",
    );
  };

  const createConfigWithRegistryAuth = async (): Promise<void> => {
    await fs.writeFile(
      configPath,
      JSON.stringify({
        profile: { baseProfile: "senior-swe" },
        registryAuths: [
          {
            username: "test@example.com",
            password: "test-password",
            registryUrl: "https://registrar.tilework.tech",
          },
        ],
      }),
    );
  };

  const createConfigWithoutRegistryAuth = async (): Promise<void> => {
    await fs.writeFile(
      configPath,
      JSON.stringify({
        profile: { baseProfile: "senior-swe" },
      }),
    );
  };

  describe("matchers", () => {
    it("should have valid regex matchers", () => {
      expect(noriRegistryUpload.matchers).toBeInstanceOf(Array);
      expect(noriRegistryUpload.matchers.length).toBeGreaterThan(0);

      for (const matcher of noriRegistryUpload.matchers) {
        expect(() => new RegExp(matcher)).not.toThrow();
      }
    });

    it("should match /nori-registry-upload profile-name", () => {
      const hasMatch = noriRegistryUpload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-registry-upload my-profile");
      });
      expect(hasMatch).toBe(true);
    });

    it("should match /nori-registry-upload profile-name version", () => {
      const hasVersionMatcher = noriRegistryUpload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-registry-upload my-profile 1.0.0");
      });
      expect(hasVersionMatcher).toBe(true);
    });

    it("should match /nori-registry-upload without profile name (shows help)", () => {
      const matchesWithoutProfile = noriRegistryUpload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-registry-upload");
      });
      expect(matchesWithoutProfile).toBe(true);
    });
  });

  describe("run function", () => {
    it("should show help message when no profile name provided", async () => {
      await createConfigWithRegistryAuth();

      const input = createInput({
        prompt: "/nori-registry-upload",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Usage:");
      expect(plainReason).toContain("/nori-registry-upload <profile-name>");
    });

    it("should return error when no installation found", async () => {
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-upload-no-install-"),
      );

      try {
        const input = createInput({
          prompt: "/nori-registry-upload test-profile",
          cwd: noInstallDir,
        });
        const result = await noriRegistryUpload.run({ input });

        expect(result).not.toBeNull();
        expect(result!.decision).toBe("block");
        expect(stripAnsi(result!.reason!)).toContain(
          "No Nori installation found",
        );
      } finally {
        await fs.rm(noInstallDir, { recursive: true, force: true });
      }
    });

    it("should return error when no registry auth configured", async () => {
      await createConfigWithoutRegistryAuth();
      await createTestProfile({ name: "test-profile" });

      const input = createInput({
        prompt: "/nori-registry-upload test-profile",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("No registry authentication");
      expect(plainReason).toContain("registryAuths");
    });

    it("should return error when profile does not exist", async () => {
      await createConfigWithRegistryAuth();

      const input = createInput({
        prompt: "/nori-registry-upload nonexistent-profile",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("not found");
      expect(plainReason).toContain("nonexistent-profile");
    });

    it("should upload profile successfully with default version", async () => {
      await createConfigWithRegistryAuth();
      await createTestProfile({ name: "test-profile" });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");
      vi.mocked(registrarApi.uploadProfile).mockResolvedValue({
        name: "test-profile",
        version: "1.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      const input = createInput({
        prompt: "/nori-registry-upload test-profile",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Successfully uploaded");
      expect(plainReason).toContain("test-profile@1.0.0");

      // Verify API was called with default version
      expect(registrarApi.uploadProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: "test-profile",
          version: "1.0.0",
          authToken: "mock-auth-token",
        }),
      );
    });

    it("should upload profile with specified version", async () => {
      await createConfigWithRegistryAuth();
      await createTestProfile({ name: "test-profile" });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");
      vi.mocked(registrarApi.uploadProfile).mockResolvedValue({
        name: "test-profile",
        version: "2.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      const input = createInput({
        prompt: "/nori-registry-upload test-profile 2.0.0",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(stripAnsi(result!.reason!)).toContain("test-profile@2.0.0");

      // Verify API was called with specified version
      expect(registrarApi.uploadProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: "test-profile",
          version: "2.0.0",
        }),
      );
    });

    it("should handle authentication failure", async () => {
      await createConfigWithRegistryAuth();
      await createTestProfile({ name: "test-profile" });

      vi.mocked(getRegistryAuthToken).mockRejectedValue(
        new Error("Invalid credentials"),
      );

      const input = createInput({
        prompt: "/nori-registry-upload test-profile",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(stripAnsi(result!.reason!)).toContain("Authentication failed");
    });

    it("should handle upload API errors", async () => {
      await createConfigWithRegistryAuth();
      await createTestProfile({ name: "test-profile" });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");
      vi.mocked(registrarApi.uploadProfile).mockRejectedValue(
        new Error("Version already exists"),
      );

      const input = createInput({
        prompt: "/nori-registry-upload test-profile",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Upload failed");
      expect(plainReason).toContain("Version already exists");
    });

    it("should handle version conflict (409) from server", async () => {
      await createConfigWithRegistryAuth();
      await createTestProfile({ name: "test-profile" });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");
      vi.mocked(registrarApi.uploadProfile).mockRejectedValue(
        new Error("Version 1.0.0 already exists for package test-profile"),
      );

      const input = createInput({
        prompt: "/nori-registry-upload test-profile 1.0.0",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(stripAnsi(result!.reason!)).toContain("already exists");
    });
  });

  describe("multi-registry support", () => {
    const createConfigWithMultipleRegistries = async (): Promise<void> => {
      await fs.writeFile(
        configPath,
        JSON.stringify({
          profile: { baseProfile: "senior-swe" },
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
        }),
      );
    };

    it("should match /nori-registry-upload with registry URL", () => {
      const hasMatch = noriRegistryUpload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test(
          "/nori-registry-upload my-profile https://private-registry.example.com",
        );
      });
      expect(hasMatch).toBe(true);
    });

    it("should match /nori-registry-upload with version and registry URL", () => {
      const hasMatch = noriRegistryUpload.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test(
          "/nori-registry-upload my-profile 1.0.0 https://private-registry.example.com",
        );
      });
      expect(hasMatch).toBe(true);
    });

    it("should upload to single configured registry without requiring URL", async () => {
      await createConfigWithRegistryAuth();
      await createTestProfile({ name: "test-profile" });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");
      vi.mocked(registrarApi.uploadProfile).mockResolvedValue({
        name: "test-profile",
        version: "1.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      const input = createInput({
        prompt: "/nori-registry-upload test-profile",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Successfully uploaded");

      // Verify API was called with the single configured registry
      expect(registrarApi.uploadProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: "test-profile",
          registryUrl: "https://registrar.tilework.tech",
        }),
      );
    });

    it("should error when multiple registries configured and no URL provided", async () => {
      await createConfigWithMultipleRegistries();
      await createTestProfile({ name: "test-profile" });

      const input = createInput({
        prompt: "/nori-registry-upload test-profile",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);

      // Should list multiple registries
      expect(plainReason).toContain("Multiple registries");
      expect(plainReason).toContain("https://registrar.tilework.tech");
      expect(plainReason).toContain("https://private-registry.example.com");

      // Should show example commands
      expect(plainReason).toContain(
        "/nori-registry-upload test-profile https://registrar.tilework.tech",
      );
      expect(plainReason).toContain(
        "/nori-registry-upload test-profile https://private-registry.example.com",
      );
    });

    it("should upload to specified registry when multiple are configured", async () => {
      await createConfigWithMultipleRegistries();
      await createTestProfile({ name: "test-profile" });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-private-token");
      vi.mocked(registrarApi.uploadProfile).mockResolvedValue({
        name: "test-profile",
        version: "1.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      const input = createInput({
        prompt:
          "/nori-registry-upload test-profile https://private-registry.example.com",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Successfully uploaded");

      // Verify API was called with the specified registry
      expect(registrarApi.uploadProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: "test-profile",
          registryUrl: "https://private-registry.example.com",
        }),
      );
    });

    it("should upload with version and registry URL", async () => {
      await createConfigWithMultipleRegistries();
      await createTestProfile({ name: "test-profile" });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");
      vi.mocked(registrarApi.uploadProfile).mockResolvedValue({
        name: "test-profile",
        version: "2.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      const input = createInput({
        prompt:
          "/nori-registry-upload test-profile 2.0.0 https://registrar.tilework.tech",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Successfully uploaded");
      expect(plainReason).toContain("test-profile@2.0.0");

      // Verify API was called with correct version and registry
      expect(registrarApi.uploadProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: "test-profile",
          version: "2.0.0",
          registryUrl: "https://registrar.tilework.tech",
        }),
      );
    });

    it("should error when specified registry URL not in config", async () => {
      await createConfigWithRegistryAuth();
      await createTestProfile({ name: "test-profile" });

      const input = createInput({
        prompt:
          "/nori-registry-upload test-profile https://unknown-registry.example.com",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("No registry authentication");
      expect(plainReason).toContain("https://unknown-registry.example.com");
    });

    it("should show registry URL in help message", async () => {
      await createConfigWithRegistryAuth();

      const input = createInput({
        prompt: "/nori-registry-upload",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("[registry-url]");
    });
  });

  describe("output formatting (no ANSI codes)", () => {
    it("should format success upload with success symbol and no ANSI codes", async () => {
      await createConfigWithRegistryAuth();
      await createTestProfile({ name: "test-profile" });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");
      vi.mocked(registrarApi.uploadProfile).mockResolvedValue({
        name: "test-profile",
        version: "1.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      const input = createInput({
        prompt: "/nori-registry-upload test-profile",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.reason).toContain(SUCCESS_SYMBOL);
      expect(result!.reason).not.toMatch(ANSI_PATTERN);
    });

    it("should format error messages with error symbol and no ANSI codes", async () => {
      await createConfigWithRegistryAuth();

      const input = createInput({
        prompt: "/nori-registry-upload nonexistent-profile",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.reason).toContain(ERROR_SYMBOL);
      expect(result!.reason).not.toMatch(ANSI_PATTERN);
    });

    it("should format help message with success symbol and no ANSI codes", async () => {
      await createConfigWithRegistryAuth();

      const input = createInput({
        prompt: "/nori-registry-upload",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.reason).toContain(SUCCESS_SYMBOL);
      expect(result!.reason).not.toMatch(ANSI_PATTERN);
    });
  });

  describe("version auto-bump", () => {
    it("should auto-bump patch version when package exists and no version specified", async () => {
      await createConfigWithRegistryAuth();
      await createTestProfile({ name: "test-profile" });

      // Mock packument showing existing version 1.2.3
      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.2.3" },
        versions: {
          "1.2.3": {
            name: "test-profile",
            version: "1.2.3",
            dist: { tarball: "/tarball/1.2.3", shasum: "abc" },
          },
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");
      vi.mocked(registrarApi.uploadProfile).mockResolvedValue({
        name: "test-profile",
        version: "1.2.4",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      const input = createInput({
        prompt: "/nori-registry-upload test-profile",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Successfully uploaded");
      expect(plainReason).toContain("test-profile@1.2.4");

      // Verify API was called with auto-bumped version
      expect(registrarApi.uploadProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: "test-profile",
          version: "1.2.4",
        }),
      );
    });

    it("should default to 1.0.0 when package does not exist", async () => {
      await createConfigWithRegistryAuth();
      await createTestProfile({ name: "new-profile" });

      // Mock packument returning 404 (package doesn't exist)
      vi.mocked(registrarApi.getPackument).mockRejectedValue(
        new Error("Package not found"),
      );

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");
      vi.mocked(registrarApi.uploadProfile).mockResolvedValue({
        name: "new-profile",
        version: "1.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      const input = createInput({
        prompt: "/nori-registry-upload new-profile",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Successfully uploaded");
      expect(plainReason).toContain("new-profile@1.0.0");

      // Verify API was called with default version
      expect(registrarApi.uploadProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: "new-profile",
          version: "1.0.0",
        }),
      );
    });

    it("should use explicit version when provided (override auto-bump)", async () => {
      await createConfigWithRegistryAuth();
      await createTestProfile({ name: "test-profile" });

      // Mock packument showing existing version 1.2.3
      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.2.3" },
        versions: {
          "1.2.3": {
            name: "test-profile",
            version: "1.2.3",
            dist: { tarball: "/tarball/1.2.3", shasum: "abc" },
          },
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");
      vi.mocked(registrarApi.uploadProfile).mockResolvedValue({
        name: "test-profile",
        version: "2.0.0",
        tarballSha: "sha512-abc123",
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      const input = createInput({
        prompt: "/nori-registry-upload test-profile 2.0.0",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("test-profile@2.0.0");

      // Verify getPackument was NOT called (explicit version provided)
      expect(registrarApi.getPackument).not.toHaveBeenCalled();

      // Verify API was called with explicit version
      expect(registrarApi.uploadProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: "test-profile",
          version: "2.0.0",
        }),
      );
    });
  });
});
