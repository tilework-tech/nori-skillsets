/**
 * Tests for claude-code factory reset: artifact discovery and deletion
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import * as clack from "@clack/prompts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  findClaudeCodeArtifacts,
  factoryResetClaudeCode,
} from "./factoryReset.js";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

// Mock promptText so we can control user input
vi.mock("@/cli/prompts/text.js", () => ({
  promptText: vi.fn(),
}));

describe("findClaudeCodeArtifacts", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "factory-reset-artifacts-"),
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should find a .claude directory at startDir", async () => {
    const claudeDir = path.join(tempDir, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });

    const artifacts = await findClaudeCodeArtifacts({
      startDir: tempDir,
      stopDir: tempDir,
    });

    expect(artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: claudeDir,
          type: "directory",
        }),
      ]),
    );
  });

  it("should find a CLAUDE.md file at startDir", async () => {
    const claudeMd = path.join(tempDir, "CLAUDE.md");
    await fs.writeFile(claudeMd, "# Test instructions");

    const artifacts = await findClaudeCodeArtifacts({
      startDir: tempDir,
      stopDir: tempDir,
    });

    expect(artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: claudeMd,
          type: "file",
        }),
      ]),
    );
  });

  it("should find both .claude directory and CLAUDE.md at the same level", async () => {
    const claudeDir = path.join(tempDir, ".claude");
    const claudeMd = path.join(tempDir, "CLAUDE.md");
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(claudeMd, "# Test instructions");

    const artifacts = await findClaudeCodeArtifacts({
      startDir: tempDir,
      stopDir: tempDir,
    });

    expect(artifacts).toHaveLength(2);
    expect(artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: claudeDir, type: "directory" }),
        expect.objectContaining({ path: claudeMd, type: "file" }),
      ]),
    );
  });

  it("should find artifacts at multiple ancestor levels", async () => {
    // Create nested structure: tempDir/a/b/c
    const dirA = path.join(tempDir, "a");
    const dirB = path.join(dirA, "b");
    const dirC = path.join(dirB, "c");
    await fs.mkdir(dirC, { recursive: true });

    // Put artifacts at tempDir and dirA
    await fs.mkdir(path.join(tempDir, ".claude"), { recursive: true });
    await fs.writeFile(path.join(dirA, "CLAUDE.md"), "# A-level instructions");

    const artifacts = await findClaudeCodeArtifacts({
      startDir: dirC,
      stopDir: tempDir,
    });

    expect(artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: path.join(tempDir, ".claude"),
          type: "directory",
        }),
        expect.objectContaining({
          path: path.join(dirA, "CLAUDE.md"),
          type: "file",
        }),
      ]),
    );
  });

  it("should return empty array when no artifacts exist", async () => {
    const artifacts = await findClaudeCodeArtifacts({
      startDir: tempDir,
      stopDir: tempDir,
    });

    expect(artifacts).toEqual([]);
  });

  it("should not descend into child directories", async () => {
    // Create child directory with .claude inside
    const childDir = path.join(tempDir, "child");
    await fs.mkdir(path.join(childDir, ".claude"), { recursive: true });

    // Search from tempDir (parent) — should NOT find child's .claude
    const artifacts = await findClaudeCodeArtifacts({
      startDir: tempDir,
      stopDir: tempDir,
    });

    expect(artifacts).toEqual([]);
  });

  it("should respect stopDir and not climb above it", async () => {
    // Create nested structure: tempDir/project/subdir
    const projectDir = path.join(tempDir, "project");
    const subDir = path.join(projectDir, "subdir");
    await fs.mkdir(subDir, { recursive: true });

    // Put artifacts at tempDir (above stopDir)
    await fs.mkdir(path.join(tempDir, ".claude"), { recursive: true });
    // Put artifacts at projectDir (at stopDir)
    await fs.writeFile(path.join(projectDir, "CLAUDE.md"), "# Project");

    const artifacts = await findClaudeCodeArtifacts({
      startDir: subDir,
      stopDir: projectDir,
    });

    // Should find projectDir's CLAUDE.md but NOT tempDir's .claude
    expect(artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: path.join(projectDir, "CLAUDE.md"),
          type: "file",
        }),
      ]),
    );
    expect(artifacts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: path.join(tempDir, ".claude"),
        }),
      ]),
    );
  });
});

describe("factoryResetClaudeCode", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "factory-reset-delete-"));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should delete all artifacts when user types 'confirm'", async () => {
    const { promptText } = await import("@/cli/prompts/text.js");
    vi.mocked(promptText).mockResolvedValue("confirm");

    // Create artifacts
    const claudeDir = path.join(tempDir, ".claude");
    const claudeMd = path.join(tempDir, "CLAUDE.md");
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, "settings.json"), "{}");
    await fs.writeFile(claudeMd, "# Instructions");

    await factoryResetClaudeCode({ path: tempDir });

    // Verify both are gone
    await expect(fs.access(claudeDir)).rejects.toThrow();
    await expect(fs.access(claudeMd)).rejects.toThrow();
  });

  it("should not delete anything when user does not type 'confirm'", async () => {
    const { promptText } = await import("@/cli/prompts/text.js");
    vi.mocked(promptText).mockResolvedValue("no");

    // Create artifacts
    const claudeDir = path.join(tempDir, ".claude");
    const claudeMd = path.join(tempDir, "CLAUDE.md");
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(claudeMd, "# Instructions");

    await factoryResetClaudeCode({ path: tempDir });

    // Verify both still exist
    await expect(fs.access(claudeDir)).resolves.toBeUndefined();
    await expect(fs.access(claudeMd)).resolves.toBeUndefined();
  });

  it("should log info and return without prompting when no artifacts found", async () => {
    const { promptText } = await import("@/cli/prompts/text.js");

    await factoryResetClaudeCode({ path: tempDir });

    expect(clack.log.info).toHaveBeenCalledWith(expect.stringContaining("No"));
    // Should never prompt the user
    expect(promptText).not.toHaveBeenCalled();
  });

  it("should list artifacts in a note before asking for confirmation", async () => {
    const { promptText } = await import("@/cli/prompts/text.js");
    vi.mocked(promptText).mockResolvedValue("cancel");

    const claudeDir = path.join(tempDir, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });

    await factoryResetClaudeCode({ path: tempDir });

    // Should have shown the artifact path in a note before prompting
    expect(clack.note).toHaveBeenCalledTimes(1);
    const noteContent = vi.mocked(clack.note).mock.calls[0][0];
    expect(noteContent).toContain(claudeDir);
  });

  it("should delete both directories and files", async () => {
    const { promptText } = await import("@/cli/prompts/text.js");
    vi.mocked(promptText).mockResolvedValue("confirm");

    // Create both types of artifacts at the same level
    const claudeDir = path.join(tempDir, ".claude");
    const claudeMd = path.join(tempDir, "CLAUDE.md");
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, "skills"), "content");
    await fs.writeFile(claudeMd, "# Project instructions");

    await factoryResetClaudeCode({ path: tempDir });

    // Both should be deleted
    await expect(fs.access(claudeDir)).rejects.toThrow();
    await expect(fs.access(claudeMd)).rejects.toThrow();
  });
});
