/**
 * Tests for paid-read-noridoc skill script
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { main } from "./script.js";

describe("paid-read-noridoc script", () => {
  let tempDir: string;
  let tempConfigPath: string;
  let originalCwd: () => string;
  let originalArgv: Array<string>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalCwd = process.cwd;
    originalArgv = process.argv;

    tempDir = path.join(os.tmpdir(), `read-noridoc-test-${Date.now()}`);
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
      process.argv = ["node", "script.js", "--filePath=@/test"];

      await expect(main()).rejects.toThrow("process.exit(1)");
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: No Nori installation found.",
      );
    });

    it("should fail when config has no auth credentials", async () => {
      await fs.mkdir(path.dirname(tempConfigPath), { recursive: true });
      await fs.writeFile(tempConfigPath, JSON.stringify({}));

      process.argv = ["node", "script.js", "--filePath=@/test"];

      await expect(main()).rejects.toThrow("process.exit(1)");
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("argument parsing", () => {
    it("should fail when --filePath is missing", async () => {
      await fs.mkdir(path.dirname(tempConfigPath), { recursive: true });
      await fs.writeFile(
        tempConfigPath,
        JSON.stringify({
          username: "test@example.com",
          password: "password",
          organizationUrl: "https://test.nori.ai",
        }),
      );

      process.argv = ["node", "script.js"];

      await expect(main()).rejects.toThrow("process.exit(1)");
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: --filePath parameter is required",
      );
    });

    it("should show usage help when arguments are invalid", async () => {
      await fs.mkdir(path.dirname(tempConfigPath), { recursive: true });
      await fs.writeFile(
        tempConfigPath,
        JSON.stringify({
          username: "test@example.com",
          password: "password",
          organizationUrl: "https://test.nori.ai",
        }),
      );

      process.argv = ["node", "script.js"];

      await expect(main()).rejects.toThrow("process.exit(1)");
      const errorCalls = consoleErrorSpy.mock.calls.flat().join("\n");
      expect(errorCalls).toMatch(/Usage:/);
    });
  });
});
