import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { getConfigPath, saveConfig } from "@/cli/config.js";

import type * as versionModule from "@/cli/version.js";
import type * as firebaseAuth from "firebase/auth";

import { onboardMain, registerOnboardCommand } from "./onboard.js";

// Mock paths module to use test directory
vi.mock("@/cli/features/claude-code/paths.js", () => {
  const testClaudeDir = "/tmp/onboard-test-claude";
  const testNoriDir = "/tmp/onboard-test-nori";
  return {
    getClaudeDir: (_args: { installDir: string }) => testClaudeDir,
    getClaudeSettingsFile: (_args: { installDir: string }) =>
      `${testClaudeDir}/settings.json`,
    getClaudeHomeDir: () => testClaudeDir,
    getClaudeHomeSettingsFile: () => `${testClaudeDir}/settings.json`,
    getClaudeHomeCommandsDir: () => `${testClaudeDir}/commands`,
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
    getNoriDir: (_args: { installDir: string }) => testNoriDir,
    getNoriProfilesDir: (_args: { installDir: string }) =>
      `${testNoriDir}/profiles`,
    getNoriConfigFile: (_args: { installDir: string }) =>
      `${testNoriDir}/config.json`,
  };
});

// Mock getCurrentPackageVersion to return a controlled version for tests
vi.mock("@/cli/version.js", async (importOriginal) => {
  const actual = await importOriginal<typeof versionModule>();
  return {
    ...actual,
    getCurrentPackageVersion: vi.fn().mockReturnValue("20.0.0"),
  };
});

// Mock analytics to prevent tracking during tests
vi.mock("@/cli/analytics.js", () => ({
  initializeAnalytics: vi.fn(),
  trackEvent: vi.fn(),
}));

// Mock Firebase SDK to avoid hitting real Firebase API
vi.mock("firebase/auth", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof firebaseAuth;
  return {
    ...actual,
    signInWithEmailAndPassword: vi.fn().mockResolvedValue({
      user: {
        refreshToken: "mock-refresh-token",
      },
    }),
  };
});

// Mock Firebase provider
vi.mock("@/providers/firebase.js", () => ({
  configureFirebase: vi.fn(),
  getFirebase: vi.fn().mockReturnValue({
    auth: {},
    app: { options: { projectId: "test-project" } },
  }),
}));

// Mock promptUser
vi.mock("@/cli/prompt.js", () => ({
  promptUser: vi.fn(),
}));

