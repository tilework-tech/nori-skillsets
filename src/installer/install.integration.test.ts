import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type * as childProcess from "child_process";

import { getConfigPath } from "./config.js";
import { main as installMain } from "./install.js";
import { runUninstall } from "./uninstall.js";
import { getInstalledVersion } from "./version.js";

// Store console output for testing warnings
let consoleOutput: Array<string> = [];
const originalConsoleLog = console.log;

// Track which version of npx uninstall was called
let uninstallCalledWith: string | null = null;

// Mock child_process to intercept npx calls
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return {
    ...actual,
    execSync: vi.fn((command: string, _options?: any) => {
      // Parse the command to extract version - match both 'npx' and 'npm exec'
      const match = command.match(
        /(?:npx|npm exec) nori-ai@([\d.]+) uninstall/,
      );
      if (match) {
        const version = match[1];
        uninstallCalledWith = version;

        // Simulate version-specific uninstall behavior
        // When uninstalling v12.0.0, remove the marker file
        if (version === "12.0.0") {
          try {
            // Compute marker path using current cwd (which will be mocked in tests)
            const markerPath = path.join(
              process.cwd(),
              ".nori-test-installation-marker",
            );
            fs.unlinkSync(markerPath);
          } catch {
            // Ignore if doesn't exist
          }
        }
        return;
      }

      // CRITICAL: Do NOT execute other commands for real during tests
      // This was causing tests to uninstall the actual user installation
      console.warn(`[TEST] Blocking real execSync call: ${command}`);
      return;
    }),
  };
});

// Mock env module to use test directory
vi.mock("./env.js", () => {
  const testRoot = "/tmp/install-integration-test-mcp-root";
  const testClaudeDir = "/tmp/install-integration-test-claude";
  return {
    MCP_ROOT: testRoot,
    getClaudeDir: (_args: { installDir: string }) => testClaudeDir,
    getClaudeSettingsFile: (_args: { installDir: string }) =>
      `${testClaudeDir}/settings.json`,
    getClaudeHomeDir: () => testClaudeDir,
    getClaudeHomeSettingsFile: () => `${testClaudeDir}/settings.json`,
    getClaudeAgentsDir: (_args: { installDir: string }) =>
      `${testClaudeDir}/agents`,
    getClaudeCommandsDir: (_args: { installDir: string }) =>
      `${testClaudeDir}/commands`,
    getClaudeMdFile: (_args: { installDir: string }) =>
      `${testClaudeDir}/CLAUDE.md`,
    getClaudeSkillsDir: (_args: { installDir: string }) =>
      `${testClaudeDir}/skills`,
    getClaudeProfilesDir: (_args: { installDir: string }) =>
      `${testClaudeDir}/profiles`,
  };
});

// Mock analytics to prevent tracking during tests
vi.mock("./analytics.js", () => ({
  initializeAnalytics: vi.fn(),
  trackEvent: vi.fn(),
}));

