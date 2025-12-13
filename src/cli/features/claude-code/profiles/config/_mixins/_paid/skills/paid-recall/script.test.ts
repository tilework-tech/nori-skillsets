/**
 * Tests for paid-recall skill script
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { main } from "./script.js";

describe("paid-recall script", () => {
  let tempDir: string;
  let tempConfigPath: string;
  let originalCwd: () => string;
  let originalArgv: Array<string>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalCwd = process.cwd;
    originalArgv = process.argv;

    tempDir = path.join(os.tmpdir(), `recall-test-${Date.now()}`);
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

  describe("installDir resolution", () => {
    it("should find config in parent directory when running from subdirectory", async () => {
      // Create parent directory with config
      const parentDir = path.join(os.tmpdir(), `recall-parent-${Date.now()}`);
      const subDir = path.join(parentDir, "subdir", "nested");
      await fs.mkdir(subDir, { recursive: true });

      // Create config in parent with auth
      const parentConfigPath = path.join(parentDir, ".nori-config.json");
      await fs.writeFile(
        parentConfigPath,
        JSON.stringify({
          username: "test@example.com",
          password: "password",
          organizationUrl: "https://test.nori.ai",
        }),
      );

      // Mock cwd to be subdirectory
      process.cwd = () => subDir;
      process.argv = ["node", "script.js", "--query=test"];

      // Note: This will fail when calling the API, but we're just testing that
      // it finds the config and doesn't exit with tier check error
      await expect(main()).rejects.toThrow();
      // Should NOT have been called with tier check error
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        "Error: This feature requires a paid Nori subscription.",
      );

      // Cleanup
      await fs.rm(parentDir, { recursive: true, force: true });
    });

    it("should fail with clear error when no installation found", async () => {
      // Create directory with NO config file
      const noInstallDir = path.join(
        os.tmpdir(),
        `recall-no-install-${Date.now()}`,
      );
      await fs.mkdir(noInstallDir, { recursive: true });

      process.cwd = () => noInstallDir;
      process.argv = ["node", "script.js", "--query=test"];

      await expect(main()).rejects.toThrow("process.exit(1)");
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: No Nori installation found.",
      );

      // Cleanup
      await fs.rm(noInstallDir, { recursive: true, force: true });
    });
  });

  describe("tier checking", () => {
    it("should fail when no config file exists", async () => {
      process.argv = ["node", "script.js", "--query=test"];

      await expect(main()).rejects.toThrow("process.exit(1)");
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: No Nori installation found.",
      );
    });

    it("should fail when config has no auth credentials", async () => {
      await fs.mkdir(path.dirname(tempConfigPath), { recursive: true });
      await fs.writeFile(tempConfigPath, JSON.stringify({}));

      process.argv = ["node", "script.js", "--query=test"];

      await expect(main()).rejects.toThrow("process.exit(1)");
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("argument parsing", () => {
    it("should fail when --query is missing", async () => {
      await fs.mkdir(path.dirname(tempConfigPath), { recursive: true });
      await fs.writeFile(
        tempConfigPath,
        JSON.stringify({
          username: "test@example.com",
          password: "password",
          organizationUrl: "https://test.nori.ai",
        }),
      );

      process.argv = ["node", "script.js", "--limit=5"];

      await expect(main()).rejects.toThrow("process.exit(1)");
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: Either --query or --id parameter is required",
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

  describe("--id parameter", () => {
    it("should fail when both --id and --query are provided", async () => {
      await fs.mkdir(path.dirname(tempConfigPath), { recursive: true });
      await fs.writeFile(
        tempConfigPath,
        JSON.stringify({
          username: "test@example.com",
          password: "password",
          organizationUrl: "https://test.nori.ai",
        }),
      );

      process.argv = ["node", "script.js", "--id=nori_test123", "--query=test"];

      await expect(main()).rejects.toThrow("process.exit(1)");
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: --id and --query are mutually exclusive. Provide one or the other.",
      );
    });

    it("should fail when neither --id nor --query are provided", async () => {
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
      const errorCalls = consoleErrorSpy.mock.calls.flat().join("\n");
      expect(errorCalls).toMatch(/Usage:/);
    });
  });
});
