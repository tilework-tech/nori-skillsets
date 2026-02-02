/**
 * Tests for nori-switch-profile intercepted slash command
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { stripAnsi } from "@/cli/features/test-utils/index.js";

import type { HookInput } from "./types.js";

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
    getNoriDir: (args: { installDir: string }) =>
      path.join(args.installDir, ".nori"),
    getNoriProfilesDir: (args: { installDir: string }) =>
      path.join(args.installDir, ".nori", "profiles"),
  };
});

// Import after mocking
import { noriSwitchProfile } from "./nori-switch-profile.js";

describe("nori-switch-profile", () => {
  let testDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    // Create test directory structure
    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-switch-profile-test-"),
    );
    const claudeDir = path.join(testDir, ".claude");
    const noriDir = path.join(testDir, ".nori");
    profilesDir = path.join(noriDir, "profiles");
    const configPath = path.join(testDir, ".nori-config.json");

    // Set up mock paths to redirect hooks installation to temp directory
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

  describe("listing skillsets", () => {
    it("should list available skillsets with terminal usage when no skillset name provided", async () => {
      const input = createInput({ prompt: "/nori-switch-skillset" });
      const result = await noriSwitchProfile.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Available skillsets:");
      expect(plainReason).toContain("amol");
      expect(plainReason).toContain("senior-swe");
      expect(plainReason).toContain("product-manager");
      expect(plainReason).toContain("nori-skillsets switch-skillset");
    });

    it("should also work with /nori-switch-profile alias", async () => {
      const input = createInput({ prompt: "/nori-switch-profile" });
      const result = await noriSwitchProfile.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("Available skillsets:");
      expect(plainReason).toContain("nori-skillsets switch-skillset");
    });
  });

  describe("informational message for valid skillset", () => {
    it("should return informational message telling user to run terminal command", async () => {
      const input = createInput({ prompt: "/nori-switch-profile amol" });
      const result = await noriSwitchProfile.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("nori-skillsets switch-skillset amol");
      expect(plainReason).toContain("terminal");
      expect(plainReason).toContain("restart Claude Code");
    });

    it("should not actually switch the profile (config unchanged)", async () => {
      const configPath = path.join(testDir, ".nori-config.json");
      const configBefore = await fs.readFile(configPath, "utf-8");

      const input = createInput({ prompt: "/nori-switch-profile amol" });
      await noriSwitchProfile.run({ input });

      const configAfter = await fs.readFile(configPath, "utf-8");
      expect(configAfter).toBe(configBefore);
    });
  });

  describe("error handling", () => {
    it("should return error for non-existent skillset with available list", async () => {
      const input = createInput({ prompt: "/nori-switch-profile nonexistent" });
      const result = await noriSwitchProfile.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("not found");
      expect(plainReason).toContain("Available skillsets:");
    });

    it("should return error when no skillsets directory found", async () => {
      // Remove profiles directory
      await fs.rm(profilesDir, { recursive: true, force: true });

      const input = createInput({ prompt: "/nori-switch-profile amol" });
      const result = await noriSwitchProfile.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(stripAnsi(result!.reason!)).toContain("No skillsets found");
    });
  });

  describe("installDir resolution", () => {
    it("should find profiles in parent directory when running from subdirectory", async () => {
      const subDir = path.join(testDir, "subdir", "nested");
      await fs.mkdir(subDir, { recursive: true });

      const input = createInput({
        prompt: "/nori-switch-profile amol",
        cwd: subDir,
      });
      const result = await noriSwitchProfile.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain("nori-skillsets switch-skillset amol");
    });

    it("should return error when no installation found", async () => {
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
});
