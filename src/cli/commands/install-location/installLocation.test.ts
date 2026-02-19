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

  describe("default behavior", () => {
    it("should display installations with formatted output using note", async () => {
      const projectDir = path.join(tempDir, "project");
      const claudeDir = path.join(projectDir, ".claude");
      await fs.mkdir(claudeDir, { recursive: true });

      await fs.writeFile(
        path.join(claudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\ncontent\n# END NORI-AI MANAGED BLOCK",
      );

      await installLocationMain({ currentDir: projectDir });

      expect(note).toHaveBeenCalled();
      expect(outro).toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should show multiple installations", async () => {
      const parentDir = path.join(tempDir, "parent");
      const currentDir = path.join(parentDir, "current");
      const parentClaudeDir = path.join(parentDir, ".claude");
      const currentClaudeDir = path.join(currentDir, ".claude");

      await fs.mkdir(parentClaudeDir, { recursive: true });
      await fs.mkdir(currentClaudeDir, { recursive: true });

      await fs.writeFile(
        path.join(parentClaudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\nparent\n# END NORI-AI MANAGED BLOCK",
      );
      await fs.writeFile(
        path.join(currentClaudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\ncurrent\n# END NORI-AI MANAGED BLOCK",
      );

      await installLocationMain({ currentDir });

      expect(note).toHaveBeenCalled();
      expect(outro).toHaveBeenCalled();
    });
  });

  describe("--non-interactive flag", () => {
    it("should output one path per line without formatting", async () => {
      const projectDir = path.join(tempDir, "project");
      const claudeDir = path.join(projectDir, ".claude");
      await fs.mkdir(claudeDir, { recursive: true });

      await fs.writeFile(
        path.join(claudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\ncontent\n# END NORI-AI MANAGED BLOCK",
      );

      await installLocationMain({
        currentDir: projectDir,
        nonInteractive: true,
      });

      expect(mockStdoutWrite).toHaveBeenCalledWith(projectDir + "\n");
      expect(note).not.toHaveBeenCalled();
      expect(outro).not.toHaveBeenCalled();
    });

    it("should output multiple paths one per line", async () => {
      const parentDir = path.join(tempDir, "parent");
      const currentDir = path.join(parentDir, "current");
      const parentClaudeDir = path.join(parentDir, ".claude");
      const currentClaudeDir = path.join(currentDir, ".claude");

      await fs.mkdir(parentClaudeDir, { recursive: true });
      await fs.mkdir(currentClaudeDir, { recursive: true });

      await fs.writeFile(
        path.join(parentClaudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\nparent\n# END NORI-AI MANAGED BLOCK",
      );
      await fs.writeFile(
        path.join(currentClaudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\ncurrent\n# END NORI-AI MANAGED BLOCK",
      );

      await installLocationMain({
        currentDir,
        nonInteractive: true,
      });

      expect(mockStdoutWrite).toHaveBeenCalledWith(currentDir + "\n");
      expect(mockStdoutWrite).toHaveBeenCalledWith(parentDir + "\n");
      expect(mockStdoutWrite).toHaveBeenCalledTimes(2);
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
  });
});
