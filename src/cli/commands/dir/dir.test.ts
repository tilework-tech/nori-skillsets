/**
 * Tests for dir command
 * Tests the dirMain function: opening file explorer and fallback to printing path
 */

import * as childProcess from "child_process";

import { describe, it, expect, beforeEach, vi } from "vitest";

import { dirMain } from "./dir.js";

// Mock @clack/prompts for output
const mockLogSuccess = vi.fn();
const mockLogStep = vi.fn();
const mockOutro = vi.fn();

vi.mock("@clack/prompts", () => ({
  log: {
    success: (msg: string) => mockLogSuccess(msg),
    step: (msg: string) => mockLogStep(msg),
  },
  outro: (msg: string) => mockOutro(msg),
}));

// Mock process.stdout.write for non-interactive output
const mockStdoutWrite = vi
  .spyOn(process.stdout, "write")
  .mockImplementation(() => true);

// Mock getNoriProfilesDir
const MOCK_PROFILES_DIR = "/home/testuser/.nori/profiles";
vi.mock("@/cli/features/claude-code/paths.js", () => ({
  getNoriProfilesDir: () => MOCK_PROFILES_DIR,
}));

// Mock child_process.spawn
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

const createMockChild = (args: {
  pid?: number | null;
}): childProcess.ChildProcess => {
  const { pid } = args;
  return {
    pid: pid ?? undefined,
    unref: vi.fn(),
  } as unknown as childProcess.ChildProcess;
};

describe("dirMain", () => {
  beforeEach(() => {
    mockStdoutWrite.mockClear();
    mockLogSuccess.mockClear();
    mockLogStep.mockClear();
    mockOutro.mockClear();
    vi.mocked(childProcess.spawn).mockReset();
  });

  describe("non-interactive mode", () => {
    it("should output plain path without formatting and without opening explorer", async () => {
      await dirMain({ nonInteractive: true });

      expect(mockStdoutWrite).toHaveBeenCalledWith(MOCK_PROFILES_DIR + "\n");
      expect(mockStdoutWrite).toHaveBeenCalledTimes(1);
      expect(mockLogSuccess).not.toHaveBeenCalled();
      expect(mockLogStep).not.toHaveBeenCalled();
      expect(mockOutro).not.toHaveBeenCalled();
      expect(childProcess.spawn).not.toHaveBeenCalled();
    });
  });

  describe("interactive mode - file explorer opens successfully", () => {
    it("should spawn detached process with platform open command on darwin", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin" });

      const mockChild = createMockChild({ pid: 12345 });
      vi.mocked(childProcess.spawn).mockReturnValue(mockChild);

      await dirMain();

      expect(childProcess.spawn).toHaveBeenCalledWith(
        "open",
        [MOCK_PROFILES_DIR],
        { detached: true, stdio: "ignore" },
      );
      expect(mockChild.unref).toHaveBeenCalled();
      expect(mockLogSuccess).toHaveBeenCalledWith(
        expect.stringContaining(MOCK_PROFILES_DIR),
      );
      expect(mockOutro).toHaveBeenCalled();

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("should use xdg-open on linux", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux" });

      const mockChild = createMockChild({ pid: 12345 });
      vi.mocked(childProcess.spawn).mockReturnValue(mockChild);

      await dirMain();

      expect(childProcess.spawn).toHaveBeenCalledWith(
        "xdg-open",
        [MOCK_PROFILES_DIR],
        { detached: true, stdio: "ignore" },
      );
      expect(mockChild.unref).toHaveBeenCalled();
      expect(mockOutro).toHaveBeenCalled();

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });
  });

  describe("interactive mode - file explorer fails to open", () => {
    it("should fall back to printing the path when spawn fails", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin" });

      vi.mocked(childProcess.spawn).mockImplementation(() => {
        throw new Error("spawn ENOENT");
      });

      await dirMain();

      // Should fall back to printing the path via log.step
      expect(mockLogStep).toHaveBeenCalledWith(
        expect.stringContaining(MOCK_PROFILES_DIR),
      );
      expect(mockLogSuccess).not.toHaveBeenCalled();
      expect(mockOutro).toHaveBeenCalled();

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("should fall back when spawn returns null pid", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin" });

      const mockChild = createMockChild({ pid: null });
      vi.mocked(childProcess.spawn).mockReturnValue(mockChild);

      await dirMain();

      // Should fall back to printing the path via log.step
      expect(mockLogStep).toHaveBeenCalledWith(
        expect.stringContaining(MOCK_PROFILES_DIR),
      );
      expect(mockLogSuccess).not.toHaveBeenCalled();
      expect(mockOutro).toHaveBeenCalled();

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });
  });

  describe("default args", () => {
    it("should work when called with no arguments", async () => {
      const mockChild = createMockChild({ pid: 12345 });
      vi.mocked(childProcess.spawn).mockReturnValue(mockChild);

      await dirMain();

      // Should attempt to open (interactive by default)
      expect(childProcess.spawn).toHaveBeenCalled();
      expect(mockOutro).toHaveBeenCalled();
    });
  });
});
