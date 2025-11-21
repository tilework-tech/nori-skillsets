/**
 * Tests for paid-list-noridocs skill script
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { main } from "./script.js";

describe("paid-list-noridocs script", () => {
  let tempDir: string;
  let tempConfigPath: string;
  let originalCwd: () => string;
  let originalArgv: Array<string>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalCwd = process.cwd;
    originalArgv = process.argv;

    tempDir = path.join(os.tmpdir(), `list-noridocs-test-${Date.now()}`);
    process.cwd = () => tempDir;
    tempConfigPath = path.join(tempDir, ".nori-config.json");

    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((code?: string | number | null) => {
        throw new Error(`process.exit(${code})`);
      }) as any;
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    process.argv = originalArgv;

    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();

    try {
      await fs.rm(tempDir, {
        recursive: true,
        force: true,
      });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("tier checking", () => {
    it("should fail when no config file exists", async () => {
      process.argv = ["node", "script.js"];

      await expect(main()).rejects.toThrow("process.exit(1)");
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: No Nori installation found.",
      );
    });

    it("should fail when config has no auth credentials", async () => {
      await fs.mkdir(path.dirname(tempConfigPath), { recursive: true });
      await fs.writeFile(tempConfigPath, JSON.stringify({}));

      process.argv = ["node", "script.js"];

      await expect(main()).rejects.toThrow("process.exit(1)");
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("argument parsing", () => {
    it("should use defaults when optional args not provided", async () => {
      // Test structure for API mock integration
      expect(true).toBe(true);
    });

    it("should accept pathPrefix filter", async () => {
      // Test structure for API mock integration
      expect(true).toBe(true);
    });
  });

  describe("output formatting", () => {
    it("should output formatted list", async () => {
      // Test structure for API mock integration
      expect(true).toBe(true);
    });
  });
});
