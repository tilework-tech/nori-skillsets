/**
 * Tests for announcements feature loader
 * Verifies install operations for companyAnnouncements
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/cli/config.js";

// Mock the env module to use temp directories
let mockClaudeDir: string;
let mockClaudeSettingsFile: string;

vi.mock("@/cli/features/claude-code/paths.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => mockClaudeSettingsFile,
  getClaudeHomeDir: () => mockClaudeDir,
  getClaudeHomeSettingsFile: () => mockClaudeSettingsFile,
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(mockClaudeDir, "skills"),
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
}));

// Import loader after mocking env
import { announcementsLoader } from "./loader.js";

describe("announcementsLoader", () => {
  let tempDir: string;
  let claudeDir: string;
  let settingsPath: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "announcements-test-"));
    claudeDir = path.join(tempDir, ".claude");
    settingsPath = path.join(claudeDir, "settings.json");

    // Set mock paths
    mockClaudeDir = claudeDir;
    mockClaudeSettingsFile = settingsPath;

    // Mock HOME environment variable to isolate nori-config.json
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;

    // Create directories
    await fs.mkdir(claudeDir, { recursive: true });
  });

  afterEach(async () => {
    // Restore HOME environment variable
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("run", () => {
    it("should create settings.json with companyAnnouncements", async () => {
      const config: Config = { installDir: tempDir };

      await announcementsLoader.run({ config });

      // Verify settings.json exists
      const exists = await fs
        .access(settingsPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Read and parse settings
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      // Verify companyAnnouncements is configured
      expect(settings.companyAnnouncements).toBeDefined();
      expect(Array.isArray(settings.companyAnnouncements)).toBe(true);
      expect(settings.companyAnnouncements).toContain(
        "🍙🍙🍙 Powered by Nori AI 🍙🍙🍙",
      );
    });

    it("should preserve existing settings when adding companyAnnouncements", async () => {
      const config: Config = { installDir: tempDir };

      // Create settings.json with existing content
      const existingSettings = {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
        someOtherSetting: "value",
      };
      await fs.writeFile(
        settingsPath,
        JSON.stringify(existingSettings, null, 2),
      );

      await announcementsLoader.run({ config });

      // Read and parse settings
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      // Verify existing settings are preserved
      expect(settings.someOtherSetting).toBe("value");
      expect(settings.$schema).toBe(
        "https://json.schemastore.org/claude-code-settings.json",
      );

      // Verify companyAnnouncements is added
      expect(settings.companyAnnouncements).toBeDefined();
    });

    it("should update companyAnnouncements if already configured", async () => {
      const config: Config = { installDir: tempDir };

      // First installation
      await announcementsLoader.run({ config });

      // Second installation (update)
      await announcementsLoader.run({ config });

      // Read updated settings
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      // Verify companyAnnouncements still exists with correct value
      expect(settings.companyAnnouncements).toBeDefined();
      expect(settings.companyAnnouncements).toContain(
        "🍙🍙🍙 Powered by Nori AI 🍙🍙🍙",
      );
    });
  });
});
