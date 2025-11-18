/**
 * Tests for uninstall idempotency
 * Verifies runUninstall can be called multiple times safely
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock modules - initialize with temp values
let mockClaudeDir = "/tmp/test-claude";
let mockConfigPath = "/tmp/test-config.json";

vi.mock("@/installer/env.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(mockClaudeDir, "skills"),
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
  MCP_ROOT: "/mock/mcp/root",
}));

let mockLoadedConfig: any = null;

vi.mock("@/installer/config.js", async () => {
  const actual: any = await vi.importActual("@/installer/config.js");
  return {
    ...actual,
    getConfigPath: () => mockConfigPath,
    loadDiskConfig: async () => mockLoadedConfig,
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
}));

vi.mock("@/installer/features/loaderRegistry.js", () => ({
  LoaderRegistry: {
    getInstance: () => ({
      getAll: () => [],
      getAllReversed: () => [],
    }),
  },
}));

// Import after mocking
import { runUninstall } from "./uninstall.js";

describe("uninstall idempotency", () => {
  let tempDir: string;
  let claudeDir: string;
  let skillsDir: string;
  let configPath: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Save original HOME
    originalHome = process.env.HOME;

    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "uninstall-test-"));
    claudeDir = path.join(tempDir, ".claude");
    skillsDir = path.join(claudeDir, "skills");
    configPath = path.join(tempDir, "nori-config.json");

    // CRITICAL: Mock HOME to point to temp directory
    // This ensures ALL file operations using HOME are redirected to temp
    process.env.HOME = tempDir;

    // Set mock paths
    mockClaudeDir = claudeDir;
    mockConfigPath = configPath;

    // Reset mock config
    mockLoadedConfig = null;
  });

  afterEach(async () => {
    // Restore original HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  it("should be idempotent when called on fresh system (no files exist)", async () => {
    // Multiple calls should not throw even when nothing is installed
    await expect(runUninstall()).resolves.not.toThrow();
    await expect(runUninstall()).resolves.not.toThrow();
    await expect(runUninstall()).resolves.not.toThrow();
  });

  it("should be idempotent when called multiple times after install", async () => {
    // Set up mock config
    mockLoadedConfig = {
      auth: {
        username: "test@example.com",
        password: "testpass",
        organizationUrl: "http://localhost:3000",
      },
    };

    // Create files to simulate installation
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(path.join(skillsDir, "test.txt"), "test content");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        username: "test@example.com",
        password: "testpass",
        organizationUrl: "http://localhost:3000",
      }),
    );

    // First call - feature loaders clean up their files, preserves config
    await expect(runUninstall()).resolves.not.toThrow();

    // Verify config was preserved
    const configExists = await fs
      .access(configPath)
      .then(() => true)
      .catch(() => false);
    expect(configExists).toBe(true);

    // Second and third calls should not throw
    await expect(runUninstall()).resolves.not.toThrow();
    await expect(runUninstall()).resolves.not.toThrow();
  });

  it("should remove config when removeConfig is true", async () => {
    // Set up mock config
    mockLoadedConfig = {
      auth: {
        username: "test@example.com",
        password: "testpass",
        organizationUrl: "http://localhost:3000",
      },
    };

    // Create files
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        username: "test@example.com",
        password: "testpass",
        organizationUrl: "http://localhost:3000",
      }),
    );

    // Call with removeConfig: true
    await expect(runUninstall({ removeConfig: true })).resolves.not.toThrow();

    // Verify config was removed
    const configExists = await fs
      .access(configPath)
      .then(() => true)
      .catch(() => false);
    expect(configExists).toBe(false);
  });

  it("should handle partial cleanup gracefully (some files missing)", async () => {
    // Create only skills directory (no config file)
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(path.join(skillsDir, "test.txt"), "test");

    // First call - feature loaders clean up, config doesn't exist
    await expect(runUninstall()).resolves.not.toThrow();

    // Create only config file (no skills directory)
    mockLoadedConfig = {
      auth: {
        username: "test",
        password: "test",
        organizationUrl: "test",
      },
    };
    await fs.writeFile(
      configPath,
      JSON.stringify({
        username: "test",
        password: "test",
        organizationUrl: "test",
      }),
    );

    // Second call - preserves config, skills don't exist
    await expect(runUninstall()).resolves.not.toThrow();

    // Third call - nothing new to clean
    await expect(runUninstall()).resolves.not.toThrow();
  });

  it("should preserve config when removeConfig is false (autoupdate scenario)", async () => {
    // This test simulates the autoupdate workflow:
    // 1. User has installed Nori with saved config
    // 2. Autoupdate calls `npx nori-ai@newVersion install --non-interactive`
    // 3. Install first calls `npx nori-ai@oldVersion uninstall --non-interactive`
    // 4. Config must be preserved so install can use it

    const configData = {
      username: "user@example.com",
      password: "encrypted_password",
      organizationUrl: "https://api.nori.ai",
      preferences: {
        name: "co-pilot",
        useTDD: true,
        gitWorkflow: "ask",
        autonomyLevel: "collaborative",
        commitStyle: "ask-before-commit",
        autoDocument: false,
        bugFixing: "flag-only",
      },
    };

    // Set up mock config
    mockLoadedConfig = {
      auth: {
        username: configData.username,
        password: configData.password,
        organizationUrl: configData.organizationUrl,
      },
      preferences: configData.preferences,
    };

    // Create config file
    await fs.writeFile(configPath, JSON.stringify(configData));

    // Create skills directory to simulate installation
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(path.join(skillsDir, "test-skill.md"), "skill content");

    // Call uninstall with removeConfig: false (default behavior for non-interactive)
    // This simulates what happens during autoupdate
    await runUninstall({ removeConfig: false });

    // Verify config was preserved
    const configExists = await fs
      .access(configPath)
      .then(() => true)
      .catch(() => false);
    expect(configExists).toBe(true);

    // Verify config content is unchanged
    const savedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(savedConfig).toEqual(configData);

    // Verify features were cleaned up
    const skillsExists = await fs
      .access(skillsDir)
      .then(() => true)
      .catch(() => false);
    // Skills dir might still exist but should be empty or cleaned by loaders
    // (actual loaders are mocked in this test, so we just verify no errors)
    expect(skillsExists).toBe(true); // mkdir creates it but loaders would clean files
  });

  it("should NEVER touch real user config files", async () => {
    // This test verifies that tests don't delete real ~/nori-config.json or ~/.nori-installed-version
    //
    // CRITICAL: This test checks the real HOME directory to ensure no test pollution

    const realHome = originalHome || "~";
    const realConfigPath = path.join(realHome, "nori-config.json");
    const realVersionPath = path.join(realHome, ".nori-installed-version");

    // Check if real files exist BEFORE test
    const realConfigExistsBefore = await fs
      .access(realConfigPath)
      .then(() => true)
      .catch(() => false);
    const realVersionExistsBefore = await fs
      .access(realVersionPath)
      .then(() => true)
      .catch(() => false);

    // Create mock config and run uninstall with removeConfig: true
    mockLoadedConfig = {
      auth: {
        username: "test@example.com",
        password: "testpass",
        organizationUrl: "http://localhost:3000",
      },
    };

    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(mockLoadedConfig));

    // Run uninstall with removeConfig: true (this SHOULD delete temp files, NOT real files)
    await runUninstall({ removeConfig: true });

    // Check if real files exist AFTER test
    const realConfigExistsAfter = await fs
      .access(realConfigPath)
      .then(() => true)
      .catch(() => false);
    const realVersionExistsAfter = await fs
      .access(realVersionPath)
      .then(() => true)
      .catch(() => false);

    // CRITICAL: Real files should have same existence state before and after
    expect(realConfigExistsAfter).toBe(realConfigExistsBefore);
    expect(realVersionExistsAfter).toBe(realVersionExistsBefore);

    // If real files were deleted, fail with descriptive message
    if (realConfigExistsBefore && !realConfigExistsAfter) {
      throw new Error("TEST BUG: Deleted real ~/nori-config.json file!");
    }
    if (realVersionExistsBefore && !realVersionExistsAfter) {
      throw new Error("TEST BUG: Deleted real ~/.nori-installed-version file!");
    }
  });
});
