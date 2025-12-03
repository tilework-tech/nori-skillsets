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

// ANSI color codes for verification
const GREEN = "\x1b[0;32m";
const RED = "\x1b[0;31m";
const NC = "\x1b[0m"; // No Color / Reset

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
      session_id: "test-session",
      transcript_path: "",
      permission_mode: "default",
      hook_event_name: "UserPromptSubmit",
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
      expect(result!.reason).toContain("Usage:");
      expect(result!.reason).toContain("/nori-registry-upload <profile-name>");
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
        expect(result!.reason).toContain("No Nori installation found");
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
      expect(result!.reason).toContain("No registry authentication");
      expect(result!.reason).toContain("registryAuths");
    });

    it("should return error when profile does not exist", async () => {
      await createConfigWithRegistryAuth();

      const input = createInput({
        prompt: "/nori-registry-upload nonexistent-profile",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(result!.reason).toContain("not found");
      expect(result!.reason).toContain("nonexistent-profile");
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
      expect(result!.reason).toContain("Successfully uploaded");
      expect(result!.reason).toContain("test-profile@1.0.0");

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
      expect(result!.reason).toContain("test-profile@2.0.0");

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
      expect(result!.reason).toContain("Authentication failed");
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
      expect(result!.reason).toContain("Upload failed");
      expect(result!.reason).toContain("Version already exists");
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
      expect(result!.reason).toContain("already exists");
    });
  });

  describe("ANSI color formatting", () => {
    it("should format success upload with green color codes", async () => {
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
      expect(result!.reason).toContain(GREEN);
      expect(result!.reason).toContain(NC);
    });

    it("should format error messages with red color codes", async () => {
      await createConfigWithRegistryAuth();

      const input = createInput({
        prompt: "/nori-registry-upload nonexistent-profile",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.reason).toContain(RED);
      expect(result!.reason).toContain(NC);
    });

    it("should format help message with green color codes", async () => {
      await createConfigWithRegistryAuth();

      const input = createInput({
        prompt: "/nori-registry-upload",
      });
      const result = await noriRegistryUpload.run({ input });

      expect(result).not.toBeNull();
      expect(result!.reason).toContain(GREEN);
      expect(result!.reason).toContain(NC);
    });
  });
});
