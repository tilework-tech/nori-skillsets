/**
 * Tests for nori-search-profiles intercepted slash command
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the registrar API
vi.mock("@/api/registrar.js", () => ({
  registrarApi: {
    searchPackages: vi.fn(),
  },
}));

import { registrarApi } from "@/api/registrar.js";

import type { HookInput } from "./types.js";

import { noriSearchProfiles } from "./nori-search-profiles.js";

// ANSI color codes for verification
const GREEN = "\x1b[0;32m";
const RED = "\x1b[0;31m";
const NC = "\x1b[0m"; // No Color / Reset

describe("nori-search-profiles", () => {
  let testDir: string;
  let configPath: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test directory structure simulating a Nori installation
    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-search-profiles-test-"),
    );
    configPath = path.join(testDir, ".nori-config.json");

    // Create initial config
    await fs.writeFile(
      configPath,
      JSON.stringify({
        profile: {
          baseProfile: "senior-swe",
        },
      }),
    );
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
      expect(noriSearchProfiles.matchers).toBeInstanceOf(Array);
      expect(noriSearchProfiles.matchers.length).toBeGreaterThan(0);

      for (const matcher of noriSearchProfiles.matchers) {
        expect(() => new RegExp(matcher)).not.toThrow();
      }
    });

    it("should match /nori-search-profiles query", () => {
      const hasMatch = noriSearchProfiles.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-search-profiles test");
      });
      expect(hasMatch).toBe(true);
    });

    it("should match /nori-search-profiles with multiple words", () => {
      const hasMatch = noriSearchProfiles.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-search-profiles typescript react");
      });
      expect(hasMatch).toBe(true);
    });

    it("should match /nori-search-profiles without query (shows help)", () => {
      const matchesWithoutQuery = noriSearchProfiles.matchers.some((m) => {
        const regex = new RegExp(m, "i");
        return regex.test("/nori-search-profiles");
      });
      expect(matchesWithoutQuery).toBe(true);
    });
  });

  describe("run function", () => {
    it("should show help message when no query provided", async () => {
      const input = createInput({
        prompt: "/nori-search-profiles",
      });
      const result = await noriSearchProfiles.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(result!.reason).toContain("Usage:");
      expect(result!.reason).toContain("/nori-search-profiles <query>");
    });

    it("should return error when no installation found", async () => {
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-search-no-install-"),
      );

      try {
        const input = createInput({
          prompt: "/nori-search-profiles test",
          cwd: noInstallDir,
        });
        const result = await noriSearchProfiles.run({ input });

        expect(result).not.toBeNull();
        expect(result!.decision).toBe("block");
        expect(result!.reason).toContain("No Nori installation found");
      } finally {
        await fs.rm(noInstallDir, { recursive: true, force: true });
      }
    });

    it("should display search results when packages found", async () => {
      const mockPackages = [
        {
          id: "pkg-1",
          name: "test-profile",
          description: "A test profile for developers",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "pkg-2",
          name: "another-profile",
          description: "Another great profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-02T00:00:00.000Z",
          updatedAt: "2024-01-02T00:00:00.000Z",
        },
      ];

      vi.mocked(registrarApi.searchPackages).mockResolvedValue(mockPackages);

      const input = createInput({
        prompt: "/nori-search-profiles test",
      });
      const result = await noriSearchProfiles.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(result!.reason).toContain("test-profile");
      expect(result!.reason).toContain("another-profile");
      expect(result!.reason).toContain("A test profile");

      // Verify API was called with correct query
      expect(registrarApi.searchPackages).toHaveBeenCalledWith({
        query: "test",
      });
    });

    it("should display no results message when empty", async () => {
      vi.mocked(registrarApi.searchPackages).mockResolvedValue([]);

      const input = createInput({
        prompt: "/nori-search-profiles nonexistent",
      });
      const result = await noriSearchProfiles.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(result!.reason).toContain("No profiles found");
    });

    it("should handle network errors gracefully", async () => {
      vi.mocked(registrarApi.searchPackages).mockRejectedValue(
        new Error("Network error: Failed to fetch"),
      );

      const input = createInput({
        prompt: "/nori-search-profiles test",
      });
      const result = await noriSearchProfiles.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(result!.reason).toContain("Failed");
    });

    it("should pass multi-word query to API", async () => {
      vi.mocked(registrarApi.searchPackages).mockResolvedValue([]);

      const input = createInput({
        prompt: "/nori-search-profiles typescript react developer",
      });
      await noriSearchProfiles.run({ input });

      expect(registrarApi.searchPackages).toHaveBeenCalledWith({
        query: "typescript react developer",
      });
    });
  });

  describe("ANSI color formatting", () => {
    it("should format success results with green color codes", async () => {
      const mockPackages = [
        {
          id: "pkg-1",
          name: "test-profile",
          description: "A test profile",
          authorEmail: "test@example.com",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      vi.mocked(registrarApi.searchPackages).mockResolvedValue(mockPackages);

      const input = createInput({
        prompt: "/nori-search-profiles test",
      });
      const result = await noriSearchProfiles.run({ input });

      expect(result).not.toBeNull();
      expect(result!.reason).toContain(GREEN);
      expect(result!.reason).toContain(NC);
    });

    it("should format no results message with green color codes", async () => {
      vi.mocked(registrarApi.searchPackages).mockResolvedValue([]);

      const input = createInput({
        prompt: "/nori-search-profiles nonexistent",
      });
      const result = await noriSearchProfiles.run({ input });

      expect(result).not.toBeNull();
      expect(result!.reason).toContain(GREEN);
      expect(result!.reason).toContain(NC);
    });

    it("should format error messages with red color codes", async () => {
      vi.mocked(registrarApi.searchPackages).mockRejectedValue(
        new Error("Network error"),
      );

      const input = createInput({
        prompt: "/nori-search-profiles test",
      });
      const result = await noriSearchProfiles.run({ input });

      expect(result).not.toBeNull();
      expect(result!.reason).toContain(RED);
      expect(result!.reason).toContain(NC);
    });

    it("should format no installation error with red color codes", async () => {
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-search-no-install-"),
      );

      try {
        const input = createInput({
          prompt: "/nori-search-profiles test",
          cwd: noInstallDir,
        });
        const result = await noriSearchProfiles.run({ input });

        expect(result).not.toBeNull();
        expect(result!.reason).toContain(RED);
        expect(result!.reason).toContain(NC);
      } finally {
        await fs.rm(noInstallDir, { recursive: true, force: true });
      }
    });

    it("should format help message with green color codes", async () => {
      const input = createInput({
        prompt: "/nori-search-profiles",
      });
      const result = await noriSearchProfiles.run({ input });

      expect(result).not.toBeNull();
      expect(result!.reason).toContain(GREEN);
      expect(result!.reason).toContain(NC);
    });
  });
});
