/**
 * Tests for install-location command
 * Tests the installLocationMain function with various flag combinations
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { log, note, outro } from "@clack/prompts";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { installLocationMain } from "./installLocation.js";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  log: {
    error: vi.fn(),
  },
  note: vi.fn(),
  outro: vi.fn(),
}));

// Mock process.exit
const mockExit = vi
  .spyOn(process, "exit")
  .mockImplementation(() => undefined as never);

// Mock process.stdout.write for non-interactive output
const mockStdoutWrite = vi
  .spyOn(process.stdout, "write")
  .mockImplementation(() => true);

describe("installLocationMain", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "install-location-test-"));
    vi.mocked(log.error).mockClear();
    vi.mocked(note).mockClear();
    vi.mocked(outro).mockClear();
    mockExit.mockClear();
    mockStdoutWrite.mockClear();
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("default behavior (no flags)", () => {
    it("should display all installations with formatted output using note", async () => {
      const projectDir = path.join(tempDir, "project");
      const claudeDir = path.join(projectDir, ".claude");
      await fs.mkdir(claudeDir, { recursive: true });

      // Create source installation
      await fs.writeFile(
        path.join(projectDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      await installLocationMain({ currentDir: projectDir });

      // Should use note for formatted output
      expect(note).toHaveBeenCalled();
      // Should end with outro
      expect(outro).toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should show both source and managed installations in separate notes", async () => {
      // Setup: parent (source), current (managed)
      const parentDir = path.join(tempDir, "parent");
      const currentDir = path.join(parentDir, "current");
      const currentClaudeDir = path.join(currentDir, ".claude");

      await fs.mkdir(currentClaudeDir, { recursive: true });

      // Parent: source
      await fs.writeFile(
        path.join(parentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "parent" } }),
      );

      // Current: managed
      await fs.writeFile(
        path.join(currentClaudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\ncontent\n# END NORI-AI MANAGED BLOCK",
      );

      await installLocationMain({ currentDir });

      // Should have two notes - one for source, one for managed
      expect(note).toHaveBeenCalledTimes(2);

      // First note should be for source installations
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining(parentDir),
        expect.stringMatching(/Installation source/i),
      );

      // Second note should be for managed installations
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining(currentDir),
        expect.stringMatching(/Managed installation/i),
      );

      expect(outro).toHaveBeenCalled();
    });
  });

  describe("--installation-source flag", () => {
    it("should only show source installations when flag is set", async () => {
      // Setup: parent (source), current (managed)
      const parentDir = path.join(tempDir, "parent");
      const currentDir = path.join(parentDir, "current");
      const currentClaudeDir = path.join(currentDir, ".claude");

      await fs.mkdir(currentClaudeDir, { recursive: true });

      // Parent: source
      await fs.writeFile(
        path.join(parentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "parent" } }),
      );

      // Current: managed only
      await fs.writeFile(
        path.join(currentClaudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\ncontent\n# END NORI-AI MANAGED BLOCK",
      );

      await installLocationMain({
        currentDir,
        installationSource: true,
      });

      // Should show note with the source installation (parent)
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining(parentDir),
        expect.stringMatching(/Installation source/i),
      );
      // Should only have one note
      expect(note).toHaveBeenCalledTimes(1);
      expect(outro).toHaveBeenCalled();
    });

    it("should include 'both' type installations when filtering by source", async () => {
      const projectDir = path.join(tempDir, "project");
      const claudeDir = path.join(projectDir, ".claude");
      await fs.mkdir(claudeDir, { recursive: true });

      // Create both markers
      await fs.writeFile(
        path.join(projectDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );
      await fs.writeFile(
        path.join(claudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\ncontent\n# END NORI-AI MANAGED BLOCK",
      );

      await installLocationMain({
        currentDir: projectDir,
        installationSource: true,
      });

      // Should include the "both" installation since it qualifies as source
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining(projectDir),
        expect.stringMatching(/Installation source/i),
      );
      expect(outro).toHaveBeenCalled();
    });
  });

  describe("--installation-managed flag", () => {
    it("should only show managed installations when flag is set", async () => {
      // Setup: parent (source), current (managed)
      const parentDir = path.join(tempDir, "parent");
      const currentDir = path.join(parentDir, "current");
      const currentClaudeDir = path.join(currentDir, ".claude");

      await fs.mkdir(currentClaudeDir, { recursive: true });

      // Parent: source only
      await fs.writeFile(
        path.join(parentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "parent" } }),
      );

      // Current: managed only
      await fs.writeFile(
        path.join(currentClaudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\ncontent\n# END NORI-AI MANAGED BLOCK",
      );

      await installLocationMain({
        currentDir,
        managedInstallation: true,
      });

      // Should show note with the managed installation (current)
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining(currentDir),
        expect.stringMatching(/Managed installation/i),
      );
      // Should only have one note
      expect(note).toHaveBeenCalledTimes(1);
      expect(outro).toHaveBeenCalled();
    });

    it("should include 'both' type installations when filtering by managed", async () => {
      const projectDir = path.join(tempDir, "project");
      const claudeDir = path.join(projectDir, ".claude");
      await fs.mkdir(claudeDir, { recursive: true });

      // Create both markers
      await fs.writeFile(
        path.join(projectDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );
      await fs.writeFile(
        path.join(claudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\ncontent\n# END NORI-AI MANAGED BLOCK",
      );

      await installLocationMain({
        currentDir: projectDir,
        managedInstallation: true,
      });

      // Should include the "both" installation since it qualifies as managed
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining(projectDir),
        expect.stringMatching(/Managed installation/i),
      );
      expect(outro).toHaveBeenCalled();
    });
  });

  describe("--non-interactive flag", () => {
    it("should output one path per line without formatting", async () => {
      const projectDir = path.join(tempDir, "project");
      await fs.mkdir(projectDir, { recursive: true });

      await fs.writeFile(
        path.join(projectDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      await installLocationMain({
        currentDir: projectDir,
        nonInteractive: true,
      });

      // Should use stdout.write for output
      expect(mockStdoutWrite).toHaveBeenCalledWith(projectDir + "\n");
      // Should NOT use clack formatted output
      expect(note).not.toHaveBeenCalled();
      expect(outro).not.toHaveBeenCalled();
    });

    it("should output multiple paths one per line", async () => {
      const parentDir = path.join(tempDir, "parent");
      const currentDir = path.join(parentDir, "current");
      await fs.mkdir(currentDir, { recursive: true });

      // Create installations in both
      await fs.writeFile(
        path.join(parentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "parent" } }),
      );
      await fs.writeFile(
        path.join(currentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "current" } }),
      );

      await installLocationMain({
        currentDir,
        nonInteractive: true,
      });

      // Should output both paths via stdout.write
      expect(mockStdoutWrite).toHaveBeenCalledWith(currentDir + "\n");
      expect(mockStdoutWrite).toHaveBeenCalledWith(parentDir + "\n");
      expect(mockStdoutWrite).toHaveBeenCalledTimes(2);
    });
  });

  describe("combined flags", () => {
    it("should apply --installation-source with --non-interactive", async () => {
      const parentDir = path.join(tempDir, "parent");
      const currentDir = path.join(parentDir, "current");
      const currentClaudeDir = path.join(currentDir, ".claude");

      await fs.mkdir(currentClaudeDir, { recursive: true });

      // Parent: source
      await fs.writeFile(
        path.join(parentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "parent" } }),
      );

      // Current: managed only
      await fs.writeFile(
        path.join(currentClaudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\ncontent\n# END NORI-AI MANAGED BLOCK",
      );

      await installLocationMain({
        currentDir,
        installationSource: true,
        nonInteractive: true,
      });

      // Should output only source installation via stdout.write
      expect(mockStdoutWrite).toHaveBeenCalledWith(parentDir + "\n");
      expect(mockStdoutWrite).toHaveBeenCalledTimes(1);
    });

    it("should apply --installation-managed with --non-interactive", async () => {
      const parentDir = path.join(tempDir, "parent");
      const currentDir = path.join(parentDir, "current");
      const currentClaudeDir = path.join(currentDir, ".claude");

      await fs.mkdir(currentClaudeDir, { recursive: true });

      // Parent: source
      await fs.writeFile(
        path.join(parentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "parent" } }),
      );

      // Current: managed only
      await fs.writeFile(
        path.join(currentClaudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\ncontent\n# END NORI-AI MANAGED BLOCK",
      );

      await installLocationMain({
        currentDir,
        managedInstallation: true,
        nonInteractive: true,
      });

      // Should output only managed installation via stdout.write
      expect(mockStdoutWrite).toHaveBeenCalledWith(currentDir + "\n");
      expect(mockStdoutWrite).toHaveBeenCalledTimes(1);
    });
  });

  describe("conflicting flags", () => {
    it("should error when both --installation-source and --installation-managed are provided", async () => {
      const projectDir = path.join(tempDir, "project");
      await fs.mkdir(projectDir, { recursive: true });

      await installLocationMain({
        currentDir: projectDir,
        installationSource: true,
        managedInstallation: true,
      });

      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining("Cannot use both"),
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("error cases", () => {
    it("should error with exit code 1 when no installations found", async () => {
      const emptyDir = path.join(tempDir, "empty");
      await fs.mkdir(emptyDir, { recursive: true });

      await installLocationMain({ currentDir: emptyDir });

      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining("No Nori installation"),
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should error when filter returns no results", async () => {
      const projectDir = path.join(tempDir, "project");
      await fs.mkdir(projectDir, { recursive: true });

      // Create only source installation
      await fs.writeFile(
        path.join(projectDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      // Filter for managed only (none exist)
      await installLocationMain({
        currentDir: projectDir,
        managedInstallation: true,
      });

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining("No"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});
