/**
 * Tests for list-active command
 * Tests that the command discovers active skillsets by reading
 * .nori-managed marker files across the directory hierarchy.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { findActiveSkillsets, listActiveMain } from "./listActive.js";

// Mock @clack/prompts for output
const mockLogError = vi.fn();
vi.mock("@clack/prompts", () => ({
  log: {
    error: (msg: string) => mockLogError(msg),
  },
}));

// Mock process.stdout.write for raw output
const mockStdoutWrite = vi
  .spyOn(process.stdout, "write")
  .mockImplementation(() => true);

// Mock process.exit
const mockExit = vi
  .spyOn(process, "exit")
  .mockImplementation(() => undefined as never);

describe("findActiveSkillsets", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "list-active-test-"));
    mockStdoutWrite.mockClear();
    mockLogError.mockClear();
    mockExit.mockClear();
  });

  afterEach(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it("should find a skillset from a .nori-managed file in the current directory", async () => {
    // Create .claude/.nori-managed with a skillset name
    const claudeDir = path.join(testDir, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, ".nori-managed"), "senior-swe");

    const result = await findActiveSkillsets({ dir: testDir });

    expect(result).toContain("senior-swe");
  });

  it("should find skillsets in parent directories", async () => {
    // Create parent with .claude/.nori-managed
    const claudeDir = path.join(testDir, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(
      path.join(claudeDir, ".nori-managed"),
      "parent-skillset",
    );

    // Create child directory (no .nori-managed)
    const childDir = path.join(testDir, "child");
    await fs.mkdir(childDir, { recursive: true });

    const result = await findActiveSkillsets({ dir: childDir });

    expect(result).toContain("parent-skillset");
  });

  it("should find skillsets from multiple agents in the same directory", async () => {
    // Create .claude/.nori-managed
    const claudeDir = path.join(testDir, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, ".nori-managed"), "skillset-a");

    // Create .cursor/.nori-managed
    const cursorDir = path.join(testDir, ".cursor");
    await fs.mkdir(cursorDir, { recursive: true });
    await fs.writeFile(path.join(cursorDir, ".nori-managed"), "skillset-b");

    const result = await findActiveSkillsets({ dir: testDir });

    expect(result).toContain("skillset-a");
    expect(result).toContain("skillset-b");
  });

  it("should find skillsets at different directory levels", async () => {
    // Parent level: .claude/.nori-managed
    const parentClaudeDir = path.join(testDir, ".claude");
    await fs.mkdir(parentClaudeDir, { recursive: true });
    await fs.writeFile(
      path.join(parentClaudeDir, ".nori-managed"),
      "parent-skillset",
    );

    // Child level: .cursor/.nori-managed
    const childDir = path.join(testDir, "child");
    const childCursorDir = path.join(childDir, ".cursor");
    await fs.mkdir(childCursorDir, { recursive: true });
    await fs.writeFile(
      path.join(childCursorDir, ".nori-managed"),
      "child-skillset",
    );

    const result = await findActiveSkillsets({ dir: childDir });

    expect(result).toContain("parent-skillset");
    expect(result).toContain("child-skillset");
  });

  it("should return empty array when no active skillsets exist", async () => {
    const result = await findActiveSkillsets({ dir: testDir });

    expect(result).toEqual([]);
  });

  it("should deduplicate skillset names", async () => {
    // Same skillset in .claude and .cursor
    const claudeDir = path.join(testDir, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, ".nori-managed"), "same-skillset");

    const cursorDir = path.join(testDir, ".cursor");
    await fs.mkdir(cursorDir, { recursive: true });
    await fs.writeFile(path.join(cursorDir, ".nori-managed"), "same-skillset");

    const result = await findActiveSkillsets({ dir: testDir });

    expect(result.filter((s) => s === "same-skillset")).toHaveLength(1);
  });

  it("should skip empty .nori-managed files", async () => {
    const claudeDir = path.join(testDir, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, ".nori-managed"), "");

    const result = await findActiveSkillsets({ dir: testDir });

    expect(result).toEqual([]);
  });

  it("should default to cwd when no dir provided", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(testDir);

    const claudeDir = path.join(testDir, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, ".nori-managed"), "cwd-skillset");

    const result = await findActiveSkillsets({});

    expect(result).toContain("cwd-skillset");

    cwdSpy.mockRestore();
  });
});

describe("listActiveMain", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "list-active-main-test-"),
    );
    mockStdoutWrite.mockClear();
    mockLogError.mockClear();
    mockExit.mockClear();
  });

  afterEach(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it("should output skillset names one per line", async () => {
    const claudeDir = path.join(testDir, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, ".nori-managed"), "my-skillset");

    await listActiveMain({ dir: testDir });

    expect(mockStdoutWrite).toHaveBeenCalledWith("my-skillset\n");
  });

  it("should exit with code 1 when no active skillsets found", async () => {
    await listActiveMain({ dir: testDir });

    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("No active skillsets found"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockStdoutWrite).not.toHaveBeenCalled();
  });

  it("should output multiple skillsets sorted alphabetically", async () => {
    const claudeDir = path.join(testDir, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, ".nori-managed"), "zebra-skillset");

    const cursorDir = path.join(testDir, ".cursor");
    await fs.mkdir(cursorDir, { recursive: true });
    await fs.writeFile(path.join(cursorDir, ".nori-managed"), "alpha-skillset");

    await listActiveMain({ dir: testDir });

    expect(mockStdoutWrite).toHaveBeenCalledTimes(2);
    expect(mockStdoutWrite).toHaveBeenNthCalledWith(1, "alpha-skillset\n");
    expect(mockStdoutWrite).toHaveBeenNthCalledWith(2, "zebra-skillset\n");
  });
});
