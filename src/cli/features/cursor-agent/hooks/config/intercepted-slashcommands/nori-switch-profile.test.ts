/**
 * Tests for cursor-agent nori-switch-profile intercepted slash command
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

import { noriSwitchProfile } from "./nori-switch-profile.js";

describe("cursor-agent nori-switch-profile", () => {
  let testDir: string;
  let profilesDir: string;
  let configPath: string;

  beforeEach(async () => {
    // Create test directory structure for cursor-agent
    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "cursor-agent-switch-profile-test-"),
    );
    const cursorDir = path.join(testDir, ".cursor");
    profilesDir = path.join(cursorDir, "profiles");
    configPath = path.join(testDir, ".nori-config.json");

    // Create profiles directory with test profiles
    await fs.mkdir(profilesDir, { recursive: true });

    // Create test profiles (with AGENTS.md instead of CLAUDE.md for cursor-agent)
    for (const profileName of ["amol", "senior-swe", "product-manager"]) {
      const profileDir = path.join(profilesDir, profileName);
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(
        path.join(profileDir, "AGENTS.md"),
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

    // Create initial config with cursor-agent specific structure
    await fs.writeFile(
      configPath,
      JSON.stringify({
        version: "19.0.0",
        agents: {
          "cursor-agent": {
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
      hook_event_name: "beforeSubmitPrompt",
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

    it("should match /nori-switch-profile without args", () => {
      const matched = noriSwitchProfile.matchers.some((m) =>
        new RegExp(m, "i").test("/nori-switch-profile"),
      );
      expect(matched).toBe(true);
    });

    it("should match /nori-switch-profile with profile name", () => {
      const matched = noriSwitchProfile.matchers.some((m) =>
        new RegExp(m, "i").test("/nori-switch-profile amol"),
      );
      expect(matched).toBe(true);
    });
  });

  describe("run function", () => {
    it("should switch profile when profile name provided", async () => {
      const input = createInput({ prompt: "/nori-switch-profile amol" });
      const result = await noriSwitchProfile.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      // Verify success message mentions the switched profile
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("amol");
      expect(plainReason).toContain("switched");
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

    it("should instruct user to restart Cursor", async () => {
      const input = createInput({ prompt: "/nori-switch-profile amol" });
      const result = await noriSwitchProfile.run({ input });

      expect(result).not.toBeNull();
      const plainReason = stripAnsi(result!.reason!);
      // Should say "Cursor" not "Claude Code"
      expect(plainReason).toContain("Cursor");
      expect(plainReason).not.toContain("Claude Code");
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

      // Verify success message mentions the switched profile
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("amol");
      expect(plainReason).toContain("switched");
    });

    it("should return error when no installation found", async () => {
      // Create a directory with NO Nori installation markers
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "cursor-agent-switch-no-install-"),
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
      // cursor-agent should use cursor-agent, not claude-code
      expect(command).toContain("--agent cursor-agent");

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

  describe("stdout cleanliness", () => {
    it("should not pollute stdout with console messages during profile switch", async () => {
      // This test verifies that the hook does not output anything to stdout/stderr
      // except the JSON result. agent.switchProfile() internally calls success()
      // and info() which would pollute stdout if not suppressed.
      //
      // Cursor expects ONLY valid JSON on stdout from hooks. Any other
      // output causes JSON parsing to fail and the command falls through to LLM.

      // Capture all console output
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {
        // Suppress output
      });
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {
          // Suppress output
        });

      const input = createInput({ prompt: "/nori-switch-profile amol" });
      const result = await noriSwitchProfile.run({ input });

      // The result should be valid JSON-serializable
      expect(result).not.toBeNull();
      expect(() => JSON.stringify(result)).not.toThrow();

      // Verify no console.log or console.error was called during the operation
      // (the logger internally uses console.log/console.error)
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it("should not pollute stdout even when subprocess errors occur", async () => {
      // Mock execSync to throw an error
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error("Command failed: nori-ai not found");
      });

      // Capture all console output
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {
        // Suppress output
      });
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {
          // Suppress output
        });

      const input = createInput({ prompt: "/nori-switch-profile amol" });
      const result = await noriSwitchProfile.run({ input });

      // Should still return valid result
      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");

      // Verify no console pollution even during error handling
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });
});
