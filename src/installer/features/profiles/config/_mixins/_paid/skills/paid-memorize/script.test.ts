/**
 * Tests for paid-memorize skill script
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { main } from "./script.js";

describe("paid-memorize script", () => {
  let tempDir: string;
  let tempConfigPath: string;
  let originalCwd: () => string;
  let originalArgv: Array<string>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Save original state
    originalCwd = process.cwd;
    originalArgv = process.argv;

    // Create temp directory for config
    tempDir = path.join(os.tmpdir(), `memorize-test-${Date.now()}`);
    process.cwd = () => tempDir;
    tempConfigPath = path.join(tempDir, ".nori-config.json");

    // Mock console.error and process.exit
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {
      // Suppress console.error output in tests
    });
    processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((code?: string | number | null) => {
        throw new Error(`process.exit(${code})`);
      }) as any;
  });

  afterEach(async () => {
    // Restore original state
    process.cwd = originalCwd;
    process.argv = originalArgv;

    // Restore mocks
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();

    // Clean up temp config
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
    it("should fail with error message when no config file exists", async () => {
      process.argv = ["node", "script.js", "--name=Test", "--content=Content"];

      await expect(main()).rejects.toThrow("process.exit(1)");

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: No Nori installation found.",
      );
    });

    it("should fail with error message when config has no auth credentials", async () => {
      await fs.mkdir(path.dirname(tempConfigPath), { recursive: true });
      await fs.writeFile(tempConfigPath, JSON.stringify({}));

      process.argv = ["node", "script.js", "--name=Test", "--content=Content"];

      await expect(main()).rejects.toThrow("process.exit(1)");

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: This feature requires a paid Nori subscription.",
      );
    });
  });

  describe("argument parsing", () => {
    it("should fail when --name is missing", async () => {
      // Create paid config
      await fs.mkdir(path.dirname(tempConfigPath), { recursive: true });
      await fs.writeFile(
        tempConfigPath,
        JSON.stringify({
          username: "test@example.com",
          password: "password",
          organizationUrl: "https://test.nori.ai",
        }),
      );

      process.argv = ["node", "script.js", "--content=Content"];

      await expect(main()).rejects.toThrow("process.exit(1)");

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: --name parameter is required",
      );
    });

    it("should fail when --content is missing", async () => {
      // Create paid config
      await fs.mkdir(path.dirname(tempConfigPath), { recursive: true });
      await fs.writeFile(
        tempConfigPath,
        JSON.stringify({
          username: "test@example.com",
          password: "password",
          organizationUrl: "https://test.nori.ai",
        }),
      );

      process.argv = ["node", "script.js", "--name=Test"];

      await expect(main()).rejects.toThrow("process.exit(1)");

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: --content parameter is required",
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

      process.argv = ["node", "script.js", "--invalid-arg=value"];

      await expect(main()).rejects.toThrow("process.exit(1)");

      expect(processExitSpy).toHaveBeenCalledWith(1);
      const errorCalls = consoleErrorSpy.mock.calls.flat().join("\n");
      expect(errorCalls).toMatch(/Usage:/);
    });
  });
});
