/**
 * Tests for refactored install.ts functions
 * Tests generatePromptConfig, interactive(), and noninteractive()
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, vi } from "vitest";

import type { DiskConfig } from "./config.js";

// Mock modules
let mockClaudeDir = "/tmp/test-claude";
const mockConfigPath = "/tmp/test-config.json";

vi.mock("@/installer/env.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeHomeDir: () => mockClaudeDir,
  getClaudeHomeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(mockClaudeDir, "skills"),
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
  MCP_ROOT: "/mock/mcp/root",
}));

vi.mock("@/installer/config.js", async () => {
  const actual: any = await vi.importActual("@/installer/config.js");
  return {
    ...actual,
    getConfigPath: () => mockConfigPath,
  };
});

vi.mock("@/installer/analytics.js", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("@/installer/logger.js", () => ({
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  wrapText: vi.fn((args: { text: string }) => args.text),
  brightCyan: vi.fn((args: { text: string }) => args.text),
  boldWhite: vi.fn((args: { text: string }) => args.text),
  gray: vi.fn((args: { text: string }) => args.text),
}));

vi.mock("@/installer/asciiArt.js", () => ({
  displayNoriBanner: vi.fn(),
  displayWelcomeBanner: vi.fn(),
  displaySeaweedBed: vi.fn(),
}));

vi.mock("@/installer/features/loaderRegistry.js", () => ({
  LoaderRegistry: {
    getInstance: () => ({
      getAll: () => [],
    }),
  },
}));

vi.mock("@/installer/features/profiles/loader.js", () => ({
  profilesLoader: {
    run: vi.fn(),
  },
}));

vi.mock("@/installer/version.js", () => ({
  getCurrentPackageVersion: vi.fn(() => "1.0.0"),
  getInstalledVersion: vi.fn(() => null),
  hasExistingInstallation: vi.fn(() => false),
  saveInstalledVersion: vi.fn(),
}));

vi.mock("@/utils/path.js", () => ({
  normalizeInstallDir: vi.fn(
    (args: { installDir?: string | null }) => args.installDir || process.cwd(),
  ),
  findAncestorInstallations: vi.fn(() => []),
}));

vi.mock("@/installer/prompt.js", () => ({
  promptUser: vi.fn(),
}));

// Import after mocking
import { generatePromptConfig } from "./install.js";
import { promptUser } from "./prompt.js";

describe("install.ts refactoring", () => {
  describe("generatePromptConfig", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should return config for new paid user", async () => {
      // Setup: User provides paid credentials and selects a profile
      vi.mocked(promptUser)
        .mockResolvedValueOnce("user@example.com") // email
        .mockResolvedValueOnce("password123") // password
        .mockResolvedValueOnce("http://localhost:3000") // org URL
        .mockResolvedValueOnce("1"); // profile selection

      // Create mock profiles directory with one profile
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-install-"));
      mockClaudeDir = tempDir;
      const profilesDir = path.join(tempDir, "profiles");
      await fs.mkdir(profilesDir, { recursive: true });

      const testProfileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(testProfileDir, { recursive: true });
      await fs.writeFile(
        path.join(testProfileDir, "profile.json"),
        JSON.stringify({ description: "Test Profile" }),
      );

      try {
        const result = await generatePromptConfig({
          installDir: tempDir,
          existingDiskConfig: null,
        });

        expect(result).not.toBeNull();
        expect(result?.config.installType).toBe("paid");
        expect(result?.config.auth?.username).toBe("user@example.com");
        expect(result?.diskConfigToSave.auth?.username).toBe(
          "user@example.com",
        );
        expect(result?.diskConfigToSave.profile?.baseProfile).toBe(
          "test-profile",
        );
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it("should return config for free tier user", async () => {
      // Setup: User skips credentials and selects a profile
      vi.mocked(promptUser)
        .mockResolvedValueOnce("") // skip email (free tier)
        .mockResolvedValueOnce("1"); // profile selection

      // Create mock profiles directory with one profile
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-install-"));
      mockClaudeDir = tempDir;
      const profilesDir = path.join(tempDir, "profiles");
      await fs.mkdir(profilesDir, { recursive: true });

      const testProfileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(testProfileDir, { recursive: true });
      await fs.writeFile(
        path.join(testProfileDir, "profile.json"),
        JSON.stringify({ description: "Test Profile" }),
      );

      try {
        const result = await generatePromptConfig({
          installDir: tempDir,
          existingDiskConfig: null,
        });

        expect(result).not.toBeNull();
        expect(result?.config.installType).toBe("free");
        expect(result?.config.auth).toBe(null);
        expect(result?.diskConfigToSave.auth).toBe(undefined);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it("should return config when user reuses existing config", async () => {
      // Setup: User chooses to keep existing config
      vi.mocked(promptUser).mockResolvedValueOnce("y"); // keep existing

      const existingDiskConfig: DiskConfig = {
        auth: {
          username: "existing@example.com",
          password: "existingpass",
          organizationUrl: "http://existing.com",
        },
        profile: {
          baseProfile: "existing-profile",
        },
        installDir: "/tmp/test",
      };

      const result = await generatePromptConfig({
        installDir: "/tmp/test",
        existingDiskConfig,
      });

      expect(result).not.toBeNull();
      expect(result?.config.auth?.username).toBe("existing@example.com");
      expect(result?.diskConfigToSave.profile?.baseProfile).toBe(
        "existing-profile",
      );
    });
  });
});
