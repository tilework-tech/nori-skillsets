/**
 * Tests for install-location command
 * Tests the installLocationMain function with various flag combinations
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { installLocationMain } from "./installLocation.js";

// Mock logger to capture output
const mockRaw = vi.fn();
const mockError = vi.fn();
const mockInfo = vi.fn();
const mockSuccess = vi.fn();
const mockNewline = vi.fn();

vi.mock("@/cli/logger.js", () => ({
  raw: (args: { message: string }) => mockRaw(args),
  error: (args: { message: string }) => mockError(args),
  info: (args: { message: string }) => mockInfo(args),
  success: (args: { message: string }) => mockSuccess(args),
  newline: () => mockNewline(),
}));

// Mock process.exit
const mockExit = vi
  .spyOn(process, "exit")
  .mockImplementation(() => undefined as never);

describe("installLocationMain", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "install-location-test-"));
    mockRaw.mockClear();
    mockError.mockClear();
    mockInfo.mockClear();
    mockSuccess.mockClear();
    mockNewline.mockClear();
    mockExit.mockClear();
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("default behavior (no flags)", () => {
    it("should display all installations with formatted output", async () => {
      const projectDir = path.join(tempDir, "project");
      const claudeDir = path.join(projectDir, ".claude");
      await fs.mkdir(claudeDir, { recursive: true });

      // Create source installation
      await fs.writeFile(
        path.join(projectDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      await installLocationMain({ currentDir: projectDir });

      // Should use formatted output (info, success, newline)
      expect(mockInfo).toHaveBeenCalled();
      expect(mockSuccess).toHaveBeenCalled();
      expect(mockNewline).toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should show both source and managed installations grouped by category", async () => {
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

      // Should show category headers
      expect(mockInfo).toHaveBeenCalledWith({
        message: expect.stringContaining("Installation source"),
      });
      expect(mockInfo).toHaveBeenCalledWith({
        message: expect.stringContaining("Managed installation"),
      });
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

      // Should only show the source installation (parent)
      expect(mockSuccess).toHaveBeenCalledWith({
        message: expect.stringContaining(parentDir),
      });
      // Should NOT show the managed-only installation (current)
      const successCalls = mockSuccess.mock.calls.map((c) => c[0].message);
      expect(successCalls.some((m: string) => m.includes(currentDir))).toBe(
        false,
      );
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
      expect(mockSuccess).toHaveBeenCalledWith({
        message: expect.stringContaining(projectDir),
      });
    });
  });

  describe("--managed-installation flag", () => {
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

      // Should only show the managed installation (current)
      expect(mockSuccess).toHaveBeenCalledWith({
        message: expect.stringContaining(currentDir),
      });
      // Should NOT show the source-only installation (parent) as a standalone path
      // Note: currentDir contains parentDir as a prefix, so we check for exact path matches
      const successCalls = mockSuccess.mock.calls.map(
        (c) => c[0].message as string,
      );
      const hasParentDirExact = successCalls.some(
        (m) => m.includes(parentDir) && !m.includes(currentDir),
      );
      expect(hasParentDirExact).toBe(false);
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
      expect(mockSuccess).toHaveBeenCalledWith({
        message: expect.stringContaining(projectDir),
      });
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

      // Should use raw output only
      expect(mockRaw).toHaveBeenCalledWith({ message: projectDir });
      // Should NOT use formatted output
      expect(mockInfo).not.toHaveBeenCalled();
      expect(mockSuccess).not.toHaveBeenCalled();
      expect(mockNewline).not.toHaveBeenCalled();
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

      // Should output both paths via raw
      expect(mockRaw).toHaveBeenCalledWith({ message: currentDir });
      expect(mockRaw).toHaveBeenCalledWith({ message: parentDir });
      expect(mockRaw).toHaveBeenCalledTimes(2);
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

      // Should output only source installation via raw
      expect(mockRaw).toHaveBeenCalledWith({ message: parentDir });
      expect(mockRaw).toHaveBeenCalledTimes(1);
    });

    it("should apply --managed-installation with --non-interactive", async () => {
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

      // Should output only managed installation via raw
      expect(mockRaw).toHaveBeenCalledWith({ message: currentDir });
      expect(mockRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe("conflicting flags", () => {
    it("should error when both --installation-source and --managed-installation are provided", async () => {
      const projectDir = path.join(tempDir, "project");
      await fs.mkdir(projectDir, { recursive: true });

      await installLocationMain({
        currentDir: projectDir,
        installationSource: true,
        managedInstallation: true,
      });

      expect(mockError).toHaveBeenCalledWith({
        message: expect.stringContaining("Cannot use both"),
      });
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("error cases", () => {
    it("should error with exit code 1 when no installations found", async () => {
      const emptyDir = path.join(tempDir, "empty");
      await fs.mkdir(emptyDir, { recursive: true });

      await installLocationMain({ currentDir: emptyDir });

      expect(mockError).toHaveBeenCalledWith({
        message: expect.stringContaining("No Nori installation"),
      });
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

      expect(mockError).toHaveBeenCalledWith({
        message: expect.stringContaining("No"),
      });
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});