describe("install integration test", () => {
  let tempDir: string;
  let originalCwd: () => string;
  let VERSION_FILE_PATH: string;
  let MARKER_FILE_PATH: string;

  const TEST_MCP_ROOT = "/tmp/install-integration-test-mcp-root";
  const TEST_CLAUDE_DIR = "/tmp/install-integration-test-claude";

  beforeEach(async () => {
    // Create temp directory
    tempDir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), "install-test-cwd-"),
    );

    // Mock process.cwd
    originalCwd = process.cwd;
    process.cwd = () => tempDir;

    // Now paths point to temp dir (via cwd)
    VERSION_FILE_PATH = path.join(tempDir, ".nori-installed-version");
    MARKER_FILE_PATH = path.join(tempDir, ".nori-test-installation-marker");

    // Reset tracking variable
    uninstallCalledWith = null;

    // Clean up any existing files in temp dir
    try {
      fs.unlinkSync(VERSION_FILE_PATH);
    } catch {}
    try {
      fs.unlinkSync(MARKER_FILE_PATH);
    } catch {}

    // Create test directories
    if (!fs.existsSync(TEST_MCP_ROOT)) {
      fs.mkdirSync(TEST_MCP_ROOT, { recursive: true });
    }
    if (!fs.existsSync(TEST_CLAUDE_DIR)) {
      fs.mkdirSync(TEST_CLAUDE_DIR, { recursive: true });
    }

    // Create mock package.json for getCurrentPackageVersion
    fs.writeFileSync(
      path.join(TEST_MCP_ROOT, "package.json"),
      JSON.stringify({
        name: "nori-ai",
        version: "13.0.0",
      }),
    );
  });

  afterEach(async () => {
    // Restore cwd
    process.cwd = originalCwd;

    // Clean up temp directory
    try {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    } catch {}

    // Clean up test directories
    try {
      fs.rmSync(TEST_MCP_ROOT, { recursive: true, force: true });
    } catch {}
    try {
      fs.rmSync(TEST_CLAUDE_DIR, { recursive: true, force: true });
    } catch {}
  });

  it("should track version across installation upgrade flow", async () => {
    // STEP 1: Simulate existing installation at version 12.0.0
    // Write old version file
    fs.writeFileSync(VERSION_FILE_PATH, "12.0.0");
    // Create a marker file that simulates something from the old installation
    fs.writeFileSync(MARKER_FILE_PATH, "installed by v12.0.0");

    // Verify initial state
    expect(getInstalledVersion({ installDir: tempDir })).toBe("12.0.0");
    expect(fs.existsSync(MARKER_FILE_PATH)).toBe(true);

    // STEP 2: Run installation (simulating upgrade to 13.0.0)
    // This should:
    // 1. Read the previous version (12.0.0)
    // 2. Call uninstall with that version (which removes marker file)
    // 3. Install new version
    // 4. Save new version (13.0.0)
    await installMain({ nonInteractive: true, installDir: tempDir });

    // STEP 3: Verify upgrade behavior

    // CRITICAL: Verify that `npx nori-ai@12.0.0 uninstall` was called
    // This is the core requirement - we must uninstall at the OLD version
    expect(uninstallCalledWith).toBe("12.0.0");

    // Verify the marker file was removed by the version-specific uninstall
    expect(fs.existsSync(MARKER_FILE_PATH)).toBe(false);

    // Version file should be updated to new version
    expect(fs.existsSync(VERSION_FILE_PATH)).toBe(true);
    const newVersion = fs.readFileSync(VERSION_FILE_PATH, "utf-8");
    expect(newVersion).toBe("13.0.0");

    // getInstalledVersion should now return the new version
    expect(getInstalledVersion({ installDir: tempDir })).toBe("13.0.0");
  });

  it("should install paid features for paid users with auth credentials", async () => {
    const CONFIG_PATH = getConfigPath({ installDir: tempDir });

    // STEP 1: Create config with auth credentials (paid user)
    const paidConfig = {
      username: "test@example.com",
      password: "testpass",
      organizationUrl: "http://localhost:3000",
      profile: {
        baseProfile: "senior-swe",
      },
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(paidConfig, null, 2));

    // STEP 2: Run installation in non-interactive mode
    await installMain({ nonInteractive: true, installDir: tempDir });

    // STEP 3: Verify paid features are installed
    // Check that paid skills exist in the profile (WITH 'paid-' prefix from mixin)
    const profileDir = path.join(TEST_CLAUDE_DIR, "profiles", "senior-swe");
    const skillsDir = path.join(profileDir, "skills");

    // Paid skills are copied from mixin with their original names (paid- prefix)
    expect(fs.existsSync(path.join(skillsDir, "paid-recall"))).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, "paid-memorize"))).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, "paid-write-noridoc"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(skillsDir, "paid-read-noridoc"))).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, "paid-list-noridocs"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(skillsDir, "paid-prompt-analysis"))).toBe(
      true,
    );

    // Check that paid subagents exist (as .md files)
    const subagentsDir = path.join(profileDir, "subagents");
    expect(
      fs.existsSync(path.join(subagentsDir, "nori-knowledge-researcher.md")),
    ).toBe(true);

    // Clean up
    try {
      fs.unlinkSync(CONFIG_PATH);
    } catch {}
  });

  it("should NOT install paid features for free users without auth credentials", async () => {
    const CONFIG_PATH = getConfigPath({ installDir: tempDir });

    // STEP 1: Create config WITHOUT auth credentials (free user)
    const freeConfig = {
      profile: {
        baseProfile: "senior-swe",
      },
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(freeConfig, null, 2));

    // STEP 2: Run installation in non-interactive mode
    await installMain({ nonInteractive: true, installDir: tempDir });

    // STEP 3: Verify paid features are NOT installed
    const profileDir = path.join(TEST_CLAUDE_DIR, "profiles", "senior-swe");
    const skillsDir = path.join(profileDir, "skills");

    // Paid skills should NOT exist for free users (check with paid- prefix)
    expect(fs.existsSync(path.join(skillsDir, "paid-recall"))).toBe(false);
    expect(fs.existsSync(path.join(skillsDir, "paid-memorize"))).toBe(false);
    expect(fs.existsSync(path.join(skillsDir, "paid-write-noridoc"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(skillsDir, "paid-read-noridoc"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(skillsDir, "paid-list-noridocs"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(skillsDir, "paid-prompt-analysis"))).toBe(
      false,
    );

    // Paid subagents should NOT exist
    const subagentsDir = path.join(profileDir, "subagents");
    expect(
      fs.existsSync(path.join(subagentsDir, "nori-knowledge-researcher.md")),
    ).toBe(false);

    // Clean up
    try {
      fs.unlinkSync(CONFIG_PATH);
    } catch {}
  });

  it("should skip uninstall for first-time installation", async () => {
    // Ensure no existing installation
    expect(fs.existsSync(VERSION_FILE_PATH)).toBe(false);
    const CONFIG_PATH = getConfigPath({ installDir: tempDir });
    try {
      fs.unlinkSync(CONFIG_PATH);
    } catch {}

    // Run installation
    await installMain({ nonInteractive: true, installDir: tempDir });

    // Verify uninstall was NOT called
    expect(uninstallCalledWith).toBeNull();

    // Verify installation completed and version was saved
    expect(fs.existsSync(VERSION_FILE_PATH)).toBe(true);
    const version = fs.readFileSync(VERSION_FILE_PATH, "utf-8");
    expect(version).toBe("13.0.0");
  });

  it("should skip uninstall when skipUninstall is true", async () => {
    // STEP 1: Simulate existing installation at version 12.0.0
    fs.writeFileSync(VERSION_FILE_PATH, "12.0.0");
    fs.writeFileSync(MARKER_FILE_PATH, "installed by v12.0.0");

    // Verify initial state
    expect(getInstalledVersion({ installDir: tempDir })).toBe("12.0.0");
    expect(fs.existsSync(MARKER_FILE_PATH)).toBe(true);

    // STEP 2: Run installation with skipUninstall=true
    await installMain({
      nonInteractive: true,
      skipUninstall: true,
      installDir: tempDir,
    });

    // STEP 3: Verify uninstall was NOT called
    expect(uninstallCalledWith).toBeNull();

    // Verify the marker file still exists (wasn't removed by uninstall)
    expect(fs.existsSync(MARKER_FILE_PATH)).toBe(true);

    // Version file should be updated to new version
    expect(fs.existsSync(VERSION_FILE_PATH)).toBe(true);
    const newVersion = fs.readFileSync(VERSION_FILE_PATH, "utf-8");
    expect(newVersion).toBe("13.0.0");
  });

  it("should completely clean up all Nori files after uninstall", async () => {
    const CONFIG_PATH = getConfigPath({ installDir: tempDir });

    // Helper to recursively get all files/dirs in a directory
    const getDirectorySnapshot = (dir: string): Array<string> => {
      const results: Array<string> = [];
      if (!fs.existsSync(dir)) return results;

      const walk = (currentPath: string) => {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);
          const relativePath = path.relative(dir, fullPath);
          results.push(relativePath);
          if (entry.isDirectory()) {
            walk(fullPath);
          }
        }
      };
      walk(dir);
      return results.sort();
    };

    // STEP 1: Snapshot state BEFORE install
    const preInstallClaudeSnapshot = getDirectorySnapshot(TEST_CLAUDE_DIR);
    const preInstallCwdSnapshot = getDirectorySnapshot(tempDir);

    // STEP 2: Install with paid config to get all features
    const paidConfig = {
      username: "test@example.com",
      password: "testpass",
      organizationUrl: "http://localhost:3000",
      profile: {
        baseProfile: "senior-swe",
      },
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(paidConfig, null, 2));

    await installMain({ nonInteractive: true, installDir: tempDir });

    // STEP 3: Verify installation actually created files
    const postInstallClaudeSnapshot = getDirectorySnapshot(TEST_CLAUDE_DIR);
    const postInstallCwdSnapshot = getDirectorySnapshot(tempDir);

    // Installation should have added files
    expect(postInstallClaudeSnapshot.length).toBeGreaterThan(
      preInstallClaudeSnapshot.length,
    );
    expect(postInstallCwdSnapshot.length).toBeGreaterThan(
      preInstallCwdSnapshot.length,
    );

    // Verify some expected files exist (sanity check)
    expect(postInstallClaudeSnapshot.some((f) => f.includes("agents"))).toBe(
      true,
    );
    expect(postInstallClaudeSnapshot.some((f) => f.includes("commands"))).toBe(
      true,
    );
    expect(postInstallClaudeSnapshot.some((f) => f.includes("profiles"))).toBe(
      true,
    );
    expect(postInstallClaudeSnapshot.some((f) => f.includes("skills"))).toBe(
      true,
    );

    // Create notifications log to test cleanup
    const notificationsLog = path.join(tempDir, ".nori-notifications.log");
    fs.writeFileSync(notificationsLog, "test notification log");

    // STEP 4: Run uninstall with removeConfig=true (user-initiated uninstall)
    await runUninstall({
      removeConfig: true,
      removeHooksAndStatusline: true,
      installDir: tempDir,
    });

    // STEP 5: Snapshot state AFTER uninstall
    const postUninstallClaudeSnapshot = getDirectorySnapshot(TEST_CLAUDE_DIR);
    const postUninstallCwdSnapshot = getDirectorySnapshot(tempDir);

    // STEP 6: Compare snapshots - state should match pre-install
    // Note: settings.json may remain as it's a shared Claude Code file,
    // but it should be empty or only contain schema after cleanup
    const allowedRemnants = ["settings.json"];
    const filteredPostUninstall = postUninstallClaudeSnapshot.filter(
      (f) => !allowedRemnants.includes(f),
    );

    // Claude directory should be back to pre-install state (except allowed remnants)
    expect(filteredPostUninstall).toEqual(preInstallClaudeSnapshot);

    // If settings.json remains, verify it has no Nori content
    const settingsPath = path.join(TEST_CLAUDE_DIR, "settings.json");
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      // Should not have hooks (removed by hooks loader)
      expect(settings.hooks).toBeUndefined();
      // Should not have Nori-specific permissions
      if (settings.permissions?.additionalDirectories) {
        const noriDirs = settings.permissions.additionalDirectories.filter(
          (d: string) => d.includes("skills") || d.includes("profiles"),
        );
        expect(noriDirs.length).toBe(0);
      }
    }

    // Cwd directory should be back to pre-install state
    // (no config file, no version file, no notifications log)
    expect(postUninstallCwdSnapshot).toEqual(preInstallCwdSnapshot);
  });

  it("should warn when ancestor directory has nori installation", async () => {
    // Setup: Create a parent directory with a nori installation
    const parentDir = path.join(tempDir, "parent");
    const childDir = path.join(parentDir, "child");
    fs.mkdirSync(childDir, { recursive: true });

    // Create nori config in parent (simulating existing installation)
    fs.writeFileSync(
      path.join(parentDir, ".nori-config.json"),
      JSON.stringify({ profile: { baseProfile: "test" } }),
    );

    // Capture console output
    consoleOutput = [];
    console.log = (...args: Array<unknown>) => {
      consoleOutput.push(args.map(String).join(" "));
      originalConsoleLog(...args);
    };

    try {
      // Run installation in the child directory
      await installMain({
        nonInteractive: true,
        installDir: path.join(childDir, ".claude"),
      });

      // Verify warning was displayed about ancestor installation
      // The warning message contains ⚠️ and "ancestor"
      const hasAncestorWarning = consoleOutput.some(
        (line) => line.includes("⚠️") && line.includes("ancestor"),
      );
      expect(hasAncestorWarning).toBe(true);

      // Verify the parent path is shown
      const hasParentPath = consoleOutput.some((line) =>
        line.includes(parentDir),
      );
      expect(hasParentPath).toBe(true);

      // Verify uninstall instructions were provided
      const hasUninstallInstructions = consoleOutput.some(
        (line) =>
          line.includes("npx nori-ai@latest uninstall") ||
          line.includes("nori-ai uninstall"),
      );
      expect(hasUninstallInstructions).toBe(true);

      // Verify installation still proceeded (in non-interactive mode)
      // Note: Due to the mocked env.js, files are created in TEST_CLAUDE_DIR
      // not in childDir/.claude, but the ancestor detection uses normalizeInstallDir
      // which correctly identifies the parent installation
      const TEST_CLAUDE_DIR = "/tmp/install-integration-test-claude";
      expect(fs.existsSync(path.join(TEST_CLAUDE_DIR, "settings.json"))).toBe(
        true,
      );
    } finally {
      // Restore console
      console.log = originalConsoleLog;
    }
  });
});
