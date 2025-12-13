/**
 * Tests for nori-switch-profile intercepted slash command
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { HookInput } from "./types.js";

// Mock the paths module to prevent tests from writing to real ~/.claude/settings.json
// The nori-switch-profile command runs installMain() which calls hooksLoader,
// and hooksLoader uses getClaudeHomeSettingsFile() which defaults to ~/.claude/settings.json.
// Without this mock, tests would pollute the real user's settings.
let mockClaudeHomeDir: string;
let mockClaudeHomeSettingsFile: string;

vi.mock("@/cli/features/claude-code/paths.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getClaudeHomeDir: () => mockClaudeHomeDir,
    getClaudeHomeSettingsFile: () => mockClaudeHomeSettingsFile,
    getClaudeHomeCommandsDir: () => path.join(mockClaudeHomeDir, "commands"),
  };
});

// Import after mocking
import { noriSwitchProfile } from "./nori-switch-profile.js";

/**
 * Strip ANSI escape codes from a string for plain text comparison
 *
 * @param str - The string containing ANSI codes
 *
 * @returns The string with ANSI codes removed
 */
const stripAnsi = (str: string): string => {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
};

describe("nori-switch-profile", () => {
  let testDir: string;
  let profilesDir: string;
  let configPath: string;

  beforeEach(async () => {
    // Create test directory structure
    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-switch-profile-test-"),
    );
    const claudeDir = path.join(testDir, ".claude");
    profilesDir = path.join(claudeDir, "profiles");
    configPath = path.join(testDir, ".nori-config.json");

    // Set up mock paths to redirect hooks installation to temp directory
    // This prevents tests from writing to the real ~/.claude/settings.json
    mockClaudeHomeDir = claudeDir;
    mockClaudeHomeSettingsFile = path.join(claudeDir, "settings.json");

    // Create profiles directory with test profiles
    await fs.mkdir(profilesDir, { recursive: true });

    // Create test profiles
    for (const profileName of ["amol", "senior-swe", "product-manager"]) {
      const profileDir = path.join(profilesDir, profileName);
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(
        path.join(profileDir, "CLAUDE.md"),
        `# ${profileName} profile`,
      );
      await fs.writeFile(
        path.join(profileDir, "profile.json"),
        JSON.stringify({
          name: profileName,
          description: `Test ${profileName} profile`,
          builtin: true,
        }),
      );
    }

    // Create initial config
    await fs.writeFile(
      configPath,
      JSON.stringify({
        profile: {
          baseProfile: "senior-swe",
        },
      }),
    );
  });

  afterEach(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  const createInput = (args: {
    prompt: string;
    cwd?: string | null;
  }): HookInput => {
    const { prompt, cwd } = args;
    return {
      prompt,
      cwd: cwd ?? testDir,
      session_id: "test-session",
      transcript_path: "",
      permission_mode: "default",
      hook_event_name: "UserPromptSubmit",
    };
  };

  describe("matchers", () => {
    it("should have valid regex matchers", () => {
      expect(noriSwitchProfile.matchers).toBeInstanceOf(Array);
      expect(noriSwitchProfile.matchers.length).toBeGreaterThan(0);

      for (const matcher of noriSwitchProfile.matchers) {
        expect(() => new RegExp(matcher)).not.toThrow();
      }
    });
  });

  describe("run function", () => {
    it("should switch profile when profile name provided", async () => {
      const input = createInput({ prompt: "/nori-switch-profile amol" });
      const result = await noriSwitchProfile.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(result!.reason).toContain("amol");

      // Verify profile was actually switched in config
      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(updatedConfig.profile.baseProfile).toBe("amol");
    });

    it("should list available profiles when no profile name provided", async () => {
      const input = createInput({ prompt: "/nori-switch-profile" });
      const result = await noriSwitchProfile.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Available profiles:");
      expect(plainReason).toContain("amol");
      expect(plainReason).toContain("senior-swe");
      expect(plainReason).toContain("product-manager");
    });
  });

  describe("error handling", () => {
    it("should return error for non-existent profile", async () => {
      const input = createInput({ prompt: "/nori-switch-profile nonexistent" });
      const result = await noriSwitchProfile.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("not found");
      expect(plainReason).toContain("Available profiles:");
    });

    it("should return error when no profiles directory found", async () => {
      // Remove profiles directory
      await fs.rm(profilesDir, { recursive: true, force: true });

      const input = createInput({ prompt: "/nori-switch-profile amol" });
      const result = await noriSwitchProfile.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(stripAnsi(result!.reason!)).toContain("No profiles found");
    });
  });

  describe("installDir resolution", () => {
    it("should find profiles in parent directory when running from subdirectory", async () => {
      // Create subdirectory within testDir
      const subDir = path.join(testDir, "subdir", "nested");
      await fs.mkdir(subDir, { recursive: true });

      const input = createInput({
        prompt: "/nori-switch-profile amol",
        cwd: subDir,
      });
      const result = await noriSwitchProfile.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");

      // Verify profile was switched in the parent directory's config
      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(updatedConfig.profile.baseProfile).toBe("amol");
    });

    it("should return error when no installation found", async () => {
      // Create a directory with NO Nori installation markers
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-switch-no-install-"),
      );

      try {
        const input = createInput({
          prompt: "/nori-switch-profile amol",
          cwd: noInstallDir,
        });
        const result = await noriSwitchProfile.run({ input });

        expect(result).not.toBeNull();
        expect(result!.decision).toBe("block");
        expect(stripAnsi(result!.reason!)).toContain(
          "No Nori installation found",
        );
      } finally {
        await fs.rm(noInstallDir, { recursive: true, force: true });
      }
    });
  });

  describe("profile application", () => {
    it("should run install loaders after switching profile to apply changes", async () => {
      // This test verifies that /nori-switch-profile actually applies the profile,
      // not just updates the config file. The bug was that only the config was
      // updated, but the install loaders were never run.

      // Track if installMain was called
      let installMainCalled = false;
      let installMainArgs: {
        nonInteractive?: boolean | null;
        skipUninstall?: boolean | null;
        installDir?: string | null;
        agent?: string | null;
        silent?: boolean | null;
      } | null = null;

      // Mock the install module
      vi.doMock("@/cli/commands/install/install.js", () => ({
        main: vi.fn(async (args) => {
          installMainCalled = true;
          installMainArgs = args;
        }),
      }));

      // Re-import the module to pick up the mock
      // Note: We need to reset the module cache for this mock to take effect
      vi.resetModules();
      const { noriSwitchProfile: mockedNoriSwitchProfile } =
        await import("./nori-switch-profile.js");

      const input = createInput({ prompt: "/nori-switch-profile amol" });
      const result = await mockedNoriSwitchProfile.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");

      // Verify install main was called with correct args
      expect(installMainCalled).toBe(true);
      expect(installMainArgs).not.toBeNull();
      expect(installMainArgs!.nonInteractive).toBe(true);
      expect(installMainArgs!.skipUninstall).toBe(true);
      expect(installMainArgs!.installDir).toBe(testDir);
      expect(installMainArgs!.agent).toBe("claude-code");
      // CRITICAL: Install must be silent to prevent stdout pollution
      // during hook execution (JSON response corruption)
      expect(installMainArgs!.silent).toBe(true);

      // Restore mocks
      vi.doUnmock("@/cli/commands/install/install.js");
      vi.resetModules();
    });
  });
});
