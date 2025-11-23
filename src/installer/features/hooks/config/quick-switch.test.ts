/**
 * Tests for quick-switch hook
 * This hook intercepts /nori-switch-profile commands for instant profile switching
 */

import { spawn } from "child_process";
import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";
import { fileURLToPath } from "url";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Get directory of this test file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the built script
const QUICK_SWITCH_SCRIPT = path.resolve(
  __dirname,
  "../../../../../build/src/installer/features/hooks/config/quick-switch.js",
);

// Helper to run the hook script with mock stdin
const runHookScript = async (args: {
  scriptPath: string;
  stdinData: string;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  const { scriptPath, stdinData } = args;

  return new Promise((resolve) => {
    const child = spawn("node", [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      });
    });

    // Write stdin data and close
    child.stdin.write(stdinData);
    child.stdin.end();
  });
};

describe("quick-switch hook", () => {
  let testDir: string;
  let profilesDir: string;
  let configPath: string;

  beforeEach(async () => {
    // Create test directory structure
    testDir = await fs.mkdtemp(path.join(tmpdir(), "quick-switch-test-"));
    const claudeDir = path.join(testDir, ".claude");
    profilesDir = path.join(claudeDir, "profiles");
    // Config path - the script looks for .nori-config.json in cwd
    configPath = path.join(testDir, ".nori-config.json");

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

  describe("pattern matching", () => {
    it("should match /nori-switch-profile with profile name and switch profile", async () => {
      const scriptPath = QUICK_SWITCH_SCRIPT;

      const stdinData = JSON.stringify({
        prompt: "/nori-switch-profile amol",
        cwd: testDir,
        session_id: "test-session",
        transcript_path: "",
        permission_mode: "default",
        hook_event_name: "UserPromptSubmit",
      });

      const result = await runHookScript({ scriptPath, stdinData });

      // Should exit successfully
      expect(result.exitCode).toBe(0);

      // Should return context for Claude to describe the profile
      const output = JSON.parse(result.stdout);
      expect(output.hookSpecificOutput).toBeDefined();
      expect(output.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
      expect(output.hookSpecificOutput.additionalContext).toContain("amol");
      expect(output.hookSpecificOutput.additionalContext).toContain("restart");

      // Verify profile was actually switched in config
      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(updatedConfig.profile.baseProfile).toBe("amol");
    });

    it("should list available profiles when no profile name provided", async () => {
      const scriptPath = QUICK_SWITCH_SCRIPT;

      const stdinData = JSON.stringify({
        prompt: "/nori-switch-profile",
        cwd: testDir,
        session_id: "test-session",
        transcript_path: "",
        permission_mode: "default",
        hook_event_name: "UserPromptSubmit",
      });

      const result = await runHookScript({ scriptPath, stdinData });

      // Should exit successfully
      expect(result.exitCode).toBe(0);

      // Should return block decision with available profiles
      const output = JSON.parse(result.stdout);
      expect(output.decision).toBe("block");
      expect(output.reason).toContain("Available profiles:");
      expect(output.reason).toContain("amol");
      expect(output.reason).toContain("senior-swe");
      expect(output.reason).toContain("product-manager");
    });

    it("should pass through non-matching prompts", async () => {
      const scriptPath = QUICK_SWITCH_SCRIPT;

      const stdinData = JSON.stringify({
        prompt: "What is the weather today?",
        cwd: testDir,
        session_id: "test-session",
        transcript_path: "",
        permission_mode: "default",
        hook_event_name: "UserPromptSubmit",
      });

      const result = await runHookScript({ scriptPath, stdinData });

      // Should exit successfully with no output (pass through)
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
    });

    it("should handle prompt with extra whitespace", async () => {
      const scriptPath = QUICK_SWITCH_SCRIPT;

      const stdinData = JSON.stringify({
        prompt: "  /nori-switch-profile   amol  ",
        cwd: testDir,
        session_id: "test-session",
        transcript_path: "",
        permission_mode: "default",
        hook_event_name: "UserPromptSubmit",
      });

      const result = await runHookScript({ scriptPath, stdinData });

      // Should still match and switch
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.hookSpecificOutput).toBeDefined();

      // Verify profile was switched
      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(updatedConfig.profile.baseProfile).toBe("amol");
    });
  });

  describe("error handling", () => {
    it("should return block decision with error for non-existent profile", async () => {
      const scriptPath = QUICK_SWITCH_SCRIPT;

      const stdinData = JSON.stringify({
        prompt: "/nori-switch-profile nonexistent",
        cwd: testDir,
        session_id: "test-session",
        transcript_path: "",
        permission_mode: "default",
        hook_event_name: "UserPromptSubmit",
      });

      const result = await runHookScript({ scriptPath, stdinData });

      // Should exit successfully but with block decision
      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.decision).toBe("block");
      expect(output.reason).toContain("not found");
      expect(output.reason).toContain("Available profiles:");
      expect(output.reason).toContain("amol");
    });

    it("should fail with useful error when no profiles directory found", async () => {
      // Remove profiles directory
      await fs.rm(profilesDir, { recursive: true, force: true });

      const scriptPath = QUICK_SWITCH_SCRIPT;

      const stdinData = JSON.stringify({
        prompt: "/nori-switch-profile amol",
        cwd: testDir,
        session_id: "test-session",
        transcript_path: "",
        permission_mode: "default",
        hook_event_name: "UserPromptSubmit",
      });

      const result = await runHookScript({ scriptPath, stdinData });

      // Should exit successfully but with block decision containing error
      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.decision).toBe("block");
      expect(output.reason).toContain("No profiles found");
      expect(output.reason).toContain("nori-ai install");
    });

    it("should handle malformed stdin JSON gracefully", async () => {
      const scriptPath = QUICK_SWITCH_SCRIPT;

      const result = await runHookScript({
        scriptPath,
        stdinData: "not valid json",
      });

      // Should exit successfully but pass through (no output)
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
    });

    it("should handle empty stdin gracefully", async () => {
      const scriptPath = QUICK_SWITCH_SCRIPT;

      const result = await runHookScript({
        scriptPath,
        stdinData: "",
      });

      // Should exit successfully but pass through (no output)
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
    });
  });

  describe("installDir resolution", () => {
    it("should use cwd from stdin to find profiles directory", async () => {
      const scriptPath = QUICK_SWITCH_SCRIPT;

      // Create a different test directory with different profiles
      const otherTestDir = await fs.mkdtemp(
        path.join(tmpdir(), "quick-switch-other-"),
      );
      const otherProfilesDir = path.join(otherTestDir, ".claude", "profiles");
      await fs.mkdir(otherProfilesDir, { recursive: true });

      // Create a unique profile in the other directory
      const uniqueProfileDir = path.join(otherProfilesDir, "unique-profile");
      await fs.mkdir(uniqueProfileDir, { recursive: true });
      await fs.writeFile(
        path.join(uniqueProfileDir, "CLAUDE.md"),
        "# unique profile",
      );
      await fs.writeFile(
        path.join(uniqueProfileDir, "profile.json"),
        JSON.stringify({
          name: "unique-profile",
          description: "Unique test profile",
        }),
      );

      // Create config in the other directory (note: .nori-config.json with leading dot)
      const otherConfigPath = path.join(otherTestDir, ".nori-config.json");
      await fs.writeFile(
        otherConfigPath,
        JSON.stringify({
          profile: {
            baseProfile: "default",
          },
        }),
      );

      try {
        const stdinData = JSON.stringify({
          prompt: "/nori-switch-profile unique-profile",
          cwd: otherTestDir,
          session_id: "test-session",
          transcript_path: "",
          permission_mode: "default",
          hook_event_name: "UserPromptSubmit",
        });

        const result = await runHookScript({ scriptPath, stdinData });

        // Should exit successfully and switch to the unique profile
        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout);
        expect(output.hookSpecificOutput).toBeDefined();
        expect(output.hookSpecificOutput.additionalContext).toContain(
          "unique-profile",
        );

        // Verify profile was switched in the correct config
        const updatedConfig = JSON.parse(
          await fs.readFile(otherConfigPath, "utf-8"),
        );
        expect(updatedConfig.profile.baseProfile).toBe("unique-profile");
      } finally {
        await fs.rm(otherTestDir, { recursive: true, force: true });
      }
    });

    it("should find profiles in parent directory when running from subdirectory", async () => {
      const scriptPath = QUICK_SWITCH_SCRIPT;

      // Create subdirectory within testDir
      const subDir = path.join(testDir, "subdir", "nested");
      await fs.mkdir(subDir, { recursive: true });

      // Create .nori-config.json marker in testDir to make it detectable by getInstallDirs
      await fs.writeFile(
        configPath,
        JSON.stringify({
          profile: {
            baseProfile: "senior-swe",
          },
        }),
      );

      const stdinData = JSON.stringify({
        prompt: "/nori-switch-profile amol",
        cwd: subDir, // Running from subdirectory
        session_id: "test-session",
        transcript_path: "",
        permission_mode: "default",
        hook_event_name: "UserPromptSubmit",
      });

      const result = await runHookScript({ scriptPath, stdinData });

      // Should exit successfully and switch profile
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.hookSpecificOutput).toBeDefined();
      expect(output.hookSpecificOutput.additionalContext).toContain("amol");

      // Verify profile was switched in the parent directory's config
      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(updatedConfig.profile.baseProfile).toBe("amol");
    });

    it("should fail with clear error when no installation found", async () => {
      const scriptPath = QUICK_SWITCH_SCRIPT;

      // Create a directory with NO Nori installation markers
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "quick-switch-no-install-"),
      );

      try {
        const stdinData = JSON.stringify({
          prompt: "/nori-switch-profile amol",
          cwd: noInstallDir,
          session_id: "test-session",
          transcript_path: "",
          permission_mode: "default",
          hook_event_name: "UserPromptSubmit",
        });

        const result = await runHookScript({ scriptPath, stdinData });

        // Should exit successfully but with block decision
        expect(result.exitCode).toBe(0);

        const output = JSON.parse(result.stdout);
        expect(output.decision).toBe("block");
        expect(output.reason).toContain("No Nori installation found");
      } finally {
        await fs.rm(noInstallDir, { recursive: true, force: true });
      }
    });

    it("should use closest installation when multiple exist", async () => {
      const scriptPath = QUICK_SWITCH_SCRIPT;

      // Create parent installation
      const parentDir = await fs.mkdtemp(
        path.join(tmpdir(), "quick-switch-parent-"),
      );
      const parentProfilesDir = path.join(parentDir, ".claude", "profiles");
      await fs.mkdir(parentProfilesDir, { recursive: true });

      // Create parent profile
      const parentProfileDir = path.join(parentProfilesDir, "parent-profile");
      await fs.mkdir(parentProfileDir, { recursive: true });
      await fs.writeFile(
        path.join(parentProfileDir, "CLAUDE.md"),
        "# parent profile",
      );

      // Create parent config
      const parentConfigPath = path.join(parentDir, ".nori-config.json");
      await fs.writeFile(
        parentConfigPath,
        JSON.stringify({
          profile: { baseProfile: "parent-profile" },
        }),
      );

      // Create child installation (nested)
      const childDir = path.join(parentDir, "project");
      const childProfilesDir = path.join(childDir, ".claude", "profiles");
      await fs.mkdir(childProfilesDir, { recursive: true });

      // Create child profile
      const childProfileDir = path.join(childProfilesDir, "child-profile");
      await fs.mkdir(childProfileDir, { recursive: true });
      await fs.writeFile(
        path.join(childProfileDir, "CLAUDE.md"),
        "# child profile",
      );

      // Create child config
      const childConfigPath = path.join(childDir, ".nori-config.json");
      await fs.writeFile(
        childConfigPath,
        JSON.stringify({
          profile: { baseProfile: "child-profile" },
        }),
      );

      // Create subdirectory of child
      const subDir = path.join(childDir, "subdir");
      await fs.mkdir(subDir, { recursive: true });

      try {
        const stdinData = JSON.stringify({
          prompt: "/nori-switch-profile child-profile",
          cwd: subDir, // Running from subdirectory of child
          session_id: "test-session",
          transcript_path: "",
          permission_mode: "default",
          hook_event_name: "UserPromptSubmit",
        });

        const result = await runHookScript({ scriptPath, stdinData });

        // Should exit successfully
        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout);
        expect(output.hookSpecificOutput).toBeDefined();

        // Verify profile was switched in the CHILD config (closest installation)
        const updatedChildConfig = JSON.parse(
          await fs.readFile(childConfigPath, "utf-8"),
        );
        expect(updatedChildConfig.profile.baseProfile).toBe("child-profile");

        // Verify parent config was NOT modified
        const parentConfig = JSON.parse(
          await fs.readFile(parentConfigPath, "utf-8"),
        );
        expect(parentConfig.profile.baseProfile).toBe("parent-profile");
      } finally {
        await fs.rm(parentDir, { recursive: true, force: true });
      }
    });
  });
});
