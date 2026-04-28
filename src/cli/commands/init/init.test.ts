import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";

import * as clack from "@clack/prompts";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { getConfigPath } from "@/cli/config.js";

import { initMain, registerInitCommand } from "./init.js";

// Mock os.homedir so getConfigPath resolves to test directories
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

// Mock paths module to use test directory
vi.mock("@/cli/features/claude-code/paths.js", () => {
  const testClaudeDir = "/tmp/init-test-claude";
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
    getClaudeSkillsetsDir: (_args: { installDir: string }) =>
      `${testClaudeDir}/profiles`,
  };
});

vi.mock("@/norijson/skillset.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const testNoriDir = "/tmp/init-test-nori";
  return {
    ...actual,
    getNoriDir: () => testNoriDir,
    getNoriSkillsetsDir: () => `${testNoriDir}/profiles`,
  };
});

// Mock @clack/prompts for output assertions
vi.mock("@clack/prompts", () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
    message: vi.fn(),
  },
  note: vi.fn(),
  intro: vi.fn(),
  outro: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: "",
  })),
  confirm: vi.fn(),
  text: vi.fn(),
  select: vi.fn(),
  isCancel: vi.fn(),
}));

// Mock logger — suppress transitive logger output, color helpers passthrough
vi.mock("@/cli/logger.js", () => ({
  debug: vi.fn(),
  setSilentMode: vi.fn(),
  isSilentMode: vi.fn(),
  // Legacy UI functions — not used by init.ts but needed by transitive deps
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  newline: vi.fn(),
  raw: vi.fn(),
  // Color helpers — passthrough for readable assertions
  bold: (args: { text: string }) => args.text,
  yellow: (args: { text: string }) => args.text,
}));

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

    // Mock os.homedir to return temp directory
    vi.mocked(os.homedir).mockReturnValue(tempDir);

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
      const CONFIG_PATH = getConfigPath();

      // Ensure no existing config
      expect(fs.existsSync(CONFIG_PATH)).toBe(false);

      // Run init
      await initMain({ installDir: tempDir, nonInteractive: true });

      // Verify config was created
      expect(fs.existsSync(CONFIG_PATH)).toBe(true);

      // Verify config has minimal structure and does not persist version
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      expect("version" in config).toBe(false);
      expect(config.activeSkillset).toBeUndefined();
      expect(config.installDir).toBe(tempDir);
    });

    it("should create ~/.nori/profiles/ directory", async () => {
      const skillsetsDir = path.join(TEST_NORI_DIR, "profiles");

      // Ensure profiles dir doesn't exist
      try {
        fs.rmSync(skillsetsDir, { recursive: true, force: true });
      } catch {}
      expect(fs.existsSync(skillsetsDir)).toBe(false);

      // Run init
      await initMain({ installDir: tempDir, nonInteractive: true });

      // Verify profiles directory was created
      expect(fs.existsSync(skillsetsDir)).toBe(true);
    });

    it("should be idempotent - not overwrite existing config", async () => {
      const CONFIG_PATH = getConfigPath();

      // Create existing config with custom data, including a stale `version`
      // field from older installs. The field should be stripped on next save.
      const existingConfig = {
        version: "19.0.0",
        activeSkillset: "amol",
        auth: {
          username: "test@example.com",
          organizationUrl: "https://example.tilework.tech",
        },
        installDir: tempDir,
      };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(existingConfig, null, 2));

      // Run init
      await initMain({ installDir: tempDir, nonInteractive: true });

      // Verify existing config was preserved and stale version was stripped
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      expect(config.activeSkillset).toBe("amol");
      expect(config.auth.username).toBe("test@example.com");
      expect(config.auth.organizationUrl).toBe("https://example.tilework.tech");
      expect("version" in config).toBe(false);
    });

    it("should preserve organizations, isAdmin, and transcriptDestination from existing config", async () => {
      const CONFIG_PATH = getConfigPath();

      // Create existing config with organizations, isAdmin, and transcriptDestination
      const existingConfig = {
        activeSkillset: "senior-swe",
        auth: {
          username: "test@example.com",
          organizationUrl: "https://example.tilework.tech",
          refreshToken: "test-refresh-token",
          organizations: ["org-one", "org-two"],
          isAdmin: true,
        },
        transcriptDestination: "myorg",
        installDir: tempDir,
      };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(existingConfig, null, 2));

      // Run init
      await initMain({ installDir: tempDir, nonInteractive: true });

      // Verify organizations, isAdmin, and transcriptDestination are preserved
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      expect(config.auth.organizations).toEqual(["org-one", "org-two"]);
      expect(config.auth.isAdmin).toBe(true);
      expect(config.transcriptDestination).toBe("myorg");
    });

    it("should auto-capture existing config as my-profile in non-interactive mode", async () => {
      // Create existing Claude Code config at the real install dir path
      // (agentOperations uses agent.getInstructionsFilePath which resolves to installDir/.claude/CLAUDE.md)
      const realClaudeDir = path.join(tempDir, ".claude");
      fs.mkdirSync(realClaudeDir, { recursive: true });
      const claudeMdPath = path.join(realClaudeDir, "CLAUDE.md");
      fs.writeFileSync(claudeMdPath, "# My Custom Config\n\nSome content");

      const skillsDir = path.join(realClaudeDir, "skills");
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
      expect(fs.existsSync(path.join(capturedProfileDir, "nori.json"))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(capturedProfileDir, "AGENTS.md"))).toBe(
        true,
      );
      expect(
        fs.existsSync(path.join(capturedProfileDir, "skills", "my-skill")),
      ).toBe(true);

      // Verify .nori-config.json has the profile set
      const CONFIG_PATH = getConfigPath();
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      expect(config.activeSkillset).toBe("my-profile");

      // Verify CLAUDE.md has the managed block
      const updatedClaudeMd = fs.readFileSync(claudeMdPath, "utf-8");
      expect(updatedClaudeMd).toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(updatedClaudeMd).toContain("# END NORI-AI MANAGED BLOCK");

      // Verify success message was shown via clack
      expect(clack.log.success).toHaveBeenCalledWith(
        expect.stringContaining("my-profile"),
      );
    });

    it("should not produce double-nested managed block markers when capturing existing config", async () => {
      // Create existing CLAUDE.md at the real install dir path
      const realClaudeDir = path.join(tempDir, ".claude");
      fs.mkdirSync(realClaudeDir, { recursive: true });
      const claudeMdPath = path.join(realClaudeDir, "CLAUDE.md");
      fs.writeFileSync(claudeMdPath, "hello");

      // Run init in non-interactive mode (which captures config and installs managed block)
      await initMain({ installDir: tempDir, nonInteractive: true });

      // Read the resulting CLAUDE.md
      const resultContent = fs.readFileSync(claudeMdPath, "utf-8");

      // Should have exactly ONE BEGIN and ONE END marker (not nested/doubled)
      const beginCount = (
        resultContent.match(/# BEGIN NORI-AI MANAGED BLOCK/g) || []
      ).length;
      const endCount = (
        resultContent.match(/# END NORI-AI MANAGED BLOCK/g) || []
      ).length;

      expect(beginCount).toBe(1);
      expect(endCount).toBe(1);

      // Content should be properly wrapped with the original content inside
      expect(resultContent).toContain("hello");
    });

    it("should not duplicate content outside the managed block when capturing existing config", async () => {
      // This test reproduces the bug where running seaweed init on a directory
      // with existing CLAUDE.md content results in the content being duplicated:
      // once outside the managed block and once inside.
      //
      // Expected: # BEGIN NORI-AI MANAGED BLOCK\nhello\n# END NORI-AI MANAGED BLOCK
      // Bug:      hello\n\n# BEGIN NORI-AI MANAGED BLOCK\nhello\n# END NORI-AI MANAGED BLOCK

      const realClaudeDir = path.join(tempDir, ".claude");
      fs.mkdirSync(realClaudeDir, { recursive: true });
      const claudeMdPath = path.join(realClaudeDir, "CLAUDE.md");
      fs.writeFileSync(claudeMdPath, "hello");

      // Run init in non-interactive mode
      await initMain({ installDir: tempDir, nonInteractive: true });

      // Read the resulting CLAUDE.md
      const resultContent = fs.readFileSync(claudeMdPath, "utf-8");

      // Count occurrences of "hello" - should appear exactly ONCE (inside the managed block)
      const helloCount = (resultContent.match(/hello/g) || []).length;
      expect(helloCount).toBe(1);

      // The file should START with the managed block marker (no content before it)
      // Allow for optional leading newline
      expect(
        resultContent.trimStart().startsWith("# BEGIN NORI-AI MANAGED BLOCK"),
      ).toBe(true);
    });

    it("should skip existing-config detection when .nori-managed marker exists", async () => {
      // Create .nori-managed marker at the REAL install dir path (not mocked claude dir)
      // because isInstalledAtDir uses path.join(installDir, ".claude") directly
      const realClaudeDir = path.join(tempDir, ".claude");
      fs.mkdirSync(realClaudeDir, { recursive: true });
      fs.writeFileSync(path.join(realClaudeDir, ".nori-managed"), "senior-swe");

      // Also create some existing config in the MOCKED claude dir that would normally trigger capture
      fs.writeFileSync(
        path.join(TEST_CLAUDE_DIR, "CLAUDE.md"),
        "# My Custom Config\n\nSome content",
      );
      const skillsDir = path.join(TEST_CLAUDE_DIR, "skills");
      fs.mkdirSync(skillsDir, { recursive: true });
      fs.mkdirSync(path.join(skillsDir, "my-skill"));
      fs.writeFileSync(path.join(skillsDir, "my-skill", "SKILL.md"), "# Skill");

      await initMain({ installDir: tempDir, nonInteractive: true });

      // Verify that NO profile was captured (config should not have a profile set)
      const CONFIG_PATH = getConfigPath();
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      expect(config.activeSkillset).toBeUndefined();
    });

    it("should create .nori-managed marker after init with captured profile", async () => {
      // Create existing Claude Code config at the real install dir path to trigger capture
      const realClaudeDir = path.join(tempDir, ".claude");
      fs.mkdirSync(realClaudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(realClaudeDir, "CLAUDE.md"),
        "# My Custom Config\n\nSome content",
      );

      await initMain({ installDir: tempDir, nonInteractive: true });

      // Verify .nori-managed marker was created at the real install dir
      // markInstall uses path.join(installDir, ".claude") directly
      const markerPath = path.join(tempDir, ".claude", ".nori-managed");
      expect(fs.existsSync(markerPath)).toBe(true);
      expect(fs.readFileSync(markerPath, "utf-8")).toBe("my-profile");
    });

    it("should create .nori-managed marker after init without captured profile", async () => {
      // No existing config - just a plain init
      await initMain({ installDir: tempDir, nonInteractive: true });

      // Verify .nori-managed marker was created at the real install dir
      const markerPath = path.join(tempDir, ".claude", ".nori-managed");
      expect(fs.existsSync(markerPath)).toBe(true);
      expect(fs.readFileSync(markerPath, "utf-8")).toBe("");
    });

    it("should write skillset name to .nori-managed when skillset param is provided", async () => {
      const CONFIG_PATH = getConfigPath();

      // Create existing config (simulates switch scenario where config already exists)
      const existingConfig = {
        activeSkillset: "old-skillset",
        auth: {
          username: "test@example.com",
          organizationUrl: "https://example.tilework.tech",
        },
        installDir: tempDir,
      };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(existingConfig, null, 2));

      // Run init with skillset param (as happens during switch)
      await initMain({
        installDir: tempDir,
        nonInteractive: true,
        skillset: "senior-swe",
      });

      // Verify .nori-managed contains the skillset name, not empty string
      const markerPath = path.join(tempDir, ".claude", ".nori-managed");
      expect(fs.existsSync(markerPath)).toBe(true);
      expect(fs.readFileSync(markerPath, "utf-8")).toBe("senior-swe");
    });
  });

  describe("installDir persistence", () => {
    it("should not overwrite config installDir when called with a different installDir", async () => {
      const CONFIG_PATH = getConfigPath();
      const originalInstallDir = "/original/install/path";

      // Create existing config with a specific installDir
      const existingConfig = {
        activeSkillset: "amol",
        installDir: originalInstallDir,
      };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(existingConfig, null, 2));

      // Run init with a DIFFERENT installDir (simulating --install-dir override)
      await initMain({ installDir: tempDir, nonInteractive: true });

      // The config's installDir should remain unchanged
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      expect(config.installDir).toBe(originalInstallDir);
    });
  });

  describe("default agent usage", () => {
    it("should respect defaultAgents config when checking for existing installations", async () => {
      const CONFIG_PATH = getConfigPath();

      // Set defaultAgents in config with claude-code already installed
      const realClaudeDir = path.join(tempDir, ".claude");
      fs.mkdirSync(realClaudeDir, { recursive: true });
      fs.writeFileSync(path.join(realClaudeDir, ".nori-managed"), "senior-swe");

      const existingConfig = {
        defaultAgents: ["claude-code"],
        activeSkillset: "senior-swe",
        auth: {
          username: "test@example.com",
          organizationUrl: "https://example.tilework.tech",
        },
        installDir: tempDir,
      };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(existingConfig, null, 2));

      // Create unmanaged config that would trigger capture if detection ran
      fs.writeFileSync(
        path.join(TEST_CLAUDE_DIR, "CLAUDE.md"),
        "# My Custom Config",
      );

      await initMain({ installDir: tempDir, nonInteractive: true });

      // Since default agent is already installed, no capture should happen
      // and existing profile should be preserved
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      expect(config.activeSkillset).toBe("senior-swe");
    });
  });

  describe("multi-agent broadcasting", () => {
    it("should call markInstall for all default agents in non-interactive mode", async () => {
      const CONFIG_PATH = getConfigPath();

      // Set up config with defaultAgents
      const existingConfig = {
        defaultAgents: ["claude-code"],
        installDir: tempDir,
      };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(existingConfig, null, 2));

      // Run init
      await initMain({ installDir: tempDir, nonInteractive: true });

      // Verify .nori-managed marker was created for the agent
      const markerPath = path.join(tempDir, ".claude", ".nori-managed");
      expect(fs.existsSync(markerPath)).toBe(true);
    });

    it("should call captureExistingConfig for all default agents when capturing in non-interactive mode", async () => {
      // Create existing Claude Code config at the real install dir path to trigger capture
      const realClaudeDir = path.join(tempDir, ".claude");
      fs.mkdirSync(realClaudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(realClaudeDir, "CLAUDE.md"),
        "# My Custom Config\n\nSome content",
      );

      const skillsDir = path.join(realClaudeDir, "skills");
      fs.mkdirSync(skillsDir, { recursive: true });
      fs.mkdirSync(path.join(skillsDir, "my-skill"));
      fs.writeFileSync(path.join(skillsDir, "my-skill", "SKILL.md"), "# Skill");

      // Run init in non-interactive mode
      await initMain({ installDir: tempDir, nonInteractive: true });

      // Verify profile was captured
      const capturedProfileDir = path.join(
        TEST_NORI_DIR,
        "profiles",
        "my-profile",
      );
      expect(fs.existsSync(capturedProfileDir)).toBe(true);

      // Verify markInstall was called for all agents (marker file should exist)
      const markerPath = path.join(tempDir, ".claude", ".nori-managed");
      expect(fs.existsSync(markerPath)).toBe(true);
      expect(fs.readFileSync(markerPath, "utf-8")).toBe("my-profile");
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