describe("onboard command", () => {
  let tempDir: string;
  let originalCwd: () => string;

  const TEST_CLAUDE_DIR = "/tmp/onboard-test-claude";
  const TEST_NORI_DIR = "/tmp/onboard-test-nori";

  beforeEach(async () => {
    // Create temp directory
    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "onboard-test-"));

    // Mock process.cwd
    originalCwd = process.cwd;
    process.cwd = () => tempDir;

    // Clean up test directories
    try {
      fs.rmSync(TEST_CLAUDE_DIR, { recursive: true, force: true });
    } catch {}
    try {
      fs.rmSync(TEST_NORI_DIR, { recursive: true, force: true });
    } catch {}

    // Create fresh test directories
    fs.mkdirSync(TEST_CLAUDE_DIR, { recursive: true });
    fs.mkdirSync(TEST_NORI_DIR, { recursive: true });
    fs.mkdirSync(path.join(TEST_NORI_DIR, "profiles"), { recursive: true });

    // Create stub profiles (built-in profiles are no longer bundled)
    for (const profileName of ["senior-swe", "amol", "product-manager"]) {
      const profileDir = path.join(TEST_NORI_DIR, "profiles", profileName);
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(
        path.join(profileDir, "CLAUDE.md"),
        `# ${profileName}\n`,
      );
    }

    // Reset mocks
    vi.clearAllMocks();
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
      fs.rmSync(TEST_CLAUDE_DIR, { recursive: true, force: true });
    } catch {}
    try {
      fs.rmSync(TEST_NORI_DIR, { recursive: true, force: true });
    } catch {}
  });

  describe("onboardMain", () => {
    it("should require init to have been run (config must exist)", async () => {
      const CONFIG_PATH = getConfigPath({ installDir: tempDir });

      // Ensure no config exists
      try {
        fs.unlinkSync(CONFIG_PATH);
      } catch {}
      expect(fs.existsSync(CONFIG_PATH)).toBe(false);

      // Mock process.exit to capture exit
      const processExitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((code?: string | number | null) => {
          throw new Error(`process.exit(${code})`);
        }) as any;

      try {
        // Run onboard without init - should fail
        await expect(
          onboardMain({ installDir: tempDir, nonInteractive: true }),
        ).rejects.toThrow();
      } finally {
        processExitSpy.mockRestore();
      }
    });

    it("should update config with selected profile in non-interactive mode", async () => {
      const CONFIG_PATH = getConfigPath({ installDir: tempDir });

      // Create minimal config (as if init was run)
      await saveConfig({
        username: null,
        organizationUrl: null,
        agents: {},
        version: "20.0.0",
        installDir: tempDir,
      });

      // Run onboard with profile flag
      await onboardMain({
        installDir: tempDir,
        nonInteractive: true,
        profile: "senior-swe",
        agent: "claude-code",
      });

      // Verify config was updated with profile
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      expect(config.agents["claude-code"].profile).toEqual({
        baseProfile: "senior-swe",
      });
    });

    it("should require --profile flag in non-interactive mode when no profile exists", async () => {
      // Create minimal config without a profile (CONFIG_PATH not needed for this test)
      await saveConfig({
        username: null,
        organizationUrl: null,
        agents: {},
        version: "20.0.0",
        installDir: tempDir,
      });

      // Mock process.exit
      const processExitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((code?: string | number | null) => {
          throw new Error(`process.exit(${code})`);
        }) as any;

      try {
        // Run onboard without profile flag - should fail
        await expect(
          onboardMain({
            installDir: tempDir,
            nonInteractive: true,
            agent: "claude-code",
          }),
        ).rejects.toThrow("process.exit(1)");
      } finally {
        processExitSpy.mockRestore();
      }
    });

    it("should prompt for auth credentials in interactive mode", async () => {
      const CONFIG_PATH = getConfigPath({ installDir: tempDir });

      // Create minimal config
      await saveConfig({
        username: null,
        organizationUrl: null,
        agents: {},
        version: "20.0.0",
        installDir: tempDir,
      });

      // Mock user inputs
      const { promptUser } = await import("@/cli/prompt.js");
      vi.mocked(promptUser)
        .mockResolvedValueOnce("test@example.com") // Email
        .mockResolvedValueOnce("password123") // Password
        .mockResolvedValueOnce("myorg") // Org ID
        .mockResolvedValueOnce("1"); // Profile choice (first available)

      // Run onboard in interactive mode
      await onboardMain({
        installDir: tempDir,
        agent: "claude-code",
      });

      // Verify config was updated with auth
      // Note: onboard saves password, refresh token exchange happens in install's configLoader
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      expect(config.auth.username).toBe("test@example.com");
      expect(config.auth.organizationUrl).toBe("https://myorg.tilework.tech");
      // Password is stored (will be exchanged for token during install)
      expect(config.auth.password).toBe("password123");
    });

    it("should prompt for profile selection in interactive mode", async () => {
      const CONFIG_PATH = getConfigPath({ installDir: tempDir });

      // Create minimal config
      await saveConfig({
        username: null,
        organizationUrl: null,
        agents: {},
        version: "20.0.0",
        installDir: tempDir,
      });

      // Mock user inputs - skip auth, select profile
      const { promptUser } = await import("@/cli/prompt.js");
      vi.mocked(promptUser)
        .mockResolvedValueOnce("") // Skip email (free mode)
        .mockResolvedValueOnce("2"); // Select second profile

      // Run onboard in interactive mode
      await onboardMain({
        installDir: tempDir,
        agent: "claude-code",
      });

      // Verify config was updated with selected profile
      // Profiles are listed alphabetically: amol, product-manager, senior-swe
      // Selecting option 2 picks the second profile
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      expect(config.agents["claude-code"].profile.baseProfile).toBe(
        "product-manager",
      );
    });

    it("should select first profile when option 1 is chosen", async () => {
      const CONFIG_PATH = getConfigPath({ installDir: tempDir });

      // Create minimal config
      await saveConfig({
        username: null,
        organizationUrl: null,
        agents: {},
        version: "20.0.0",
        installDir: tempDir,
      });

      // Mock user inputs - skip auth, select first profile
      const { promptUser } = await import("@/cli/prompt.js");
      vi.mocked(promptUser)
        .mockResolvedValueOnce("") // Skip email
        .mockResolvedValueOnce("1"); // Select first profile

      // Run onboard in interactive mode
      await onboardMain({
        installDir: tempDir,
        agent: "claude-code",
      });

      // Verify config was updated with first profile (alphabetically: amol)
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      expect(config.agents["claude-code"].profile.baseProfile).toBe("amol");
    });
  });

  describe("registerOnboardCommand", () => {
    it("should register onboard command with commander", async () => {
      const { Command } = await import("commander");
      const program = new Command();

      registerOnboardCommand({ program });

      // Verify command was registered
      const onboardCmd = program.commands.find((c) => c.name() === "onboard");
      expect(onboardCmd).toBeDefined();
      expect(onboardCmd?.description()).toBe(
        "Select a profile and configure authentication",
      );
    });
  });
});
