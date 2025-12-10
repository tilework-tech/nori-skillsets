/**
 * Tests for install-cursor CLI command
 * Verifies that install-cursor executes all cursor loaders
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the env module to use temp directories
let mockCursorDir = "";

vi.mock("@/cli/env.js", () => ({
  getClaudeDir: (args: { installDir: string }) =>
    path.join(args.installDir, ".claude"),
  getClaudeSettingsFile: (args: { installDir: string }) =>
    path.join(args.installDir, ".claude", "settings.json"),
  getClaudeProfilesDir: (args: { installDir: string }) =>
    path.join(args.installDir, ".claude", "profiles"),
  getCursorDir: () => mockCursorDir,
  getCursorSettingsFile: () => path.join(mockCursorDir, "settings.json"),
  getCursorProfilesDir: () => path.join(mockCursorDir, "profiles"),
  getCursorHooksFile: () => path.join(mockCursorDir, "hooks.json"),
  MCP_ROOT: "/mock/mcp/root",
}));

import { installCursorMain } from "./installCursor.js";

describe("install-cursor command", () => {
  let tempDir: string;
  let cursorDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "install-cursor-test-"));
    cursorDir = path.join(tempDir, ".cursor");
    profilesDir = path.join(cursorDir, "profiles");

    // Set mock paths
    mockCursorDir = cursorDir;

    // Create directories
    await fs.mkdir(cursorDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  it("should execute cursor loaders and install profiles", async () => {
    await installCursorMain();

    // Verify profiles directory was created
    const profilesDirExists = await fs
      .access(profilesDir)
      .then(() => true)
      .catch(() => false);

    expect(profilesDirExists).toBe(true);
  });

  it("should install profile templates to cursor profiles directory", async () => {
    await installCursorMain();

    // Verify profile directories were copied
    const files = await fs.readdir(profilesDir);
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain("senior-swe");
  });

  it("should create settings.json with permissions", async () => {
    await installCursorMain();

    // Verify settings.json exists
    const settingsPath = path.join(cursorDir, "settings.json");
    const settingsExists = await fs
      .access(settingsPath)
      .then(() => true)
      .catch(() => false);

    expect(settingsExists).toBe(true);

    // Verify permissions are configured
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    expect(settings.permissions?.additionalDirectories).toContain(profilesDir);
  });
});
