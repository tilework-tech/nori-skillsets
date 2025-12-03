/**
 * Tests for slash-command-intercept hook
 * This hook intercepts slash commands for instant execution without LLM inference
 */

import { spawn } from "child_process";
import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";
import { fileURLToPath } from "url";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

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

// Get directory of this test file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the built script
const SLASH_COMMAND_INTERCEPT_SCRIPT = path.resolve(
  __dirname,
  "../../../../../build/src/installer/features/hooks/config/slash-command-intercept.js",
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

describe("slash-command-intercept hook", () => {
  let testDir: string;
  let profilesDir: string;
  let configPath: string;

  beforeEach(async () => {
    // Create test directory structure
    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "slash-command-intercept-test-"),
    );
    const claudeDir = path.join(testDir, ".claude");
    profilesDir = path.join(claudeDir, "profiles");
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

  describe("nori-switch-profile command", () => {
    it("should match /nori-switch-profile with profile name and switch profile", async () => {
      const scriptPath = SLASH_COMMAND_INTERCEPT_SCRIPT;

      const stdinData = JSON.stringify({
        prompt: "/nori-switch-profile amol",
        cwd: testDir,
        session_id: "test-session",
        transcript_path: "",
        permission_mode: "default",
        hook_event_name: "UserPromptSubmit",
      });

      const result = await runHookScript({ scriptPath, stdinData });

      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.decision).toBe("block");
      expect(output.reason).toContain("amol");
      expect(output.reason).toContain("Restart");

      // Verify profile was actually switched in config
      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(updatedConfig.profile.baseProfile).toBe("amol");
    });

    it("should list available profiles when no profile name provided", async () => {
      const scriptPath = SLASH_COMMAND_INTERCEPT_SCRIPT;

      const stdinData = JSON.stringify({
        prompt: "/nori-switch-profile",
        cwd: testDir,
        session_id: "test-session",
        transcript_path: "",
        permission_mode: "default",
        hook_event_name: "UserPromptSubmit",
      });

      const result = await runHookScript({ scriptPath, stdinData });

      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.decision).toBe("block");
      const plainReason = stripAnsi(output.reason!);
      expect(plainReason).toContain("Available profiles:");
      expect(plainReason).toContain("amol");
      expect(plainReason).toContain("senior-swe");
      expect(plainReason).toContain("product-manager");
    });
  });

  describe("nori-toggle-autoupdate command", () => {
    it("should toggle autoupdate from enabled to disabled", async () => {
      // Set up config with enabled
      await fs.writeFile(
        configPath,
        JSON.stringify({
          profile: { baseProfile: "senior-swe" },
          autoupdate: "enabled",
        }),
      );

      const scriptPath = SLASH_COMMAND_INTERCEPT_SCRIPT;

      const stdinData = JSON.stringify({
        prompt: "/nori-toggle-autoupdate",
        cwd: testDir,
        session_id: "test-session",
        transcript_path: "",
        permission_mode: "default",
        hook_event_name: "UserPromptSubmit",
      });

      const result = await runHookScript({ scriptPath, stdinData });

      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.decision).toBe("block");
      expect(output.reason).toContain("DISABLED");

      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(updatedConfig.autoupdate).toBe("disabled");
    });
  });

  describe("nori-toggle-session-transcripts command", () => {
    it("should toggle session transcripts from enabled to disabled", async () => {
      // Set up config with enabled
      await fs.writeFile(
        configPath,
        JSON.stringify({
          profile: { baseProfile: "senior-swe" },
          sendSessionTranscript: "enabled",
        }),
      );

      const scriptPath = SLASH_COMMAND_INTERCEPT_SCRIPT;

      const stdinData = JSON.stringify({
        prompt: "/nori-toggle-session-transcripts",
        cwd: testDir,
        session_id: "test-session",
        transcript_path: "",
        permission_mode: "default",
        hook_event_name: "UserPromptSubmit",
      });

      const result = await runHookScript({ scriptPath, stdinData });

      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.decision).toBe("block");
      expect(output.reason).toContain("DISABLED");

      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(updatedConfig.sendSessionTranscript).toBe("disabled");
    });
  });

  describe("nori-install-location command", () => {
    it("should return installation directory", async () => {
      const scriptPath = SLASH_COMMAND_INTERCEPT_SCRIPT;

      const stdinData = JSON.stringify({
        prompt: "/nori-install-location",
        cwd: testDir,
        session_id: "test-session",
        transcript_path: "",
        permission_mode: "default",
        hook_event_name: "UserPromptSubmit",
      });

      const result = await runHookScript({ scriptPath, stdinData });

      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.decision).toBe("block");
      expect(output.reason).toContain(testDir);
    });
  });

  describe("pass-through behavior", () => {
    it("should pass through non-matching prompts", async () => {
      const scriptPath = SLASH_COMMAND_INTERCEPT_SCRIPT;

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

    it("should handle malformed stdin JSON gracefully", async () => {
      const scriptPath = SLASH_COMMAND_INTERCEPT_SCRIPT;

      const result = await runHookScript({
        scriptPath,
        stdinData: "not valid json",
      });

      // Should exit successfully but pass through (no output)
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
    });

    it("should handle empty stdin gracefully", async () => {
      const scriptPath = SLASH_COMMAND_INTERCEPT_SCRIPT;

      const result = await runHookScript({
        scriptPath,
        stdinData: "",
      });

      // Should exit successfully but pass through (no output)
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
    });
  });

  describe("error handling", () => {
    it("should fail with clear error when no installation found", async () => {
      const scriptPath = SLASH_COMMAND_INTERCEPT_SCRIPT;

      // Create a directory with NO Nori installation markers
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "slash-command-no-install-"),
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

        expect(result.exitCode).toBe(0);

        const output = JSON.parse(result.stdout);
        expect(output.decision).toBe("block");
        expect(stripAnsi(output.reason!)).toContain(
          "No Nori installation found",
        );
      } finally {
        await fs.rm(noInstallDir, { recursive: true, force: true });
      }
    });
  });
});
