import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { getConfigPath } from "@/cli/config.js";

import type * as versionModule from "@/cli/version.js";

import { initMain, registerInitCommand } from "./init.js";

// Mock paths module to use test directory
vi.mock("@/cli/features/claude-code/paths.js", () => {
  const testClaudeDir = "/tmp/init-test-claude";
  const testNoriDir = "/tmp/init-test-nori";
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

describe("init command", () => {
  let tempDir: string;
  let originalCwd: () => string;

  const TEST_CLAUDE_DIR = "/tmp/init-test-claude";
  const TEST_NORI_DIR = "/tmp/init-test-nori";

  beforeEach(async () => {
    // Create temp directory
    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "init-test-"));

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

  describe("initMain", () => {
    it("should create .nori-config.json with minimal structure on first run", async () => {
      const CONFIG_PATH = getConfigPath({ installDir: tempDir });

      // Ensure no existing config
      expect(fs.existsSync(CONFIG_PATH)).toBe(false);

      // Run init
      await initMain({ installDir: tempDir, nonInteractive: true });

      // Verify config was created
      expect(fs.existsSync(CONFIG_PATH)).toBe(true);

      // Verify config has minimal structure
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      expect(config.version).toBe("20.0.0");
      expect(config.agents).toEqual({});
      expect(config.installDir).toBe(tempDir);
    });

    it("should create ~/.nori/profiles/ directory", async () => {
      const profilesDir = path.join(TEST_NORI_DIR, "profiles");

      // Ensure profiles dir doesn't exist
      try {
        fs.rmSync(profilesDir, { recursive: true, force: true });
      } catch {}
      expect(fs.existsSync(profilesDir)).toBe(false);

      // Run init
      await initMain({ installDir: tempDir, nonInteractive: true });

      // Verify profiles directory was created
      expect(fs.existsSync(profilesDir)).toBe(true);
    });

    it("should be idempotent - not overwrite existing config", async () => {
      const CONFIG_PATH = getConfigPath({ installDir: tempDir });

      // Create existing config with custom data
      // Note: loadConfig requires auth to have username + organizationUrl for it to be recognized
      const existingConfig = {
        version: "19.0.0",
        agents: { "claude-code": { profile: { baseProfile: "amol" } } },
        auth: {
          username: "test@example.com",
          organizationUrl: "https://example.tilework.tech",
        },
        installDir: tempDir,
      };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(existingConfig, null, 2));

      // Run init
      await initMain({ installDir: tempDir, nonInteractive: true });

      // Verify existing config was preserved
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      expect(config.agents).toEqual({
        "claude-code": { profile: { baseProfile: "amol" } },
      });
      expect(config.auth.username).toBe("test@example.com");
      expect(config.auth.organizationUrl).toBe("https://example.tilework.tech");
      // Version should be updated to current
      expect(config.version).toBe("20.0.0");
    });

    it("should detect existing Claude Code config and capture as profile in interactive mode", async () => {
      // Create existing Claude Code config
      const claudeMdPath = path.join(TEST_CLAUDE_DIR, "CLAUDE.md");
      fs.writeFileSync(claudeMdPath, "# My Custom Config\n\nSome content");

      const skillsDir = path.join(TEST_CLAUDE_DIR, "skills");
      fs.mkdirSync(skillsDir, { recursive: true });
      fs.mkdirSync(path.join(skillsDir, "my-skill"));
      fs.writeFileSync(path.join(skillsDir, "my-skill", "SKILL.md"), "# Skill");

      // Mock promptUser to simulate user accepting capture with profile name
      const { promptUser } = await import("@/cli/prompt.js");
      vi.mocked(promptUser)
        .mockResolvedValueOnce("y") // Accept saving config
        .mockResolvedValueOnce("my-captured-profile"); // Profile name

      // Run init in interactive mode (default)
      await initMain({ installDir: tempDir });

      // Verify profile was captured
      const capturedProfileDir = path.join(
        TEST_NORI_DIR,
        "profiles",
        "my-captured-profile",
      );
      expect(fs.existsSync(capturedProfileDir)).toBe(true);
      expect(fs.existsSync(path.join(capturedProfileDir, "profile.json"))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(capturedProfileDir, "CLAUDE.md"))).toBe(
        true,
      );
      expect(
        fs.existsSync(path.join(capturedProfileDir, "skills", "my-skill")),
      ).toBe(true);

      // Verify .nori-config.json has the profile set
      const CONFIG_PATH = getConfigPath({ installDir: tempDir });
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      expect(config.agents).toEqual({
        "claude-code": { profile: { baseProfile: "my-captured-profile" } },
      });

      // Verify CLAUDE.md has the managed block
      const updatedClaudeMd = fs.readFileSync(claudeMdPath, "utf-8");
      expect(updatedClaudeMd).toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(updatedClaudeMd).toContain("# END NORI-AI MANAGED BLOCK");
    });

    it("should auto-capture existing config as my-profile in non-interactive mode", async () => {
      // Create existing Claude Code config
      const claudeMdPath = path.join(TEST_CLAUDE_DIR, "CLAUDE.md");
      fs.writeFileSync(claudeMdPath, "# My Custom Config\n\nSome content");

      const skillsDir = path.join(TEST_CLAUDE_DIR, "skills");
      fs.mkdirSync(skillsDir, { recursive: true });
      fs.mkdirSync(path.join(skillsDir, "my-skill"));
      fs.writeFileSync(path.join(skillsDir, "my-skill", "SKILL.md"), "# Skill");

      // Run init in non-interactive mode
      await initMain({ installDir: tempDir, nonInteractive: true });

      // Verify profile was captured as "my-profile"
      const capturedProfileDir = path.join(
        TEST_NORI_DIR,
        "profiles",
        "my-profile",
      );
      expect(fs.existsSync(capturedProfileDir)).toBe(true);
      expect(fs.existsSync(path.join(capturedProfileDir, "profile.json"))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(capturedProfileDir, "CLAUDE.md"))).toBe(
        true,
      );
      expect(
        fs.existsSync(path.join(capturedProfileDir, "skills", "my-skill")),
      ).toBe(true);

      // Verify .nori-config.json has the profile set
      const CONFIG_PATH = getConfigPath({ installDir: tempDir });
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      expect(config.agents).toEqual({
        "claude-code": { profile: { baseProfile: "my-profile" } },
      });

      // Verify CLAUDE.md has the managed block
      const updatedClaudeMd = fs.readFileSync(claudeMdPath, "utf-8");
      expect(updatedClaudeMd).toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(updatedClaudeMd).toContain("# END NORI-AI MANAGED BLOCK");
    });

    it("should warn about ancestor installations", async () => {
      // Create parent directory with nori installation
      const parentDir = path.join(tempDir, "parent");
      const childDir = path.join(parentDir, "child");
      fs.mkdirSync(childDir, { recursive: true });

      // Create nori config in parent
      fs.writeFileSync(
        path.join(parentDir, ".nori-config.json"),
        JSON.stringify({ version: "19.0.0" }),
      );

      // Capture console output
      const consoleOutput: Array<string> = [];
      const originalConsoleLog = console.log;
      console.log = (...args: Array<unknown>) => {
        consoleOutput.push(args.map(String).join(" "));
      };

      try {
        // Run init in child directory
        await initMain({
          installDir: path.join(childDir, ".claude"),
          nonInteractive: true,
        });

        // Verify warning was displayed
        const hasAncestorWarning = consoleOutput.some(
          (line) => line.includes("⚠️") && line.includes("ancestor"),
        );
        expect(hasAncestorWarning).toBe(true);
      } finally {
        console.log = originalConsoleLog;
      }
    });
  });

  describe("registerInitCommand", () => {
    it("should register init command with commander", async () => {
      const { Command } = await import("commander");
      const program = new Command();

      registerInitCommand({ program });

      // Verify command was registered
      const initCmd = program.commands.find((c) => c.name() === "init");
      expect(initCmd).toBeDefined();
      expect(initCmd?.description()).toBe(
        "Initialize Nori configuration and directories",
      );
    });
  });
});

// Mock promptUser
vi.mock("@/cli/prompt.js", () => ({
  promptUser: vi.fn().mockResolvedValue("n"),
}));
