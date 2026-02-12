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

vi.mock("@clack/prompts", () => ({
  log: {
    success: (msg: string) => mockLogSuccess(msg),
    step: (msg: string) => mockLogStep(msg),
  },
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

// Mock child_process.execFile
vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

describe("dirMain", () => {
  beforeEach(() => {
    mockStdoutWrite.mockClear();
    mockLogSuccess.mockClear();
    mockLogStep.mockClear();
    vi.mocked(childProcess.execFile).mockReset();
  });

  describe("non-interactive mode", () => {
    it("should output plain path without formatting and without opening explorer", async () => {
      await dirMain({ nonInteractive: true });

      expect(mockStdoutWrite).toHaveBeenCalledWith(MOCK_PROFILES_DIR + "\n");
      expect(mockStdoutWrite).toHaveBeenCalledTimes(1);
      expect(mockLogSuccess).not.toHaveBeenCalled();
      expect(mockLogStep).not.toHaveBeenCalled();
      expect(childProcess.execFile).not.toHaveBeenCalled();
    });
  });

  describe("interactive mode - file explorer opens successfully", () => {
    it("should attempt to open the profiles directory with platform open command on darwin", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin" });

      vi.mocked(childProcess.execFile).mockImplementation(
        (_cmd, _args, callback) => {
          if (typeof callback === "function") {
            (callback as (error: Error | null) => void)(null);
          }
          return {} as childProcess.ChildProcess;
        },
      );

      await dirMain();

      expect(childProcess.execFile).toHaveBeenCalledWith(
        "open",
        [MOCK_PROFILES_DIR],
        expect.any(Function),
      );
      expect(mockLogSuccess).toHaveBeenCalledWith(
        expect.stringContaining(MOCK_PROFILES_DIR),
      );

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("should use xdg-open on linux", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux" });

      vi.mocked(childProcess.execFile).mockImplementation(
        (_cmd, _args, callback) => {
          if (typeof callback === "function") {
            (callback as (error: Error | null) => void)(null);
          }
          return {} as childProcess.ChildProcess;
        },
      );

      await dirMain();

      expect(childProcess.execFile).toHaveBeenCalledWith(
        "xdg-open",
        [MOCK_PROFILES_DIR],
        expect.any(Function),
      );

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });
  });

  describe("interactive mode - file explorer fails to open", () => {
    it("should fall back to printing the path when open command fails", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin" });

      vi.mocked(childProcess.execFile).mockImplementation(
        (_cmd, _args, callback) => {
          if (typeof callback === "function") {
            (callback as (error: Error | null) => void)(
              new Error("command not found"),
            );
          }
          return {} as childProcess.ChildProcess;
        },
      );

      await dirMain();

      // Should fall back to printing the path via log.step
      expect(mockLogStep).toHaveBeenCalledWith(
        expect.stringContaining(MOCK_PROFILES_DIR),
      );

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });
  });

  describe("default args", () => {
    it("should work when called with no arguments", async () => {
      vi.mocked(childProcess.execFile).mockImplementation(
        (_cmd, _args, callback) => {
          if (typeof callback === "function") {
            (callback as (error: Error | null) => void)(null);
          }
          return {} as childProcess.ChildProcess;
        },
      );

      await dirMain();

      // Should attempt to open (interactive by default)
      expect(childProcess.execFile).toHaveBeenCalled();
    });
  });
});
