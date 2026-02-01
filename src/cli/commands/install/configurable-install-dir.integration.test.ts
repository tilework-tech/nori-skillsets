/**
 * Integration tests for configurable installation directory feature
 * Tests the full installation flow with custom install directories
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  loadConfig,
  saveConfig,
  isPaidInstall,
  type Config,
} from "@/cli/config.js";
import { claudeMdLoader } from "@/cli/features/claude-code/profiles/claudemd/loader.js";
import { profilesLoader } from "@/cli/features/claude-code/profiles/loader.js";
import { skillsLoader } from "@/cli/features/claude-code/profiles/skills/loader.js";

// Mock paths module to use test directories
let mockInstallDir: string;

vi.mock("@/cli/features/claude-code/paths.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getClaudeDir: (args?: { installDir?: string | null }) => {
      const installDir = args?.installDir || mockInstallDir;
      return path.join(installDir, ".claude");
    },
    getClaudeSettingsFile: (args?: { installDir?: string | null }) => {
      const installDir = args?.installDir || mockInstallDir;
      return path.join(installDir, ".claude", "settings.json");
    },
    getClaudeProfilesDir: (args?: { installDir?: string | null }) => {
      const installDir = args?.installDir || mockInstallDir;
      return path.join(installDir, ".claude", "profiles");
    },
    getClaudeSkillsDir: (args?: { installDir?: string | null }) => {
      const installDir = args?.installDir || mockInstallDir;
      return path.join(installDir, ".claude", "skills");
    },
    getClaudeAgentsDir: (args?: { installDir?: string | null }) => {
      const installDir = args?.installDir || mockInstallDir;
      return path.join(installDir, ".claude", "agents");
    },
    getClaudeCommandsDir: (args?: { installDir?: string | null }) => {
      const installDir = args?.installDir || mockInstallDir;
      return path.join(installDir, ".claude", "commands");
    },
    getClaudeMdFile: (args?: { installDir?: string | null }) => {
      const installDir = args?.installDir || mockInstallDir;
      return path.join(installDir, ".claude", "CLAUDE.md");
    },
    getNoriDir: (args?: { installDir?: string | null }) => {
      const installDir = args?.installDir || mockInstallDir;
      return path.join(installDir, ".nori");
    },
    getNoriProfilesDir: (args?: { installDir?: string | null }) => {
      const installDir = args?.installDir || mockInstallDir;
      return path.join(installDir, ".nori", "profiles");
    },
    getNoriConfigFile: (args?: { installDir?: string | null }) => {
      const installDir = args?.installDir || mockInstallDir;
      return path.join(installDir, ".nori", "config.json");
    },
  };
});

describe("configurable install directory integration", () => {
  let tempDir: string;
  let customInstallDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "configurable-install-test-"),
    );
    customInstallDir = path.join(tempDir, "my-project");
    await fs.mkdir(customInstallDir, { recursive: true });

    // Set mock install directory
    mockInstallDir = customInstallDir;

    // Mock HOME for any legacy code paths
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;

    // Create stub profiles (built-in profiles are no longer bundled)
    const profilesDir = path.join(customInstallDir, ".nori", "profiles");
    await fs.mkdir(profilesDir, { recursive: true });
    for (const profileName of ["senior-swe", "amol"]) {
      const profileDir = path.join(profilesDir, profileName);
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(
        path.join(profileDir, "CLAUDE.md"),
        `# ${profileName}\n`,
      );
      await fs.writeFile(
        path.join(profileDir, "nori.json"),
        JSON.stringify({
          name: profileName,
          version: "1.0.0",
          description: `${profileName} profile`,
        }),
      );

      // Create skills directory with a stub skill
      const skillDir = path.join(profileDir, "skills", "using-skills");
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, "SKILL.md"),
        "---\nname: Getting Started with Abilities\ndescription: Describes how to use abilities.\n---\n# Stub\n",
      );

      // Create subagents directory with a stub subagent
      const subagentsDir = path.join(profileDir, "subagents");
      await fs.mkdir(subagentsDir, { recursive: true });
      await fs.writeFile(
        path.join(subagentsDir, "nori-stub-agent.md"),
        "# Stub subagent\n",
      );

      // Create slashcommands directory with a stub command
      const slashcommandsDir = path.join(profileDir, "slashcommands");
      await fs.mkdir(slashcommandsDir, { recursive: true });
      await fs.writeFile(
        path.join(slashcommandsDir, "nori-stub-command.md"),
        "# Stub slash command\n",
      );
    }
  });

  afterEach(async () => {
    // Restore HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear mocks
    vi.clearAllMocks();
  });

  describe("installation to custom directory", () => {
    it("should install all features to custom directory", async () => {
      const config: Config = {
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        installDir: customInstallDir,
      };

      // Install all features
      await profilesLoader.run({ config });
      await skillsLoader.install({ config });
      await claudeMdLoader.install({ config });

      // Verify all features installed to custom location
      // Profiles now go to .nori/profiles, not .claude/profiles
      const noriProfilesDir = path.join(customInstallDir, ".nori", "profiles");
      const skillsDir = path.join(customInstallDir, ".claude", "skills");
      const claudeMdPath = path.join(customInstallDir, ".claude", "CLAUDE.md");
      const settingsPath = path.join(
        customInstallDir,
        ".claude",
        "settings.json",
      );

      // Check all exist
      expect(
        await fs
          .access(noriProfilesDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(true);
      expect(
        await fs
          .access(skillsDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(true);
      expect(
        await fs
          .access(claudeMdPath)
          .then(() => true)
          .catch(() => false),
      ).toBe(true);
      expect(
        await fs
          .access(settingsPath)
          .then(() => true)
          .catch(() => false),
      ).toBe(true);

      // Verify content
      const profiles = await fs.readdir(noriProfilesDir);
      const skills = await fs.readdir(skillsDir);
      expect(profiles.length).toBeGreaterThan(0);
      expect(skills.length).toBeGreaterThan(0);

      const claudeMdContent = await fs.readFile(claudeMdPath, "utf-8");
      expect(claudeMdContent).toContain("BEGIN NORI-AI MANAGED BLOCK");

      const settingsContent = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(settingsContent);
      expect(settings.permissions).toBeDefined();
      expect(settings.permissions.additionalDirectories).toBeDefined();
    });

    it("should use absolute paths (not ~/.claude) for skill references in CLAUDE.md", async () => {
      const config: Config = {
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        installDir: customInstallDir,
      };

      // Install profiles first
      await profilesLoader.run({ config });

      // Then create CLAUDE.md
      await claudeMdLoader.install({ config });

      // Read CLAUDE.md content
      const claudeMdPath = path.join(customInstallDir, ".claude", "CLAUDE.md");
      const content = await fs.readFile(claudeMdPath, "utf-8");

      // Should have skills list
      expect(content).toContain("# Nori Skills System");

      // Skill paths should be absolute paths to the custom install directory
      // NOT ~/.claude/skills/
      expect(content).toContain(
        `${customInstallDir}/.claude/skills/using-skills/SKILL.md`,
      );

      // Should NOT contain tilde notation since we're not installing to home
      expect(content).not.toMatch(/~\/\.claude\/skills\//);
    });
  });

  describe("config file location", () => {
    it("should save config to installDir/.nori-config.json", async () => {
      await saveConfig({
        username: null,
        password: null,
        organizationUrl: null,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        installDir: customInstallDir,
      });

      // Config should be at custom location
      const configPath = path.join(customInstallDir, ".nori-config.json");
      const exists = await fs
        .access(configPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      // Should NOT be in home directory
      const homeConfig = path.join(tempDir, "nori-config.json");
      const homeExists = await fs
        .access(homeConfig)
        .then(() => true)
        .catch(() => false);
      expect(homeExists).toBe(false);
    });

    it("should load config from installDir/.nori-config.json", async () => {
      // Write config to custom location (using new agents format)
      const configPath = path.join(customInstallDir, ".nori-config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({
          username: "test@example.com",
          password: "testpass",
          organizationUrl: "https://test.com",
          agents: { "claude-code": { profile: { baseProfile: "amol" } } },
          installDir: customInstallDir,
        }),
      );

      const loaded = await loadConfig({ installDir: customInstallDir });

      expect(loaded?.auth).toEqual({
        username: "test@example.com",
        password: "testpass",
        refreshToken: null,
        organizationUrl: "https://test.com",
      });
      expect(loaded?.agents?.["claude-code"]?.profile).toEqual({
        baseProfile: "amol",
      });
      expect(loaded?.installDir).toBe(customInstallDir);
    });

    it("should correctly identify free install with installDir", async () => {
      const config: Config = {
        auth: null,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        installDir: customInstallDir,
      };

      expect(config.installDir).toBe(customInstallDir);
      expect(isPaidInstall({ config }) ? "paid" : "free").toBe("free");
    });
  });

  describe("multiple isolated installations", () => {
    it("should support two separate installations without interference", async () => {
      const install1Dir = path.join(tempDir, "project1");
      const install2Dir = path.join(tempDir, "project2");
      await fs.mkdir(install1Dir, { recursive: true });
      await fs.mkdir(install2Dir, { recursive: true });

      // Save config to first installation
      await saveConfig({
        username: "user1@example.com",
        password: "pass1",
        organizationUrl: "https://org1.com",
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        installDir: install1Dir,
      });

      // Save config to second installation
      await saveConfig({
        username: "user2@example.com",
        password: "pass2",
        organizationUrl: "https://org2.com",
        agents: { "claude-code": { profile: { baseProfile: "amol" } } },
        installDir: install2Dir,
      });

      // Load and verify first config
      const config1 = await loadConfig({ installDir: install1Dir });
      expect(config1?.auth?.username).toBe("user1@example.com");
      expect(config1?.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "senior-swe",
      );

      // Load and verify second config
      const config2 = await loadConfig({ installDir: install2Dir });
      expect(config2?.auth?.username).toBe("user2@example.com");
      expect(config2?.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "amol",
      );

      // Verify they are completely separate
      expect(config1?.auth?.username).not.toBe(config2?.auth?.username);
    });
  });
});
