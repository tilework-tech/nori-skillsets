/**
 * Tests for nori-switch-profile intercepted slash command
 */

import * as childProcess from "child_process";
import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { stripAnsi } from "@/cli/features/test-utils/index.js";

import type { HookInput } from "./types.js";

// Mock child_process.execSync for testing subprocess invocation
vi.mock("child_process", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof childProcess;
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

// Mock the paths module to prevent tests from writing to real ~/.claude/settings.json
// Without this mock, tests could pollute the real user's settings.
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

// Mock installMain to prevent real install execution in tests
vi.mock("@/cli/commands/install/install.js", () => ({
  main: vi.fn(async () => {
    // Empty mock - just prevents real install execution
  }),
}));

// Import after mocking
import { noriSwitchProfile } from "./nori-switch-profile.js";

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
        version: "19.0.0",
        profile: {
          baseProfile: "senior-swe",
        },
        agents: {
          "claude-code": {
            profile: {
              baseProfile: "senior-swe",
            },
          },
        },
      }),
    );
  });

  afterEach(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
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
      expect(updatedConfig.agents["claude-code"].profile.baseProfile).toBe(
        "amol",
      );
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
      expect(updatedConfig.agents["claude-code"].profile.baseProfile).toBe(
        "amol",
      );
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

  describe("profile application via subprocess", () => {
    it("should run nori-ai install via subprocess after switching profile", async () => {
      // This test verifies that /nori-switch-profile runs the install command
      // via subprocess (not dynamic import) to apply profile changes.
      //
      // IMPORTANT: We use subprocess instead of dynamic import because this
      // hook script is bundled by esbuild. When bundled, __dirname resolves
      // to the bundled script location (hooks/config/) instead of the original
      // loader locations, breaking path resolution in installMain's loaders.
      // Spawning nori-ai as a subprocess runs the CLI from its installed
      // location where paths resolve correctly.

      const input = createInput({ prompt: "/nori-switch-profile amol" });
      const result = await noriSwitchProfile.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");

      // Verify execSync was called with correct nori-ai install command
      expect(childProcess.execSync).toHaveBeenCalledTimes(1);
      const execSyncCall = vi.mocked(childProcess.execSync).mock.calls[0];
      const command = execSyncCall[0] as string;

      // Verify command includes all required flags
      expect(command).toContain("nori-ai install");
      expect(command).toContain("--non-interactive");
      expect(command).toContain("--silent");
      expect(command).toContain("--skip-uninstall");
      expect(command).toContain(`--install-dir "${testDir}"`);
      expect(command).toContain("--agent claude-code");

      // Verify stdio is configured to suppress output (prevents stdout pollution)
      const options = execSyncCall[1] as { stdio?: unknown };
      expect(options.stdio).toEqual(["ignore", "ignore", "ignore"]);
    });

    it("should handle subprocess errors gracefully", async () => {
      // Mock execSync to throw an error
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error("Command failed: nori-ai not found");
      });

      const input = createInput({ prompt: "/nori-switch-profile amol" });
      const result = await noriSwitchProfile.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Failed to switch profile");
      expect(plainReason).toContain("nori-ai not found");
    });
  });
});
