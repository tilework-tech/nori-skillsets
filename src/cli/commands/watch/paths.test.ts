/**
 * Tests for watch command path utilities
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  getClaudeProjectsDir,
  getClaudeProjectDir,
  getTranscriptDir,
  getWatchPidFile,
  getWatchLogFile,
} from "@/cli/commands/watch/paths.js";

describe("getClaudeProjectsDir", () => {
  test("returns ~/.claude/projects", () => {
    const result = getClaudeProjectsDir();
    const expected = path.join(os.homedir(), ".claude", "projects");
    expect(result).toBe(expected);
  });
});

describe("getClaudeProjectDir", () => {
  test("converts simple path to Claude project directory format", () => {
    const result = getClaudeProjectDir({ cwd: "/Users/sean/Projects/app" });
    expect(result).toBe("-Users-sean-Projects-app");
  });

  test("converts path with spaces to dashes", () => {
    const result = getClaudeProjectDir({ cwd: "/Users/sean/My Projects/app" });
    expect(result).toBe("-Users-sean-My-Projects-app");
  });

  test("converts path with special characters to dashes", () => {
    const result = getClaudeProjectDir({
      cwd: "/Users/sean/Projects(1)/app",
    });
    expect(result).toBe("-Users-sean-Projects-1--app");
  });

  test("preserves existing dashes", () => {
    const result = getClaudeProjectDir({
      cwd: "/Users/sean/my-project/app",
    });
    expect(result).toBe("-Users-sean-my-project-app");
  });

  test("adds leading dash if path starts with alphanumeric", () => {
    const result = getClaudeProjectDir({ cwd: "Users/sean/app" });
    expect(result).toBe("-Users-sean-app");
  });
});

describe("getTranscriptDir", () => {
  test("returns correct path for claude-code agent", () => {
    const result = getTranscriptDir({
      agent: "claude-code",
      projectName: "-Users-sean-Projects-app",
    });
    const expected = path.join(
      os.homedir(),
      ".nori",
      "transcripts",
      "claude-code",
      "-Users-sean-Projects-app",
    );
    expect(result).toBe(expected);
  });

  test("returns correct path for different agent", () => {
    const result = getTranscriptDir({
      agent: "cursor",
      projectName: "-Users-sean-Projects-app",
    });
    const expected = path.join(
      os.homedir(),
      ".nori",
      "transcripts",
      "cursor",
      "-Users-sean-Projects-app",
    );
    expect(result).toBe(expected);
  });
});

describe("getWatchPidFile", () => {
  test("returns ~/.nori/watch.pid", () => {
    const result = getWatchPidFile();
    const expected = path.join(os.homedir(), ".nori", "watch.pid");
    expect(result).toBe(expected);
  });
});

describe("getWatchLogFile", () => {
  test("returns ~/.nori/logs/watch.log", () => {
    const result = getWatchLogFile();
    const expected = path.join(os.homedir(), ".nori", "logs", "watch.log");
    expect(result).toBe(expected);
  });
});

describe("getClaudeProjectDir with symlinks", () => {
  let tempDir: string;
  let realDir: string;
  let symlinkDir: string;

  beforeEach(async () => {
    // Create temp directory structure
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "watch-test-"));
    realDir = path.join(tempDir, "real-project");
    symlinkDir = path.join(tempDir, "symlink-project");

    await fs.mkdir(realDir);
    await fs.symlink(realDir, symlinkDir);
  });

  afterEach(async () => {
    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("resolves symlinks before converting path", async () => {
    // When given a symlink path, should resolve to real path first
    const symlinkResult = getClaudeProjectDir({ cwd: symlinkDir });
    const realResult = getClaudeProjectDir({ cwd: realDir });

    // Both should produce the same result (based on real path)
    expect(symlinkResult).toBe(realResult);
  });
});
