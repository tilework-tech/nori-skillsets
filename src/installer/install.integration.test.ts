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
            // Compute marker path using current HOME (which will be mocked in tests)
            const markerPath = path.join(
              process.env.HOME || "~",
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
  return {
    MCP_ROOT: testRoot,
    CLAUDE_DIR: "/tmp/install-integration-test-claude",
    CLAUDE_SETTINGS_FILE: "/tmp/install-integration-test-claude/settings.json",
    CLAUDE_AGENTS_DIR: "/tmp/install-integration-test-claude/agents",
    CLAUDE_COMMANDS_DIR: "/tmp/install-integration-test-claude/commands",
    CLAUDE_MD_FILE: "/tmp/install-integration-test-claude/CLAUDE.md",
    CLAUDE_SKILLS_DIR: "/tmp/install-integration-test-claude/skills",
    CLAUDE_PROFILES_DIR: "/tmp/install-integration-test-claude/profiles",
  };
});

// Mock analytics to prevent tracking during tests
vi.mock("./analytics.js", () => ({
  initializeAnalytics: vi.fn(),
  trackEvent: vi.fn(),
}));

describe("install integration test", () => {
  let tempHomeDir: string;
  let originalHome: string | undefined;
  let VERSION_FILE_PATH: string;
  let MARKER_FILE_PATH: string;

  const TEST_MCP_ROOT = "/tmp/install-integration-test-mcp-root";
  const TEST_CLAUDE_DIR = "/tmp/install-integration-test-claude";

  beforeEach(async () => {
    // Create temp HOME directory
    tempHomeDir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), "install-test-home-"),
    );

    // Mock HOME environment variable
    originalHome = process.env.HOME;
    process.env.HOME = tempHomeDir;

    // Now paths point to temp HOME
    VERSION_FILE_PATH = path.join(tempHomeDir, ".nori-installed-version");
    MARKER_FILE_PATH = path.join(tempHomeDir, ".nori-test-installation-marker");

    // Reset tracking variable
    uninstallCalledWith = null;

    // Clean up any existing files in temp HOME
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
    // Restore HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Clean up temp HOME directory
    try {
      await fsPromises.rm(tempHomeDir, { recursive: true, force: true });
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
    expect(getInstalledVersion()).toBe("12.0.0");
    expect(fs.existsSync(MARKER_FILE_PATH)).toBe(true);

    // STEP 2: Run installation (simulating upgrade to 13.0.0)
    // This should:
    // 1. Read the previous version (12.0.0)
    // 2. Call uninstall with that version (which removes marker file)
    // 3. Install new version
    // 4. Save new version (13.0.0)
    await installMain({ nonInteractive: true });

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
    expect(getInstalledVersion()).toBe("13.0.0");
  });

  it("should install paid features for paid users with auth credentials", async () => {
    const CONFIG_PATH = getConfigPath();

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
    await installMain({ nonInteractive: true });

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
    const CONFIG_PATH = getConfigPath();

    // STEP 1: Create config WITHOUT auth credentials (free user)
    const freeConfig = {
      profile: {
        baseProfile: "senior-swe",
      },
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(freeConfig, null, 2));

    // STEP 2: Run installation in non-interactive mode
    await installMain({ nonInteractive: true });

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
    const CONFIG_PATH = getConfigPath();
    try {
      fs.unlinkSync(CONFIG_PATH);
    } catch {}

    // Run installation
    await installMain({ nonInteractive: true });

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
    expect(getInstalledVersion()).toBe("12.0.0");
    expect(fs.existsSync(MARKER_FILE_PATH)).toBe(true);

    // STEP 2: Run installation with skipUninstall=true
    await installMain({ nonInteractive: true, skipUninstall: true });

    // STEP 3: Verify uninstall was NOT called
    expect(uninstallCalledWith).toBeNull();

    // Verify the marker file still exists (wasn't removed by uninstall)
    expect(fs.existsSync(MARKER_FILE_PATH)).toBe(true);

    // Version file should be updated to new version
    expect(fs.existsSync(VERSION_FILE_PATH)).toBe(true);
    const newVersion = fs.readFileSync(VERSION_FILE_PATH, "utf-8");
    expect(newVersion).toBe("13.0.0");
  });

  it("should never delete real user config file", () => {
    // This test verifies that process.env.HOME is mocked and tests never touch the real config file
    // Get what the real config path WOULD be (using originalHome from beforeEach)
    const realConfigPath = path.join(originalHome || "~", "nori-config.json");

    // Check if real config exists before test
    let existedBefore = false;
    try {
      fs.accessSync(realConfigPath);
      existedBefore = true;
    } catch {
      // File doesn't exist, which is fine
    }

    // Get the config path used by tests (should be in temp dir)
    const testConfigPath = getConfigPath();

    // Verify that test config path is NOT the real config path
    // This proves HOME is mocked to a temp directory
    expect(testConfigPath).not.toBe(realConfigPath);

    // Verify the test HOME is actually different from real HOME
    // (We expect process.env.HOME to be a temp directory like /tmp/install-test-home-XXXXXX)
    expect(process.env.HOME).toContain("/tmp/");
    expect(process.env.HOME).toContain("install-test-home-");

    // Verify real config still exists (if it existed before)
    if (existedBefore) {
      let existsAfter = false;
      try {
        fs.accessSync(realConfigPath);
        existsAfter = true;
      } catch {
        // File was deleted!
      }
      expect(existsAfter).toBe(true);
    }
  });

  it("should completely clean up all Nori files after uninstall", async () => {
    const CONFIG_PATH = getConfigPath();

    // STEP 1: Install with paid config to get all features
    const paidConfig = {
      username: "test@example.com",
      password: "testpass",
      organizationUrl: "http://localhost:3000",
      profile: {
        baseProfile: "senior-swe",
      },
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(paidConfig, null, 2));

    await installMain({ nonInteractive: true });

    // STEP 2: Verify installation created expected directories and files
    const agentsDir = path.join(TEST_CLAUDE_DIR, "agents");
    const commandsDir = path.join(TEST_CLAUDE_DIR, "commands");
    const profilesDir = path.join(TEST_CLAUDE_DIR, "profiles");
    const skillsDir = path.join(TEST_CLAUDE_DIR, "skills");
    const claudeMdFile = path.join(TEST_CLAUDE_DIR, "CLAUDE.md");
    const settingsFile = path.join(TEST_CLAUDE_DIR, "settings.json");

    // Verify directories were created
    expect(fs.existsSync(agentsDir)).toBe(true);
    expect(fs.existsSync(commandsDir)).toBe(true);
    expect(fs.existsSync(profilesDir)).toBe(true);
    expect(fs.existsSync(skillsDir)).toBe(true);
    expect(fs.existsSync(claudeMdFile)).toBe(true);
    expect(fs.existsSync(settingsFile)).toBe(true);

    // Verify files exist in agents directory
    const agentFiles = fs.readdirSync(agentsDir);
    expect(agentFiles.length).toBeGreaterThan(0);
    expect(agentFiles.some((f) => f.startsWith("nori-"))).toBe(true);

    // Verify files exist in commands directory
    const commandFiles = fs.readdirSync(commandsDir);
    expect(commandFiles.length).toBeGreaterThan(0);

    // Verify version file was created
    expect(fs.existsSync(VERSION_FILE_PATH)).toBe(true);

    // Create notifications log to test cleanup
    const notificationsLog = path.join(tempHomeDir, ".nori-notifications.log");
    fs.writeFileSync(notificationsLog, "test notification log");
    expect(fs.existsSync(notificationsLog)).toBe(true);

    // STEP 3: Run uninstall with removeConfig=true (user-initiated uninstall)
    await runUninstall({ removeConfig: true });

    // STEP 4: Verify COMPLETE cleanup

    // All Nori agent files should be removed
    if (fs.existsSync(agentsDir)) {
      const remainingAgents = fs.readdirSync(agentsDir);
      const noriAgents = remainingAgents.filter((f) => f.startsWith("nori-"));
      expect(noriAgents.length).toBe(0);
    }

    // All Nori command files should be removed
    if (fs.existsSync(commandsDir)) {
      const remainingCommands = fs.readdirSync(commandsDir);
      const noriCommands = remainingCommands.filter((f) => f.endsWith(".md"));
      expect(noriCommands.length).toBe(0);
    }

    // Empty directories should be removed
    expect(fs.existsSync(agentsDir)).toBe(false);
    expect(fs.existsSync(commandsDir)).toBe(false);
    expect(fs.existsSync(profilesDir)).toBe(false);

    // Skills directory should be removed
    expect(fs.existsSync(skillsDir)).toBe(false);

    // Notifications log should be removed
    expect(fs.existsSync(notificationsLog)).toBe(false);

    // Config file should be removed (removeConfig=true)
    expect(fs.existsSync(CONFIG_PATH)).toBe(false);

    // Version file should be removed
    expect(fs.existsSync(VERSION_FILE_PATH)).toBe(false);

    // CLAUDE.md should be removed or have no Nori content
    // (in this test, the managed block removal would make it empty, so it gets deleted)
    if (fs.existsSync(claudeMdFile)) {
      const content = fs.readFileSync(claudeMdFile, "utf-8");
      expect(content).not.toContain("NORI-AI MANAGED BLOCK");
    }

    // Settings.json may still exist but should not have Nori hooks
    if (fs.existsSync(settingsFile)) {
      const settings = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
      expect(settings.hooks).toBeUndefined();
    }
  });
});
