/**
 * Tests for cursor-agent nori-switch-profile intercepted slash command
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { HookInput } from "./types.js";

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

  describe("profile application", () => {
    it("should run install loaders after switching profile to apply changes", async () => {
      // Track if installMain was called with cursor-agent
      let installMainCalled = false;
      let installMainArgs: {
        nonInteractive?: boolean | null;
        skipUninstall?: boolean | null;
        installDir?: string | null;
        agent?: string | null;
      } | null = null;

      // Mock the install module
      vi.doMock("@/cli/commands/install/install.js", () => ({
        main: vi.fn(async (args) => {
          installMainCalled = true;
          installMainArgs = args;
        }),
      }));

      // Re-import the module to pick up the mock
      vi.resetModules();
      const { noriSwitchProfile: mockedNoriSwitchProfile } =
        await import("./nori-switch-profile.js");

      const input = createInput({ prompt: "/nori-switch-profile amol" });
      const result = await mockedNoriSwitchProfile.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");

      // Verify install main was called with cursor-agent (not claude-code)
      expect(installMainCalled).toBe(true);
      expect(installMainArgs).not.toBeNull();
      expect(installMainArgs!.nonInteractive).toBe(true);
      expect(installMainArgs!.skipUninstall).toBe(true);
      expect(installMainArgs!.installDir).toBe(testDir);
      expect(installMainArgs!.agent).toBe("cursor-agent");

      // Restore mocks
      vi.doUnmock("@/cli/commands/install/install.js");
      vi.resetModules();
    });
  });
});
