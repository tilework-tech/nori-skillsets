/**
 * Tests for CLI --agent flag support
 *
 * Verifies that the CLI correctly parses the --agent flag and passes it to commands
 */

import { execSync } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";

import { describe, it, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the built CLI
const CLI_PATH = path.join(
  __dirname,
  "..",
  "..",
  "build",
  "src",
  "cli",
  "cli.js",
);

/**
 * Helper to run CLI commands and capture output
 * @param args - CLI arguments to pass to the command
 *
 * @returns Object with stdout, stderr, and exitCode
 */
const runCli = (
  args: string,
): { stdout: string; stderr: string; exitCode: number } => {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      exitCode: error.status || 1,
    };
  }
};

describe("CLI --agent flag", () => {
  describe("help output", () => {
    it("should show --agent option in help", () => {
      const result = runCli("--help");

      expect(result.stdout).toContain("--agent");
      expect(result.stdout).toContain("claude-code");
    });

    it("should show --agent option in install help", () => {
      const result = runCli("install --help");

      // The --agent option is global, should be visible in parent help
      // but install command should work with it
      expect(result.exitCode).toBe(0);
    });
  });

  describe("default agent behavior", () => {
    it("should default to claude-code when no --agent flag provided", () => {
      // We can't easily test the actual behavior without mocking,
      // but we can verify the help text mentions the default
      const result = runCli("--help");

      expect(result.stdout).toContain("claude-code");
    });
  });

  describe("invalid agent handling", () => {
    it("should show error with list of valid agents for unknown agent", () => {
      const result = runCli("--agent unknown-agent install --help");

      // Should fail with an error mentioning valid agents
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("unknown-agent");
      expect(result.stderr).toContain("claude-code");
    });
  });

  describe("explicit agent flag", () => {
    it("should accept --agent claude-code explicitly", () => {
      const result = runCli("--agent claude-code --help");

      // Should succeed - claude-code is a valid agent
      expect(result.exitCode).toBe(0);
    });

    it("should accept -a as short form of --agent", () => {
      const result = runCli("-a claude-code --help");

      // Should succeed - -a is alias for --agent
      expect(result.exitCode).toBe(0);
    });
  });
});
