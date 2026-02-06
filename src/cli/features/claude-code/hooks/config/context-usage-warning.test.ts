/**
 * Tests for context usage warning hook
 *
 * This hook warns users when their settings.local.json files are large
 * and consuming excessive context tokens.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { main } from "./context-usage-warning.js";

// Store console output
let consoleOutput: Array<string> = [];
const originalConsoleLog = console.log;

// Mock analytics to prevent actual tracking
vi.mock("@/cli/installTracking.js", () => ({
  buildCLIEventParams: vi.fn().mockResolvedValue({}),
  getUserId: vi.fn().mockResolvedValue(null),
  sendAnalyticsEvent: vi.fn(),
}));

describe("context-usage-warning hook", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    // Create temp directory for test
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "context-usage-warning-test-"),
    );

    // Mock HOME
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;

    // Capture console output
    consoleOutput = [];
    console.log = (...args: Array<unknown>) => {
      consoleOutput.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    // Restore HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Restore console
    console.log = originalConsoleLog;

    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should output nothing when settings.local.json does not exist", async () => {
    // Setup: Create a project directory without settings.local.json
    const projectDir = path.join(tempDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });

    // Run the hook
    await main({ cwd: projectDir });

    // Verify no output
    expect(consoleOutput).toHaveLength(0);
  });

  it("should output nothing when settings.local.json is small", async () => {
    // Setup: Create small settings.local.json files
    const claudeDir = path.join(tempDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });

    // Create small file (< 10KB threshold)
    const smallSettings = {
      permissions: {
        allow: ["Bash(npm test)"],
        deny: [],
      },
    };
    fs.writeFileSync(
      path.join(claudeDir, "settings.local.json"),
      JSON.stringify(smallSettings),
    );

    const projectDir = path.join(tempDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });

    // Run the hook
    await main({ cwd: projectDir });

    // Verify no output (file is small)
    expect(consoleOutput).toHaveLength(0);
  });

  it("should output warning when home settings.local.json is large", async () => {
    // Setup: Create large settings.local.json in home
    const claudeDir = path.join(tempDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });

    // Create large file (> 10KB threshold)
    // Generate many permission entries to exceed 10KB
    const manyPermissions = Array.from(
      { length: 500 },
      (_, i) =>
        `Bash(git -C /home/user/code/project/.worktrees/feature-${i} push -u origin feature-${i})`,
    );
    const largeSettings = {
      permissions: {
        allow: manyPermissions,
        deny: [],
      },
    };
    fs.writeFileSync(
      path.join(claudeDir, "settings.local.json"),
      JSON.stringify(largeSettings),
    );

    const projectDir = path.join(tempDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });

    // Run the hook
    await main({ cwd: projectDir });

    // Verify warning output
    expect(consoleOutput).toHaveLength(1);
    const output = JSON.parse(consoleOutput[0]);
    expect(output).toHaveProperty("systemMessage");
    expect(output.systemMessage).toContain("⚠️");
    // Should contain manual cleanup instructions, not /nori-prune-context
    expect(output.systemMessage).toContain("settings.local.json");
    expect(output.systemMessage).toContain("permissions");
    expect(output.systemMessage).toContain("allow");
  });

  it("should output warning when project settings.local.json is large", async () => {
    // Setup: Create large settings.local.json in project
    const projectDir = path.join(tempDir, "project");
    const projectClaudeDir = path.join(projectDir, ".claude");
    fs.mkdirSync(projectClaudeDir, { recursive: true });

    // Create large file (> 10KB threshold)
    const manyPermissions = Array.from(
      { length: 500 },
      (_, i) => `Bash(npm run test:unit:${i})`,
    );
    const largeSettings = {
      permissions: {
        allow: manyPermissions,
        deny: [],
      },
    };
    fs.writeFileSync(
      path.join(projectClaudeDir, "settings.local.json"),
      JSON.stringify(largeSettings),
    );

    // Run the hook
    await main({ cwd: projectDir });

    // Verify warning output
    expect(consoleOutput).toHaveLength(1);
    const output = JSON.parse(consoleOutput[0]);
    expect(output).toHaveProperty("systemMessage");
    expect(output.systemMessage).toContain("⚠️");
    // Should contain manual cleanup instructions, not /nori-prune-context
    expect(output.systemMessage).toContain("settings.local.json");
    expect(output.systemMessage).toContain("permissions");
    expect(output.systemMessage).toContain("allow");
  });

  it("should combine sizes from both home and project settings.local.json", async () => {
    // Setup: Create medium-sized files in both locations
    // Each is under threshold alone, but combined exceeds it
    const claudeDir = path.join(tempDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });

    const projectDir = path.join(tempDir, "project");
    const projectClaudeDir = path.join(projectDir, ".claude");
    fs.mkdirSync(projectClaudeDir, { recursive: true });

    // Create files that together exceed 10KB
    const mediumPermissions = Array.from(
      { length: 250 },
      (_, i) =>
        `Bash(git -C /home/user/code/project/.worktrees/feature-${i} push)`,
    );
    const mediumSettings = {
      permissions: {
        allow: mediumPermissions,
        deny: [],
      },
    };

    fs.writeFileSync(
      path.join(claudeDir, "settings.local.json"),
      JSON.stringify(mediumSettings),
    );
    fs.writeFileSync(
      path.join(projectClaudeDir, "settings.local.json"),
      JSON.stringify(mediumSettings),
    );

    // Run the hook
    await main({ cwd: projectDir });

    // Verify warning output (combined size exceeds threshold)
    expect(consoleOutput).toHaveLength(1);
    const output = JSON.parse(consoleOutput[0]);
    expect(output).toHaveProperty("systemMessage");
    expect(output.systemMessage).toContain("⚠️");
  });

  it("should not throw errors and exit gracefully on invalid paths", async () => {
    // Setup: Invalid cwd
    const invalidDir = path.join(tempDir, "nonexistent", "path");

    // Run the hook - should not throw
    await expect(main({ cwd: invalidDir })).resolves.not.toThrow();

    // Hook should exit gracefully with no output
    expect(consoleOutput).toHaveLength(0);
  });

  it("should include estimated token count in warning message", async () => {
    // Setup: Create large settings.local.json
    const claudeDir = path.join(tempDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });

    const manyPermissions = Array.from(
      { length: 500 },
      (_, i) =>
        `Bash(git -C /home/user/code/project/.worktrees/feature-${i} push -u origin feature-${i})`,
    );
    const largeSettings = {
      permissions: {
        allow: manyPermissions,
        deny: [],
      },
    };
    fs.writeFileSync(
      path.join(claudeDir, "settings.local.json"),
      JSON.stringify(largeSettings),
    );

    const projectDir = path.join(tempDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });

    // Run the hook
    await main({ cwd: projectDir });

    // Verify token estimate is in the message
    expect(consoleOutput).toHaveLength(1);
    const output = JSON.parse(consoleOutput[0]);
    expect(output.systemMessage).toMatch(/\d+.*token/i);
  });
});
